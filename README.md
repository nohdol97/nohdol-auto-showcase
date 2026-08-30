# 한결 showcase

Public Cloudflare Worker showcase temporarily branded as `한결`. It presents a remote, domain-embedded custom software service: learn the customer's industry and real workflow, validate the most valuable slice, then apply and improve it within an agreed scope. It also contains reviewed program examples, a dedicated installation route for every listed program, and an email-verified AI inquiry assistant. AutoTrip demonstrates the verified program-to-site flow; the other program GIFs use deterministic demo data and continuously disclose that external systems are not connected. The site contains no installer binaries, raw codes, source application secrets, browser profiles, user configuration, or product-key administrator surface.

The showcase Worker serves public static assets and owns only the `/api/*` inquiry boundary. Its dedicated D1 database stores verified sessions, consent history, conversations, specifications, and delivery state; its dedicated private R2 bucket stores inquiry attachments. The installer gateway remains an independent Cloudflare Worker that validates download codes and streams a time-limited installer object. No inquiry binding or secret is shared with that gateway.

The primary origin is `https://nohdol-auto-showcase.nohdol-auto-download-gateway.workers.dev`. The former GitHub Pages origin remains a compatibility bridge and preserves each route while redirecting to Cloudflare. Hosting and rollback boundaries are recorded in [`docs/hosting-contract.md`](docs/hosting-contract.md).

For distributed products, installer authorization and product activation are separate. The public install route collects only the installer code. It tells the user to enter the independently delivered one-time product key inside the installed Electron app; the public site never issues, lists, revokes, or validates product keys.

The public UI follows the shared `nohdol-clean` visual profile: a light neutral canvas, one low-saturation accent, compact native typography, border-led depth, and no decorative gradients, glows, glass effects, or oversized hero treatment. The route hierarchy and responsive/accessibility behavior are recorded in [`docs/showcase-ux-contract.md`](docs/showcase-ux-contract.md).

The public catalog describes the service in plain Korean as `업무 이해 -> 작은 검증 -> 적용과 개선`. It does not lead with `FDE`, imply physical residency, or rely on implementation terminology. Existing product and installation routes remain truthful evidence rather than narrowing the whole service to recurring-work automation.

The inquiry assistant contract is recorded in [`docs/inquiry-assistant-contract.md`](docs/inquiry-assistant-contract.md). Email entry alone is not authentication: a six-digit code must be checked before a server session is issued. Required inquiry/privacy consent and optional marketing consent are separate. Incomplete inquiries expire after 90 days, completed inquiries after one year, and users can delete an inquiry earlier. OpenAI calls use the Responses API with `store: false`; canonical history remains in D1.

## Local verification

```bash
npm ci
npm run verify
npm run db:migrate:local
python3 -m http.server --directory _site 8080
```

Copy `.dev.vars.example` to the ignored `.dev.vars` only for local Worker development and replace every fake value. Never commit that file. Production requires `OPENAI_API_KEY`, `OTP_PEPPER`, `RESEND_API_KEY`, and `TURNSTILE_SECRET_KEY` as Worker secrets, plus a verified `EMAIL_FROM`, private `INQUIRY_OWNER_EMAIL`, and hostname-restricted `TURNSTILE_SITE_KEY` configuration. The committed Turnstile values are official testing keys only and must never reach production. Apply `npm run db:migrate:remote` before the first trusted-host `npm run deploy`.

Workflow GIFs use ephemeral browser contexts and obvious demo values. They must not show production accounts, credentials, personal data, entered payment values, booking confirmation, or a final action. Demo-only programs continuously display `기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동`; AutoTrip leaves the visible payment control untouched.
