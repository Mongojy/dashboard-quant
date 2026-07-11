# qats-dashboard-api

Cloudflare Worker: read-only, JWT-gated passthrough from R2 (`DATA_BUCKET`) to
JSON responses. See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the full
architecture contract.

## Routes

`GET /api/summary` reads `dashboard_summary.json` from R2 and returns it
as-is. Errors:

- Key missing → `503 {"error":"summary_not_available"}`
- R2 read failure → `502 {"error":"r2_read_failed"}`
- Non-`/api/*` path → `404`
- Non-`GET` method → `405`

The response carries `X-Summary-Generated-At` (best-effort, extracted via a
regex scan for `generated_at` in the artifact, not a full JSON parse) and
`Cache-Control: private, max-age=30`. Staleness is informational only — the
Worker never rejects stale data.

(Other routes — `/api/health`, `/api/diagnostics`, `/api/manifest`,
`/api/signals/latest`, `/api/verdicts` — predate this route; see
`src/index.ts`.)

## Local dev

```sh
npm install
npm run typecheck
npm test              # vitest + @cloudflare/vitest-pool-workers (real local R2 binding, mocked JWKS)
npx wrangler dev       # starts a local server with a local R2 simulation
```

`wrangler dev` gives `DATA_BUCKET` a local, on-disk R2 simulation (under
`.wrangler/state`) — no real bucket or credentials involved. Seed it with a
fixture before hitting `/api/summary`:

```sh
npx wrangler r2 object put qats-dashboard-data/dashboard_summary.json \
  --local --file=./path/to/dashboard_summary.fixture.json --content-type=application/json
```

Note: every `/api/*` route, including `/api/summary`, is gated by
`requireAccessAuth` (src/auth.ts), which validates a real
`Cf-Access-Jwt-Assertion` JWT against a live Cloudflare Access JWKS endpoint.
There's no local bypass for this — `wrangler dev` alone will return `401` for
`/api/summary` since there's no Access session issuing tokens locally. To
exercise the full request end-to-end locally, either point
`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`/`ACCESS_ALLOWED_EMAIL` at a real Access app
and pass a token from `cloudflared access token -app=<app-url>`, or rely on
the automated tests (`npm test`), which mock the JWKS response and mint a
signed token to cover the 200/503/502 cases without a live Access app.

## Deploy (operator-run — not run by this agent)

Prerequisite: the `qats-dashboard-data` R2 bucket already exists and is bound
as `DATA_BUCKET` in `wrangler.toml`.

```sh
# One-time / as-needed secrets (never committed):
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ACCESS_ALLOWED_EMAIL
# optional: npx wrangler secret put ACCESS_JWKS_TTL_SECONDS

npx wrangler deploy
```

`wrangler.toml` sets `workers_dev = false` — the `*.workers.dev` URL is
disabled entirely. The Worker is only reachable via a custom-domain route
that the operator must configure, with a Cloudflare Access policy in front of
it covering `/api/summary` (and the other `/api/*` routes) before this is
exposed anywhere.
