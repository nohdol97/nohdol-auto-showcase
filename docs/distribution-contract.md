# Multi-app, code-gated distribution contract

The public Pages site is a multi-application catalog. Its build reads `apps.json` and creates these static routes automatically:

- `/` — the application catalog
- `/apps/<appId>/` — the public description and real-workflow demo
- `/install/` — the installation chooser
- `/install/<appId>/` — the protected latest-installer form

Adding a valid catalog entry is sufficient to create both app-specific routes. The install page collects an application ID, asset ID, and program-specific authorization code. It posts them over HTTPS to a separate Worker and clears the code after each attempt. No raw code or verifier is emitted into Pages.

Each private application repository owns an `INSTALL_ACCESS_CODE` Actions secret containing a randomly generated high-entropy code. The release workflow hashes that code, temporarily disables the current manifest, overwrites the complete audited release in app-specific `latest` R2 slots, and publishes only `code:<appId>` and the completed `release:<appId>` manifest in Workers KV. Raw codes must not be committed, printed, placed in GIFs, or copied into the showcase repository. The public installer path exposes only the current release; private source Releases may retain audit history.

The Worker rate-limits attempts, uses constant-time digest comparison, returns a generic failure, and issues a 60-second HMAC URL for exactly one allowlisted R2 object. The bucket stays private. Rotating a project's repository secret and rerunning its publication replaces only that app's verifier.

## Current code issuance and one-time activation

There is no public or automatic product-key issuer. An administrator generates the next high-entropy raw code out of band, stores it as the private application repository's `INSTALL_ACCESS_CODE` GitHub Actions secret, and shares it directly with the approved user. The repository contains the secret slot and workflows, not the raw value in tracked Git files. The workflows never generate or reveal the raw code; after a secret change, an administrator runs the app's `Rotate install code` workflow to publish the new digest.

For AutoTrip, that same raw code currently publishes both `code:<appId>` for installer authorization and `activation:<appId>` for one-time product activation. An app-scoped SQLite Durable Object consumes the activation digest for one installation ID atomically; Workers KV is not the consumption authority. Electron stores only the returned opaque token through OS-backed encryption and validates it online before starting automation. Same-install retries are idempotent, while another installation is rejected. Issuing the next user a usable key therefore requires replacing `INSTALL_ACCESS_CODE` and running the rotation workflow again.
