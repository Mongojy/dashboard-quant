// Tests for src/auth.ts (Cf-Access-Jwt-Assertion validation).
//
// Runs under @cloudflare/vitest-pool-workers. The JWKS endpoint is mocked by
// monkey-patching global fetch (same pattern as src/summary.test.ts) — the
// mock serves whatever is in `servedKeys` and increments `fetchCallCount` so
// tests can assert exactly how many JWKS fetches a scenario triggers.

import { beforeEach, describe, expect, it } from "vitest";
import { requireAccessAuth } from "./auth";

const TEAM_DOMAIN = "test-team";
const ISS = `https://${TEAM_DOMAIN}.cloudflareaccess.com`;
const AUD = "test-aud-tag";
const ALLOWED_EMAIL = "operator@example.com";

const env = {
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ACCESS_ALLOWED_EMAIL: ALLOWED_EMAIL,
};

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

async function signJwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

let servedKeys: Array<Record<string, unknown>> = [];
let fetchCallCount = 0;

beforeEach(() => {
  servedKeys = [];
  fetchCallCount = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href === `https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`) {
      fetchCallCount++;
      return new Response(JSON.stringify({ keys: servedKeys }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as typeof fetch;
});

function request(token: string): Request {
  return new Request("https://worker.example/api/health", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

async function addKey(kid: string) {
  const { publicKey, privateKey } = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  servedKeys.push({ ...jwk, kid });
  return privateKey;
}

function basePayload(extra?: Record<string, unknown>) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { iss: ISS, aud: AUD, email: ALLOWED_EMAIL, iat: nowSeconds, exp: nowSeconds + 3600, ...extra };
}

describe("requireAccessAuth", () => {
  it("rejects a missing header", async () => {
    const res = await requireAccessAuth(new Request("https://worker.example/api/health"), env);
    expect(res?.status).toBe(401);
    expect((await res!.json()) as { reason: string }).toMatchObject({ reason: "missing_jwt" });
  });

  it("rejects an invalid signature", async () => {
    const privateKey = await addKey("kid-sig");
    const token = await signJwt(privateKey, "kid-sig", basePayload());
    const tampered = token.slice(0, -4) + (token.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    const res = await requireAccessAuth(request(tampered), env);
    expect(res?.status).toBe(401);
  });

  it("rejects a wrong email", async () => {
    const privateKey = await addKey("kid-email");
    const token = await signJwt(privateKey, "kid-email", basePayload({ email: "someone-else@example.com" }));
    const res = await requireAccessAuth(request(token), env);
    expect(res?.status).toBe(401);
    expect((await res!.json()) as { reason: string }).toMatchObject({ reason: "email_not_allowed" });
  });

  it("passes through a valid token", async () => {
    const privateKey = await addKey("kid-valid");
    const token = await signJwt(privateKey, "kid-valid", basePayload());
    const res = await requireAccessAuth(request(token), env);
    expect(res).toBeNull();
  });

  it("rejects a token with no exp claim", async () => {
    const privateKey = await addKey("kid-noexp");
    const payload = basePayload();
    delete (payload as Record<string, unknown>).exp;
    const token = await signJwt(privateKey, "kid-noexp", payload);
    const res = await requireAccessAuth(request(token), env);
    expect(res?.status).toBe(401);
    expect((await res!.json()) as { reason: string }).toMatchObject({ reason: "missing_exp" });
  });

  it("rejects a wrong iss", async () => {
    const privateKey = await addKey("kid-iss");
    const token = await signJwt(privateKey, "kid-iss", basePayload({ iss: "https://someone-elses-team.cloudflareaccess.com" }));
    const res = await requireAccessAuth(request(token), env);
    expect(res?.status).toBe(401);
    expect((await res!.json()) as { reason: string }).toMatchObject({ reason: "iss_mismatch" });
  });

  it("on unknown kid, forces exactly one JWKS refetch and succeeds once the new key is present", async () => {
    // Prime the cache with an initial key so the lookup below is a genuine
    // cache miss rather than a cold-start fetch.
    const primeKey = await addKey("kid-prime");
    const primeToken = await signJwt(primeKey, "kid-prime", basePayload());
    expect(await requireAccessAuth(request(primeToken), env)).toBeNull();

    // Simulate CF Access rotating in a new key server-side, then a token
    // signed with that new kid arrives before our cache would naturally
    // expire.
    const rotatedKey = await addKey("kid-rotated");
    const rotatedToken = await signJwt(rotatedKey, "kid-rotated", basePayload());

    fetchCallCount = 0;
    const res = await requireAccessAuth(request(rotatedToken), env);

    expect(res).toBeNull();
    expect(fetchCallCount).toBe(1);
  });

  it("rejects an unknown kid that is still absent after the forced refetch", async () => {
    const primeKey = await addKey("kid-prime-2");
    const primeToken = await signJwt(primeKey, "kid-prime-2", basePayload());
    expect(await requireAccessAuth(request(primeToken), env)).toBeNull();

    // Sign with a kid that never appears in the server's JWKS at all.
    const strayKey = await makeKeyPair();
    const strayToken = await signJwt(strayKey.privateKey, "kid-never-published", basePayload());

    fetchCallCount = 0;
    const res = await requireAccessAuth(request(strayToken), env);

    expect(res?.status).toBe(401);
    expect((await res!.json()) as { reason: string }).toMatchObject({ reason: "unknown_kid" });
    expect(fetchCallCount).toBe(1);
  });
});
