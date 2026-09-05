# Multi-app, code-gated distribution contract

The public static showcase is a multi-application catalog. Its build reads `apps.json` and creates these routes automatically:

- `/` — the application catalog
- `/apps/<appId>/` — the public description and real-workflow demo
- `/install/` — the installation chooser
- `/install/<appId>/` — the protected latest-installer form or a disabled install preview

Adding a valid catalog entry is sufficient to create both app-specific routes. Each entry declares a `defaultAssetId` that must reference one of its allowlisted installer assets. The install form maps the browser-reported desktop platform to an allowlisted asset and uses the declared default when the platform is mobile, unknown, or unavailable for that application. A distributed product posts the application ID, asset ID, and program-specific authorization code over HTTPS to a separate Worker and clears the code after each attempt. An explicitly requested install preview keeps `authEndpoint: null`, disables submission, and makes no request. No raw code or verifier is emitted into the static host.

Each private application repository owns an `INSTALL_ACCESS_CODE` Actions secret containing a randomly generated high-entropy installer code. The release workflow hashes that code, temporarily disables the current manifest, overwrites the complete audited release in app-specific `latest` R2 slots, and publishes only `code:<appId>` and the completed `release:<appId>` manifest in Workers KV. Raw codes must not be committed, printed, placed in GIFs, or copied into the showcase repository. The public installer path exposes only the current release; private source Releases may retain audit history.

The Worker rate-limits attempts, uses constant-time digest comparison, returns a generic failure, and issues a 60-second HMAC URL for exactly one allowlisted R2 object. The bucket stays private. Rotating a project's repository secret and rerunning its publication replaces only that app's verifier.

## Independent one-time activation

Product keys never share `INSTALL_ACCESS_CODE`. An authenticated Worker administrator API can issue multiple independent keys per application. It generates each raw key server-side, returns it only in the issue response, and writes only the SHA-256 digest plus lifecycle metadata to that application's Durable Object. The local administrator CLI shows the raw key once and uses a macOS Keychain credential whose digest is stored as a Worker secret.

Each app-named SQLite Durable Object keeps its own `unused`, `used`, and `revoked` records with issue/use/revocation timestamps. It consumes an unused digest for one installation ID atomically, returns the same opaque token to the same installation's retry, rejects a different installation, and invalidates the token if the key is revoked. Electron stores only the returned token through OS-backed encryption and validates it online before starting automation. Legacy token-digest reads preserve already activated AutoTrip installations.

The public install route contains only the user installation and in-app activation instructions. It has no distribution administrator credential, issue form, key list, or revoke control, and it never sends a product key from browser JavaScript. The separate `/admin/radar/` opportunity-research route has no distribution binding or product-key authority.
