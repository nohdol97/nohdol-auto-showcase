# nohdol-auto showcase

Public GitHub Pages showcase for `nohdol-auto` desktop automations. It contains static descriptions, reviewed workflow GIFs that begin in the real program UI and continue on the actual site with obvious fake values, and an authorization-code form. It contains no installer binaries, raw codes, source application secrets, browser profiles, or user configuration.

GitHub Pages is only the UI. A Cloudflare Worker validates the code and streams a time-limited private R2 object. Until an application's verified HTTPS `/authorize` endpoint is recorded in `apps.json`, its download button remains disabled.

## Local verification

```bash
node --test
node scripts/build-pages.mjs
python3 -m http.server --directory _site 8080
```

Workflow GIFs use ephemeral browser contexts and obvious fake identity/contact values. They must not show production accounts, credentials, personal data, entered payment values, booking confirmation, or a final action; the visible payment control remains untouched.
