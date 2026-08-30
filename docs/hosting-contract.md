# Showcase hosting contract

## Primary and legacy origins

- Primary public origin: `https://byabalone.com`.
- Canonical redirect origin: `https://www.byabalone.com` redirects to the apex with route and query preservation.
- Retained Workers origin: `https://nohdol-auto-showcase.nohdol-auto-download-gateway.workers.dev`.
- Legacy bridge origin: `https://nohdol97.github.io/nohdol-auto-showcase/`.
- The primary site is generated into `_site/` and deployed as Cloudflare Workers Static Assets.
- The legacy GitHub Pages deployment remains a compatibility bridge. Its synchronous redirect preserves the route, query, and fragment while sending visitors to the primary Cloudflare origin. With JavaScript disabled, the last public static catalog remains available.

## Runtime boundary

- Static assets are served from the `ASSETS` binding. Only `/api/*` and the daily retention schedule enter inquiry Worker code.
- The inquiry boundary uses the dedicated `INQUIRY_DB` D1 database and private `INQUIRY_FILES` R2 bucket. It owns email verification, server sessions, conversation/spec persistence, temporary model-file references, SSE chat, explicit completion, and operator-delivery state.
- Inquiry behavior, consent, storage, retention, and failure states are defined in [`inquiry-assistant-contract.md`](inquiry-assistant-contract.md).
- Installer-code validation remains owned by the independent `nohdol-auto-downloads` Worker. The showcase never receives its secrets, KV, R2, or Durable Object bindings.
- The authorization gateway allowlists the primary, retained Workers, and legacy GitHub Pages origins during the compatibility period. `www` serves only a redirect and receives no installer authorization. Foreign origins still fail closed.

## Build, deploy, and rollback

```bash
npm ci
npm run verify
npm run db:migrate:remote
npm run deploy
```

`npm run verify` runs deterministic catalog and inquiry regressions, generates every public route, and performs a Wrangler dry run. `npm run deploy` uses only the trusted host's Wrangler OAuth session and prints no application secret. Secret presence is checked through `/api/health` after deployment without returning secret values.

Rollback deploys the last verified showcase commit to the same Worker name. The retained Workers origin and legacy Pages bridge remain independently reachable throughout a failed custom-domain deployment, and the installer gateway keeps all three declared application origins until retirement is explicitly authorized.

## Live evidence

Migration is complete only after the Worker deployment reports the custom domains, `www` redirects to the apex, and public checks observe `200` for `/`, `/apps/autotrip/`, `/install/`, `/install/autotrip/`, `apps.json`, and a workflow GIF. `/api/health` must report ready. The installer gateway must return an allowlisted CORS response for the primary, retained Workers, and legacy GitHub Pages origins while rejecting an unrelated origin. Existing inquiry canaries remain valid only after the apex health, same-origin session, and OTP surfaces are observed.
