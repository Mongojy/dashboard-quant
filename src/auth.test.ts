// Standalone check for src/auth.ts — no test framework/deps required.
//
// Run:   npx tsx src/auth.test.ts
// (npx fetches tsx on demand; requires Node 18+ for global fetch/crypto.subtle/atob)
//
// Exercises requireAccessAuth() end-to-end against a real RSA-signed JWT and
// a mocked JWKS endpoint, covering the four required scenarios:
//   1. missing header       -> 401
//   2. invalid signature    -> 401
//   3. wrong email          -> 401
//   4. valid token          -> passthrough (null)
//
// --- Manual curl checks against a deployed Worker ---
// 1. Missing header:
//   curl -i https://<worker>/api/health
//   -> expect HTTP/1.1 401, body {"error":"unauthorized","reason":"missing_jwt"}
//
// 2. Invalid signature (tamper a real token's last few chars):
//   curl -i https://<worker>/api/health -H "Cf-Access-Jwt-Assertion: <token-with-flipped-last-char>"
//   -> expect 401, reason "bad_signature"
//
// 3. Wrong email (token issued to an email not in ACCESS_ALLOWED_EMAIL):
//   curl -i https://<worker>/api/health -H "Cf-Access-Jwt-Assertion: <token-for-other-user>"
//   -> expect 401, reason "email_not_allowed"
//
// 4. Valid token (obtain via `cloudflared access login <app-url>` or the
//    CF_Authorization cookie set by a browser login through Access):
//   curl -i https://<worker>/api/health -H "Cf-Access-Jwt-Assertion: $(cloudflared access token -app=<app-url>)"
//   -> expect 200 and the real route response

import assert from "node:assert/strict";
import { requireAccessAuth } from "./auth";

const TEAM_DOMAIN = "test-team";
const AUD = "test-aud-tag";
const ALLOWED_EMAIL = "operator@example.com";
const KID = "test-key-1";

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

async function main() {
  const { publicKey, privateKey } = await makeKeyPair();
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);

  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href === `https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as typeof fetch;

  const env = {
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ACCESS_ALLOWED_EMAIL: ALLOWED_EMAIL,
  };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const basePayload = { aud: AUD, email: ALLOWED_EMAIL, iat: nowSeconds, exp: nowSeconds + 3600 };

  // 1. missing header -> 401
  {
    const req = new Request("https://worker.example/api/health");
    const res = await requireAccessAuth(req, env);
    assert.ok(res, "expected a Response for missing header");
    assert.equal(res!.status, 401);
    const body = await res!.json();
    assert.equal((body as { reason: string }).reason, "missing_jwt");
    console.log("PASS: missing header -> 401");
  }

  // 2. invalid signature -> 401
  {
    const token = await signJwt(privateKey, basePayload);
    const tampered = token.slice(0, -4) + (token.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    const req = new Request("https://worker.example/api/health", {
      headers: { "Cf-Access-Jwt-Assertion": tampered },
    });
    const res = await requireAccessAuth(req, env);
    assert.ok(res, "expected a Response for invalid signature");
    assert.equal(res!.status, 401);
    console.log("PASS: invalid signature -> 401");
  }

  // 3. wrong email -> 401
  {
    const token = await signJwt(privateKey, { ...basePayload, email: "someone-else@example.com" });
    const req = new Request("https://worker.example/api/health", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const res = await requireAccessAuth(req, env);
    assert.ok(res, "expected a Response for wrong email");
    assert.equal(res!.status, 401);
    const body = await res!.json();
    assert.equal((body as { reason: string }).reason, "email_not_allowed");
    console.log("PASS: wrong email -> 401");
  }

  // 4. valid token -> passthrough (null)
  {
    const token = await signJwt(privateKey, basePayload);
    const req = new Request("https://worker.example/api/health", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const res = await requireAccessAuth(req, env);
    assert.equal(res, null, "expected passthrough (null) for a valid token");
    console.log("PASS: valid token -> passthrough");
  }

  console.log("\nAll auth checks passed.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
