# Code-gated distribution contract

The public Pages site collects an application ID, asset ID, and program-specific authorization code. It posts them over HTTPS to a separate Worker and clears the code after each attempt. No code or verifier is emitted into Pages.

Each private application repository owns an `INSTALL_ACCESS_CODE` Actions secret containing a randomly generated high-entropy code. The release workflow hashes that code, uploads already audited installers to a private R2 bucket, and updates only `code:<appId>` and `release:<appId>` in Workers KV. Raw codes must not be committed, printed, placed in GIFs, or copied into the showcase repository.

The Worker rate-limits attempts, uses constant-time digest comparison, returns a generic failure, and issues a 60-second HMAC URL for exactly one allowlisted R2 object. The bucket stays private. Rotating a project's repository secret and rerunning its publication replaces only that app's verifier.
