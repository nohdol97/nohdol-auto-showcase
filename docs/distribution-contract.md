# Code-gated distribution contract

The public Pages site collects an application ID, asset ID, and program-specific authorization code. It posts them over HTTPS to a separate Worker and clears the code after each attempt. No code or verifier is emitted into Pages.

Each private application repository owns an `INSTALL_ACCESS_CODE` Actions secret containing a randomly generated high-entropy code. The release workflow hashes that code, temporarily disables the current manifest, overwrites the complete audited release in app-specific `latest` R2 slots, and publishes only `code:<appId>` and the completed `release:<appId>` manifest in Workers KV. Raw codes must not be committed, printed, placed in GIFs, or copied into the showcase repository. The public installer path exposes only the current release; private source Releases may retain audit history.

The Worker rate-limits attempts, uses constant-time digest comparison, returns a generic failure, and issues a 60-second HMAC URL for exactly one allowlisted R2 object. The bucket stays private. Rotating a project's repository secret and rerunning its publication replaces only that app's verifier.

For applications with one-time product activation, the same raw code also publishes `activation:<appId>`. An app-scoped SQLite Durable Object consumes each digest for one installation ID atomically; Workers KV is not the consumption authority. Electron stores only the returned opaque token through OS-backed encryption and validates it online before starting automation. Same-install retries are idempotent, while another installation is rejected.
