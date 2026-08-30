# Showcase hosting contract

## Primary and legacy origins

- Primary public origin: `https://nohdol-auto-showcase.nohdol-auto-download-gateway.workers.dev`.
- Legacy bridge origin: `https://nohdol97.github.io/nohdol-auto-showcase/`.
- The primary site is generated into `_site/` and deployed as Cloudflare Workers Static Assets.
- The legacy GitHub Pages deployment remains a compatibility bridge. Its synchronous redirect preserves the route, query, and fragment while sending visitors to the primary Cloudflare origin. With JavaScript disabled, the last public static catalog remains available.

## Runtime boundary

- Static assets are served without invoking Worker code.
- This migration introduces no D1 database, API route, secret, or server-side chatbot behavior. Those bindings are added only with the chatbot behavior and retention schema.
- Installer-code validation remains owned by the independent `nohdol-auto-downloads` Worker. The showcase never receives its secrets, KV, R2, or Durable Object bindings.
- The authorization gateway allowlists both the primary and legacy showcase origins during the compatibility period. Foreign origins still fail closed.

## Build, deploy, and rollback

```bash
npm ci
npm run verify
npm run deploy
```

`npm run verify` runs the deterministic catalog regressions, generates every public route, and performs a Wrangler dry run. `npm run deploy` uses only the trusted host's Wrangler OAuth session and prints no application secret.

Rollback deploys the last verified showcase commit to the same Worker name. The legacy Pages bridge remains independently reachable throughout a failed Cloudflare deployment, and the installer gateway keeps both declared origins until the migration is explicitly retired.

## Live evidence

Migration is complete only after the Worker deployment reports the exact primary origin and public checks observe `200` for `/`, `/apps/autotrip/`, `/install/`, `/install/autotrip/`, `apps.json`, and a workflow GIF. The gateway must return an allowlisted CORS response for both declared origins and reject an unrelated origin.
