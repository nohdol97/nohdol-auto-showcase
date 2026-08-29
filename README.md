# nohdol-auto showcase

Public GitHub Pages showcase for `nohdol-auto` desktop automations. It contains product descriptions, reviewed workflow GIFs, and a dedicated installation route for every listed program. AutoTrip demonstrates the verified program-to-site flow; the other program GIFs use deterministic demo data and continuously disclose that external systems are not connected. The site contains no installer binaries, raw codes, source application secrets, browser profiles, user configuration, or product-key administrator surface.

GitHub Pages is only the UI. A Cloudflare Worker validates the code and streams a time-limited private R2 object. Until an application's verified HTTPS `/authorize` endpoint and installer manifest exist, its install route remains visible but the download button is disabled with a `배포 준비 중` state.

For distributed products, installer authorization and product activation are separate. The public install route collects only the installer code. It tells the user to enter the independently delivered one-time product key inside the installed Electron app; Pages never issues, lists, revokes, or validates product keys.

The public UI follows the shared `nohdol-clean` visual profile: a light neutral canvas, one low-saturation accent, compact native typography, border-led depth, and no decorative gradients, glows, glass effects, or oversized hero treatment. The route hierarchy and responsive/accessibility behavior are recorded in [`docs/showcase-ux-contract.md`](docs/showcase-ux-contract.md).

The public catalog describes the everyday experience in plain Korean: clear screens, a natural order of use, visible progress, and understandable recovery guidance. Customer-facing copy does not rely on implementation terminology to explain that quality.

## Local verification

```bash
node --test
node scripts/build-pages.mjs
python3 -m http.server --directory _site 8080
```

Workflow GIFs use ephemeral browser contexts and obvious demo values. They must not show production accounts, credentials, personal data, entered payment values, booking confirmation, or a final action. Demo-only programs continuously display `기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동`; AutoTrip leaves the visible payment control untouched.
