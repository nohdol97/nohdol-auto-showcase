# Abalone showcase

Public Cloudflare Worker showcase branded as `Abalone` at `https://byabalone.com`. It presents a remote, domain-embedded custom software service: learn the customer's industry and real workflow, validate the most valuable slice, then apply and improve it within an agreed scope. It also contains reviewed program examples, a dedicated installation route for every listed program, and an email-verified AI inquiry assistant. AutoTrip demonstrates the verified program-to-site flow; the other program GIFs use deterministic demo data and continuously disclose that external systems are not connected. The site contains no installer binaries, raw codes, source application secrets, browser profiles, user configuration, or product-key administrator surface.

The private `/admin/radar/` route is a separate opportunity-research surface. It searches Kakao public business data, retains public business phone numbers, and uses OpenAI web search to separate observed public evidence from pain-point hypotheses. It never owns installer or product-key authority and never contacts a business automatically.

The showcase Worker serves public static assets and owns the inquiry API plus the separated opportunity-Radar API. Its dedicated D1 database stores verified inquiry records and isolated `radar_*` settings, runs, public-business contacts, and evidence summaries; its dedicated private R2 bucket stores only inquiry attachments. The installer gateway remains an independent Cloudflare Worker that validates download codes and streams a time-limited installer object. No inquiry or Radar binding grants access to that gateway.

The primary origin is `https://byabalone.com`. `www.byabalone.com` redirects to the apex while preserving the route and query. The former Workers origin remains reachable for shipped clients, and GitHub Pages remains a route-preserving compatibility bridge. Hosting and rollback boundaries are recorded in [`docs/hosting-contract.md`](docs/hosting-contract.md).

검색 유입은 JavaScript 실행에 의존하지 않는다. 빌드는 홈, 제작 사례, 설치 안내, 개인정보 처리방침, 이용약관의 제목·설명·본문·내부 링크를 초기 HTML에 생성하고, canonical·Open Graph·robots·sitemap과 확인된 실제 제품의 구조화 데이터만 함께 만든다. Workers 호환 origin과 GitHub Pages 브리지는 검색 결과에서 경쟁하지 않도록 noindex 처리한다. 개인정보와 약관의 코드 대응 관계, 최신 공식 근거, 유료 전자상거래 전 확인 항목은 [`docs/seo-privacy-contract.md`](docs/seo-privacy-contract.md)에 기록한다.

For distributed products, installer authorization and product activation are separate. The public install route collects only the installer code. It tells the user to enter the independently delivered one-time product key inside the installed Electron app; the public site never issues, lists, revokes, or validates product keys.

## Opportunity Radar configuration

For local development, copy `.dev.vars.example` to the ignored `.env` (or `.dev.vars`, but do not use both) and set `RADAR_ADMIN_PASSWORD` to a random value of at least 20 characters, along with `KAKAO_REST_API_KEY` and the existing `OPENAI_API_KEY`. Open the Wrangler development URL at `/admin/radar/` and enter that password. The value is compared only in the Worker and is not bundled into static JavaScript.

Production uses Cloudflare Worker secrets with the same names. Apply D1 migrations before deploying the Worker:

```sh
npm run db:migrate:remote
npx wrangler secret put RADAR_ADMIN_PASSWORD
npx wrangler secret put KAKAO_REST_API_KEY
```

`OPENAI_API_KEY` remains the shared model secret already required by the inquiry assistant. Source delivery does not apply remote migrations or deploy the Worker automatically.

The public UI keeps `nohdol-clean` as its functional UX base and applies a separate Abalone brand layer for identity tokens, logo treatment, plain-Korean voice, and evidence hierarchy. Verified external workflow evidence is separated from deterministic no-integration demonstrations; every workflow GIF begins playing directly without a separate playback control. The route hierarchy and responsive/accessibility behavior are recorded in [`docs/showcase-ux-contract.md`](docs/showcase-ux-contract.md).

The public catalog describes the service in plain Korean as `업무 이해 -> 작은 검증 -> 적용과 개선`. It does not lead with `FDE`, imply physical residency, or rely on implementation terminology. Existing product and installation routes remain truthful evidence rather than narrowing the whole service to recurring-work automation.

The inquiry assistant contract is recorded in [`docs/inquiry-assistant-contract.md`](docs/inquiry-assistant-contract.md). Email entry alone is not authentication: a six-digit code must be checked before a server session is issued. Required inquiry/privacy consent and optional marketing consent are separate. Incomplete inquiries expire after 90 days, completed inquiries after one year, and users can delete an inquiry earlier. OpenAI calls use the Responses API with `store: false`; canonical history remains in D1. The Worker selects `gpt-5.6-terra` for ordinary turns and deterministically escalates PDF/Office, multi-file, or at-least-2-MiB attachment turns to `gpt-5.6-sol`; the browser cannot choose a model.

공개 개인정보 처리방침은 [`/privacy/`](https://byabalone.com/privacy/), 이용약관은 [`/terms/`](https://byabalone.com/terms/)에 생성된다. 이 문서는 현재 구현된 문의 기능의 운영 고지이며 법률 자문이나 유료 제작 계약을 대신하지 않는다. 운영자의 법적 성명·주소·전화번호·사업자등록 정보는 저장소에서 확인되지 않았으므로 사이트에서 결제·청약을 시작하기 전에 실제 정보와 전문가 검토를 추가해야 한다.

## Local verification

```bash
npm ci
npm run verify
npm run db:migrate:local
python3 -m http.server --directory _site 8080
```

Copy `.dev.vars.example` to either the ignored `.env` or `.dev.vars` for local Worker development and replace every fake value. Never commit either file and do not use both together. Production requires `OPENAI_API_KEY`, `OTP_PEPPER`, `RESEND_API_KEY`, private `INQUIRY_OWNER_EMAIL`, `KAKAO_REST_API_KEY`, and `RADAR_ADMIN_PASSWORD` Worker secrets, plus the verified `EMAIL_FROM` deployment variable. `INQUIRY_OWNER_EMAIL` is the private inbox that receives completed specifications; it is not shown to visitors. The initial release intentionally omits Turnstile and instead applies resend cooldowns, hidden-field filtering, and hashed email/IP rate limits, so mail and request volume must be monitored for distributed abuse. Apply `npm run db:migrate:remote` before the first trusted-host `npm run deploy`.

Workflow GIFs use ephemeral browser contexts and obvious demo values. They must not show production accounts, credentials, personal data, entered payment values, booking confirmation, or a final action. Demo-only programs continuously display `기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동`; AutoTrip leaves the visible payment control untouched.
