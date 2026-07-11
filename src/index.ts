// Cloudflare Worker API for qats-dashboard.
//
// Read-only, JWT-gated passthrough from R2 (`DATA_BUCKET`) to JSON responses.
// No transformation of R2 object bodies except reading `decision_date` out of
// signals_manifest.json to resolve /api/signals/latest.

import { requireAccessAuth, AccessEnv } from "./auth";

export interface Env extends AccessEnv {
  DATA_BUCKET: R2Bucket;
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function serveR2Json(bucket: R2Bucket, key: string): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) return jsonError(404, "not_found", { key });
  return new Response(object.body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const SUMMARY_KEY = "dashboard_summary.json";
const GENERATED_AT_RE = /"generated_at"\s*:\s*"([^"]*)"/;

export async function serveSummary(bucket: R2Bucket): Promise<Response> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(SUMMARY_KEY);
  } catch {
    return jsonError(502, "r2_read_failed");
  }
  if (!object) return jsonError(503, "summary_not_available");

  const text = await object.text();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "private, max-age=30",
  };
  const match = GENERATED_AT_RE.exec(text);
  if (match) headers["X-Summary-Generated-At"] = match[1];

  return new Response(text, { status: 200, headers });
}

async function serveSignalsLatest(bucket: R2Bucket): Promise<Response> {
  const manifestKey = "signals_manifest.json";
  const manifestObject = await bucket.get(manifestKey);
  if (!manifestObject) return jsonError(404, "not_found", { key: manifestKey });

  let manifest: unknown;
  try {
    manifest = await manifestObject.json();
  } catch {
    return jsonError(502, "invalid_manifest", { key: manifestKey, reason: "malformed_json" });
  }

  const decisionDate =
    manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>).decision_date : undefined;
  if (typeof decisionDate !== "string" || !decisionDate) {
    return jsonError(502, "invalid_manifest", { key: manifestKey, reason: "missing_decision_date" });
  }

  return serveR2Json(bucket, `signals_${decisionDate}.json`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith("/api/")) {
      return jsonError(404, "not_found");
    }

    if (request.method !== "GET") {
      return jsonError(405, "method_not_allowed");
    }

    const denied = await requireAccessAuth(request, env);
    if (denied) return denied;

    switch (pathname) {
      case "/api/health":
        return serveR2Json(env.DATA_BUCKET, "health.json");
      case "/api/diagnostics":
        return serveR2Json(env.DATA_BUCKET, "diagnostics.json");
      case "/api/manifest":
        return serveR2Json(env.DATA_BUCKET, "signals_manifest.json");
      case "/api/signals/latest":
        return serveSignalsLatest(env.DATA_BUCKET);
      case "/api/verdicts":
        return serveR2Json(env.DATA_BUCKET, "gate_verdicts.json");
      case "/api/summary":
        return serveSummary(env.DATA_BUCKET);
      default:
        return jsonError(404, "not_found");
    }
  },
};
