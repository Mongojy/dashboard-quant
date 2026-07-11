// Tests for GET /api/summary (src/index.ts).
//
// Runs under @cloudflare/vitest-pool-workers, so env.DATA_BUCKET is a real
// (miniflare-simulated) R2 binding — fixtures are seeded via put()/delete().
//
// The Cf-Access-Jwt-Assertion mocking (RSA keypair + signed JWT + mocked
// JWKS fetch) reuses the exact pattern from src/auth.test.ts rather than
// inventing a second scheme: sign a real token, monkey-patch global fetch
// to serve it back from the JWKS endpoint.

import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker, { serveSummary, Env } from "./index";

const TEAM_DOMAIN = "test-team";
const AUD = "test-aud-tag";
const ALLOWED_EMAIL = "operator@example.com";
const KID = "test-key-1";
const SUMMARY_KEY = "dashboard_summary.json";

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
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

let validToken: string;
const testEnv = {
  ...env,
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ACCESS_ALLOWED_EMAIL: ALLOWED_EMAIL,
} as unknown as Env;

beforeAll(async () => {
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

  const nowSeconds = Math.floor(Date.now() / 1000);
  validToken = await signJwt(privateKey, { aud: AUD, email: ALLOWED_EMAIL, iat: nowSeconds, exp: nowSeconds + 3600 });
});

function authedRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("Cf-Access-Jwt-Assertion", validToken);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function run(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /api/summary", () => {
  it("200s with the artifact body, content-type, cache-control, and staleness header", async () => {
    const body = JSON.stringify({ schema_version: 2, generated_at: "2026-07-06T00:00:00Z", ok: true });
    await env.DATA_BUCKET.put(SUMMARY_KEY, body);

    const res = await run(authedRequest("/api/summary"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(res.headers.get("x-summary-generated-at")).toBe("2026-07-06T00:00:00Z");
    expect(await res.text()).toBe(body);

    await env.DATA_BUCKET.delete(SUMMARY_KEY);
  });

  it("503s with summary_not_available when the key is missing", async () => {
    await env.DATA_BUCKET.delete(SUMMARY_KEY);

    const res = await run(authedRequest("/api/summary"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "summary_not_available" });
  });

  it("405s on a non-GET method", async () => {
    const res = await run(authedRequest("/api/summary", { method: "POST" }));
    expect(res.status).toBe(405);
  });
});

describe("unknown routes", () => {
  it("404s for a path outside /api/", async () => {
    const res = await run(new Request("https://worker.example/foo"));
    expect(res.status).toBe(404);
  });

  it("404s for an unrecognized /api/ path", async () => {
    const res = await run(authedRequest("/api/nope"));
    expect(res.status).toBe(404);
  });
});

describe("serveSummary (unit)", () => {
  it("502s with r2_read_failed when the R2 read itself throws", async () => {
    const throwingBucket = {
      get: async () => {
        throw new Error("simulated R2 outage");
      },
    } as unknown as R2Bucket;

    const res = await serveSummary(throwingBucket);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "r2_read_failed" });
  });
});
