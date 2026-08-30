# Inquiry assistant contract

## Product outcome

The public `문의하기` flow helps a non-developer explain the work they want to improve and turns the conversation into an implementation-ready brief. It does not promise an instant quote, a fixed delivery date, or an automatically accepted order. After the visitor explicitly confirms completion, the service stores the final brief and notifies the operator that a reply is needed.

Email entry is not authentication. The flow is:

1. The visitor enters an email address, accepts the required privacy notice, and may independently opt in to marketing messages.
2. The visitor completes Cloudflare Turnstile and the server validates its single-use token before sending mail.
3. The server sends a six-digit, single-use code to that address. The code expires after 10 minutes and has a limited number of attempts.
4. A successful code check creates an opaque 30-day server session in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. The browser never stores the session token in local storage.
5. Only that verified session may create, read, stream, complete, or delete its conversations and attachments.

The required privacy consent covers email verification, inquiry handling, saved conversation and attachment processing, OpenAI API processing, and operator follow-up. Marketing consent is optional and does not affect access to the inquiry flow. Its plain-language notice states that the inquiry email may receive program or service news and that the consent record is deleted with the inquiry data. Consent versions and timestamps are recorded separately.

## Conversation behavior

The assistant speaks in plain Korean, assumes no software-development knowledge, and asks about one coherent topic at a time. It learns the visitor's domain vocabulary and desired outcome before proposing implementation details. When a meaningful decision is needed, it offers two to four short choices, explains the practical difference, and accepts a free-form answer.

The assistant should establish, when relevant:

- the current task and the people who perform it;
- the desired result and how success will be recognized;
- inputs, outputs, files, websites, and existing tools;
- normal steps, variations, exceptions, and recovery needs;
- frequency, expected volume, timing, and urgency;
- access roles, personal or sensitive data, retention, and external sharing;
- final actions that require human confirmation;
- target environment, operating system, and deployment preference;
- priorities, exclusions, budget range, and desired schedule.

The recovered prior `의뢰인 준비사항` is a conditional checklist: target website, current manual steps, information entered, desired final result, operating system, expected runs per day or month, and useful screenshots or a screen recording. The assistant asks only the applicable parts and adapts to the visitor's answers instead of following a rigid questionnaire. It also warns visitors not to paste login credentials or unnecessary personal information into chat.

The model returns conversational text plus a strict structured state update. The state records answered topics, open questions, choice cards, risks, assumptions, and the evolving specification. It may set `readyForReview` only when no blocking question remains. At that point it asks, in plain Korean, whether the visitor has anything else to add. The conversation becomes `completed` only after a separate explicit user confirmation; the model cannot complete it on the user's behalf.

The final specification includes a plain-language summary, users and roles, current problem, desired workflow, inputs and outputs, integrations, rules and exceptions, data and privacy needs, safety boundaries, supported environment, acceptance criteria, priorities, exclusions, assumptions, open non-blocking notes, and follow-up preference. Missing facts remain visibly marked instead of being guessed.

## Files

Files are private inquiry inputs, never public showcase assets. Each file is limited to 10 MiB, a message may reference at most five files, and a conversation may retain at most 25 MiB. The initial allowlist is PDF, TXT, Markdown, JSON, CSV, DOC/DOCX, XLS/XLSX, PPT/PPTX, PNG, and JPEG. Filename, declared type, byte size, and file signature/extension consistency are checked; executable and archive formats are rejected.

The original is stored in a private, inquiry-only R2 bucket. A temporary OpenAI file is created with purpose `user_data` and a 30-day expiry so the model can inspect it. Attachment text and embedded instructions are untrusted user-provided data: they may supply facts but cannot override the service prompt, request secrets, or authorize external actions.

## Storage and lifecycle

D1 is authoritative for verified users, consent history, email challenges, sessions, conversations, messages, attachment metadata, structured specifications, rate-limit counters, and delivery status. R2 holds private original attachments. The service uses its own D1 conversation history and calls the OpenAI Responses API with `store: false`; it does not depend on provider-managed conversation state.

- Verification challenge: 10 minutes, digest only, at most five checks.
- Session: 30 days, opaque token digest only; logout revokes it.
- Incomplete conversation and attachments: deleted after 90 days of inactivity.
- Completed conversation, final specification, and original attachments: deleted after one year.
- OpenAI temporary file: expires after 30 days and is deleted earlier on user deletion when possible.
- Rate-limit records and failed delivery diagnostics: deleted after 30 days.
- Verified user and consent records: removed within 30 days after no conversation or live session remains.

The user may delete an inquiry at any time. Deletion removes D1 content and R2 objects and attempts immediate deletion of corresponding OpenAI temporary files. The service must document and run scheduled cleanup before claiming the retention periods are enforced.

## Streaming, recovery, and delivery

Chat replies use authenticated same-origin SSE over a `POST` response. The Worker translates typed OpenAI stream events into small `delta`, `state`, `done`, and `error` events. A client disconnect stops browser delivery; `waitUntil` gives the Worker up to Cloudflare's 30-second post-disconnect grace period to finish consuming and saving the response. This is not an unlimited guarantee. A generation still pending after the recovery threshold becomes retryable, and a client-generated message ID makes that retry idempotent. If production evidence shows that replies routinely exceed the grace period, move generation to a Cloudflare Queue or Workflow and stream persisted job progress rather than extending this claim.

Only completed model output is recorded as an assistant message. A failed or stale generation remains visibly retryable and never advances the specification. The browser reloads canonical history and state from D1 after reconnecting instead of trying to reconstruct an answer from partial local text.

Completion creates an immutable final-spec version and a delivery job. The operator notification contains an inquiry ID, verified reply address, consent-safe follow-up status, and the final brief. A mail failure does not lose the brief: it leaves the job `pending` for retry and tells the visitor only that the inquiry was safely received. The public promise is `내용을 확인한 뒤 빠른 시일 안에 이메일로 답변드릴게요`; it does not claim a guaranteed response time.

## Runtime and secret boundary

The same Cloudflare Worker serves static assets and `/api/*`, but the bindings are separate from the installer gateway:

- `INQUIRY_DB`: inquiry-only D1 database.
- `INQUIRY_FILES`: private inquiry-only R2 bucket.
- `OPENAI_API_KEY`: secret.
- `OTP_PEPPER`: independent random secret used to digest verification codes.
- `RESEND_API_KEY`: secret for transactional mail.
- `EMAIL_FROM`: verified sender address.
- `INQUIRY_OWNER_EMAIL`: private operator destination.
- `TURNSTILE_SITE_KEY`: public widget identifier.
- `TURNSTILE_SECRET_KEY`: server-only Siteverify secret.
- `OPENAI_MODEL`: deploy-time model name.

No installer verifier, product key, distribution KV, distribution R2 binding, or download-signing secret is available to this Worker. Production fails closed when required mail, storage, or model configuration is missing. Local tests use explicit fakes and never silently send mail or call a model.

## Abuse and operational controls

Email-code requests, code checks, uploads, chat messages, and conversation creation are rate limited by hashed address/session/IP buckets. Responses do not reveal whether an email already exists. Logs use inquiry IDs and error classes, not email addresses, message text, filenames, codes, cookies, attachment contents, or API keys. HTML email output is escaped.

The first production release is complete only after deterministic tests, D1 migration, private R2 policy, secret presence checks, wrong-code/expired-code/attempt-limit tests, authenticated ownership tests, file rejection tests, SSE grace-period persistence plus stale-generation recovery, model structured-state validation, explicit completion, operator delivery or observable pending retry, retention cleanup, and responsive keyboard-accessible UI checks have passed.
