// Cloudflare Access JWT validation middleware for qats-dashboard-api.
//
// Standalone module — no dependency on the (not-yet-scaffolded) index.ts
// router. Wire it in like this once the Worker skeleton exists:
//
//   import { requireAccessAuth, AccessEnv } from "./auth";
//
//   export default {
//     async fetch(request: Request, env: AccessEnv & <YourEnv>): Promise<Response> {
//       const url = new URL(request.url);
//       if (url.pathname.startsWith("/api/")) {
//         const denied = await requireAccessAuth(request, env);
//         if (denied) return denied; // 401, before any R2 access
//       }
//       // ... existing route parsing / R2 fetch logic, untouched ...
//     },
//   };
//
// Required Worker env bindings (wrangler.toml [vars] / `wrangler secret put`,
// values never committed):
//   ACCESS_TEAM_DOMAIN    team subdomain only, e.g. "myteam"
//                         (JWKS = https://myteam.cloudflareaccess.com/cdn-cgi/access/certs)
//   ACCESS_AUD            the Access application's AUD tag
//   ACCESS_ALLOWED_EMAIL  the single operator email allowed through
// Optional:
//   ACCESS_JWKS_TTL_SECONDS  JWKS cache TTL in seconds (default 3600)

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_ALLOWED_EMAIL: string;
  ACCESS_JWKS_TTL_SECONDS?: string;
}

const HEADER_NAME = "Cf-Access-Jwt-Assertion";
const DEFAULT_JWKS_TTL_SECONDS = 3600;

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

interface JwksCacheEntry {
  keys: Jwk[];
  fetchedAt: number;
  teamDomain: string;
}

// Module-scoped: a Worker isolate is reused across many requests, so this
// survives between invocations and avoids refetching JWKS per-request.
// A concurrent in-flight fetch is de-duped so a cold cache under load
// doesn't fan out into N JWKS requests.
let jwksCache: JwksCacheEntry | null = null;
let jwksInflight: Promise<Jwk[]> | null = null;

class AuthError extends Error {}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(input: string): string {
  return new TextDecoder().decode(base64UrlDecode(input));
}

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  const res = await fetch(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) {
    throw new AuthError(`jwks_fetch_failed_${res.status}`);
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) {
    throw new AuthError("jwks_response_malformed");
  }
  return body.keys;
}

async function getJwks(env: AccessEnv): Promise<Jwk[]> {
  const ttlSeconds = Number(env.ACCESS_JWKS_TTL_SECONDS) || DEFAULT_JWKS_TTL_SECONDS;
  const now = Date.now();

  if (
    jwksCache &&
    jwksCache.teamDomain === env.ACCESS_TEAM_DOMAIN &&
    now - jwksCache.fetchedAt < ttlSeconds * 1000
  ) {
    return jwksCache.keys;
  }

  if (!jwksInflight) {
    jwksInflight = fetchJwks(env.ACCESS_TEAM_DOMAIN)
      .then((keys) => {
        jwksCache = { keys, fetchedAt: Date.now(), teamDomain: env.ACCESS_TEAM_DOMAIN };
        return keys;
      })
      .finally(() => {
        jwksInflight = null;
      });
  }
  return jwksInflight;
}

async function importJwk(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyAccessJwt(token: string, env: AccessEnv): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed_jwt");
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    throw new AuthError("malformed_jwt_segments");
  }

  if (header.alg !== "RS256") throw new AuthError("unsupported_alg");
  if (!header.kid) throw new AuthError("missing_kid");

  const keys = await getJwks(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError("unknown_kid");

  const key = await importJwk(jwk);
  const signature = base64UrlDecode(signatureB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature as BufferSource,
    signedData as BufferSource,
  );
  if (!validSignature) throw new AuthError("bad_signature");

  const nowSeconds = Date.now() / 1000;
  if (typeof payload.exp === "number" && nowSeconds >= payload.exp) {
    throw new AuthError("expired_token");
  }
  if (typeof payload.nbf === "number" && nowSeconds < payload.nbf) {
    throw new AuthError("token_not_yet_valid");
  }

  const aud = payload.aud;
  const audMatches = Array.isArray(aud) ? aud.includes(env.ACCESS_AUD) : aud === env.ACCESS_AUD;
  if (!audMatches) throw new AuthError("aud_mismatch");

  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email || email.toLowerCase() !== env.ACCESS_ALLOWED_EMAIL.toLowerCase()) {
    throw new AuthError("email_not_allowed");
  }
}

/**
 * Validates the Cf-Access-Jwt-Assertion header on `request`. Call this
 * before any R2 access. Returns a 401 Response if the request must be
 * rejected, or `null` if the caller should proceed.
 */
export async function requireAccessAuth(request: Request, env: AccessEnv): Promise<Response | null> {
  const token = request.headers.get(HEADER_NAME);
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: "missing_jwt" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    await verifyAccessJwt(token, env);
    return null;
  } catch (err) {
    const reason = err instanceof AuthError ? err.message : "verification_failed";
    return new Response(JSON.stringify({ error: "unauthorized", reason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
}
