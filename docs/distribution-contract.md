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

## Kakao Summary v0.3.0

`kakao-summary`는 제품키 활성화를 사용하지 않는다. `activationRequired: false`는 공개 화면의 활성화 제목과 제품키 입력 안내를 제거하고 사용 준비 안내를 표시한다. `detailPoints`는 실제 업무·플랫폼·데이터 처리 설명을 초기 HTML과 동적 화면에 함께 반영한다.

플랫폼은 `macos-arm64`, `macos-x64` PKG와 `windows-x64` Setup으로 구분하고 각 asset의 `platform`은 OS 감지와 연결한다. macOS 15 이상 Apple Silicon과 Intel을 사용자가 선택하며 브라우저 값으로 CPU를 추정하지 않는다. Windows는 진단·이력 조회 전용이다. 기본 선택은 macOS Apple Silicon PKG다. 비공개 Release의 보조 ZIP은 공개 설치 선택지로 노출하지 않는다.

요약 요청 시 선택한 대화 내용은 외부 요약 API로 전송한다. API 키는 사용자가 입력하며 실행 중 메모리에만 보관하고, 요약 이력은 로컬 저장한다. `authEndpoint: null`인 동안 `availabilityNote`를 초기 HTML과 동적 화면에 표시하고 요청을 차단한다. 인증 endpoint 활성화는 독립 배포 경계 검증 이후 별도로 수행한다.
