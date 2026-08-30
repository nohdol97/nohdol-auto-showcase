import {
  COMPLETED_RETENTION_SECONDS,
  INCOMPLETE_RETENTION_SECONDS,
  MAX_CONVERSATION_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  OPENAI_FILE_SECONDS,
  PRIVACY_VERSION,
  SESSION_COOKIE,
  SESSION_SECONDS,
  SYSTEM_PROMPT,
  INQUIRY_STATE_TOOL,
  HttpError,
  assertSameOrigin,
  clearSessionCookie,
  consumeOpenAIStream,
  errorResponse,
  extractInquiryState,
  hmacHex,
  hasFilledInquiryTrap,
  isoAfter,
  json,
  normalizeEmail,
  openAIInput,
  parseCookies,
  randomCode,
  randomToken,
  safeEqual,
  sessionCookie,
  sha256,
  specToMarkdown,
  sseEvent,
  validateAttachment,
  validateInquiryFormTiming,
} from "./inquiry-core.mjs";

const JSON_LIMIT = 64 * 1024;
const MODEL_TIMEOUT_MS = 120_000;

function now() {
  return new Date().toISOString();
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new HttpError(503, "SERVICE_NOT_CONFIGURED", "문의 서비스를 준비하고 있습니다.");
  return value;
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > JSON_LIMIT) throw new HttpError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 깁니다.");
  let value;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > JSON_LIMIT) throw new HttpError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 깁니다.");
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  return value;
}

function db(env) {
  return required(env, "INQUIRY_DB");
}

async function all(statement) {
  const result = await statement.all();
  return result.results ?? [];
}

function publicUser(user) {
  return { email: user.email, verifiedAt: user.verified_at };
}

async function digestRateKey(env, kind, value) {
  return sha256(`${kind}:${value}:${required(env, "OTP_PEPPER")}`);
}

async function rateLimit(env, kind, value, maximum, windowSeconds) {
  const instant = Date.now();
  const bucketMs = windowSeconds * 1000;
  const bucketStart = new Date(Math.floor(instant / bucketMs) * bucketMs).toISOString();
  const limitKey = await digestRateKey(env, kind, value);
  const row = await db(env).prepare(
    `INSERT INTO rate_limits (limit_key, bucket_start, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(limit_key, bucket_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(limitKey, bucketStart, isoAfter(windowSeconds * 2, instant)).first();
  if (Number(row?.count ?? maximum + 1) > maximum) throw new HttpError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
}

function clientAddress(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function sendMail(env, message, idempotencyKey) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required(env, "RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: required(env, "EMAIL_FROM"), ...message }),
  });
  if (!response.ok) throw new Error(`mail provider status ${response.status}`);
}

async function sendVerificationCode(env, email, code, challengeId) {
  await sendMail(env, {
    to: [email],
    subject: "[Abalone] 문의 이메일 확인 코드",
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;line-height:1.6"><h1 style="font-size:20px">이메일을 확인해 주세요</h1><p>Abalone 문의창에 아래 6자리 코드를 입력해 주세요.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p><p>코드는 10분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 메일을 무시해 주세요.</p></div>`,
  }, `verification/${challengeId}`);
}

async function requestCode(request, env) {
  assertSameOrigin(request);
  const body = await readJson(request);
  if (hasFilledInquiryTrap(body.website)) {
    return json({ challengeId: crypto.randomUUID(), expiresInSeconds: 600, message: "확인 코드를 보냈습니다." }, 202);
  }
  validateInquiryFormTiming(body.formStartedAt);
  const email = normalizeEmail(body.email);
  if (body.requiredService !== true || body.privacyVersion !== PRIVACY_VERSION) throw new HttpError(400, "PRIVACY_CONSENT_REQUIRED", "필수 개인정보 안내를 확인하고 동의해 주세요.");
  const latestChallenge = await db(env).prepare("SELECT created_at FROM email_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (latestChallenge && Date.parse(latestChallenge.created_at) > Date.now() - 60_000) {
    throw new HttpError(429, "CODE_RESEND_COOLDOWN", "확인 메일은 1분 뒤에 다시 요청할 수 있습니다.");
  }
  await rateLimit(env, "otp-ip-short", clientAddress(request), 3, 15 * 60);
  await rateLimit(env, "otp-ip-day", clientAddress(request), 20, 24 * 60 * 60);
  await rateLimit(env, "otp-email", email, 3, 30 * 60);
  await rateLimit(env, "otp-email-day", email, 6, 24 * 60 * 60);
  const id = crypto.randomUUID();
  const code = randomCode();
  const codeDigest = await hmacHex(required(env, "OTP_PEPPER"), `${id}:${email}:${code}`);
  const createdAt = now();
  await db(env).prepare(
    `INSERT INTO email_challenges (id, email, code_digest, required_service, marketing, privacy_version, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)`,
  ).bind(id, email, body.marketing === true ? 1 : 0, PRIVACY_VERSION, isoAfter(10 * 60), createdAt).run();
  try {
    await sendVerificationCode(env, email, code, id);
  } catch (error) {
    await db(env).prepare("DELETE FROM email_challenges WHERE id = ?").bind(id).run();
    throw new HttpError(503, "EMAIL_DELIVERY_FAILED", "확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return json({ challengeId: id, expiresInSeconds: 600, message: "확인 코드를 보냈습니다." }, 202);
}

async function verifyCode(request, env) {
  assertSameOrigin(request);
  const body = await readJson(request);
  const challengeId = String(body.challengeId ?? "");
  const code = String(body.code ?? "").trim();
  if (!/^[0-9]{6}$/.test(code) || !challengeId) throw new HttpError(400, "INVALID_CODE", "6자리 확인 코드를 입력해 주세요.");
  await rateLimit(env, "verify-ip", clientAddress(request), 20, 15 * 60);
  const challenge = await db(env).prepare("SELECT * FROM email_challenges WHERE id = ?").bind(challengeId).first();
  if (!challenge || challenge.expires_at <= now()) {
    if (challenge) await db(env).prepare("DELETE FROM email_challenges WHERE id = ?").bind(challengeId).run();
    throw new HttpError(410, "CODE_EXPIRED", "확인 코드가 만료되었습니다. 새 코드를 받아 주세요.");
  }
  if (challenge.attempts >= 5) throw new HttpError(429, "CODE_ATTEMPTS_EXCEEDED", "확인 횟수를 초과했습니다. 새 코드를 받아 주세요.");
  const candidate = await hmacHex(required(env, "OTP_PEPPER"), `${challenge.id}:${challenge.email}:${code}`);
  if (!safeEqual(candidate, challenge.code_digest)) {
    await db(env).prepare("UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ?").bind(challenge.id).run();
    throw new HttpError(401, "INVALID_CODE", "확인 코드가 맞지 않습니다.");
  }

  const existing = await db(env).prepare("SELECT id FROM users WHERE email = ?").bind(challenge.email).first();
  const userId = existing?.id ?? crypto.randomUUID();
  const token = randomToken();
  const tokenDigest = await sha256(token);
  const timestamp = now();
  await db(env).batch([
    db(env).prepare(
      `INSERT INTO users (id, email, verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    ).bind(userId, challenge.email, timestamp, timestamp, timestamp),
    db(env).prepare(
      "INSERT INTO consent_events (id, user_id, privacy_version, required_service, marketing, recorded_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(crypto.randomUUID(), userId, challenge.privacy_version, challenge.marketing, timestamp),
    db(env).prepare("DELETE FROM email_challenges WHERE email = ?").bind(challenge.email),
    db(env).prepare("INSERT INTO sessions (token_digest, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tokenDigest, userId, isoAfter(SESSION_SECONDS), timestamp, timestamp),
  ]);
  return json({ authenticated: true, user: { email: challenge.email, verifiedAt: timestamp } }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function authenticate(request, env) {
  const token = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (!token) throw new HttpError(401, "AUTH_REQUIRED", "이메일 확인이 필요합니다.");
  const digest = await sha256(token);
  const user = await db(env).prepare(
    `SELECT users.id, users.email, users.verified_at, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_digest = ?`,
  ).bind(digest).first();
  if (!user || user.expires_at <= now()) {
    await db(env).prepare("DELETE FROM sessions WHERE token_digest = ?").bind(digest).run();
    throw new HttpError(401, "SESSION_EXPIRED", "이메일 확인 시간이 만료되었습니다. 다시 확인해 주세요.");
  }
  await db(env).prepare("UPDATE sessions SET last_seen_at = ? WHERE token_digest = ?").bind(now(), digest).run();
  return { ...user, tokenDigest: digest };
}

async function sessionStatus(request, env) {
  try {
    const user = await authenticate(request, env);
    return json({ authenticated: true, user: publicUser(user) });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return json({ authenticated: false });
    throw error;
  }
}

async function logout(request, env) {
  assertSameOrigin(request);
  const token = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (token) await db(env).prepare("DELETE FROM sessions WHERE token_digest = ?").bind(await sha256(token)).run();
  return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function ownedConversation(env, userId, conversationId) {
  const conversation = await db(env).prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").bind(conversationId, userId).first();
  if (!conversation) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "문의 내용을 찾을 수 없습니다.");
  return conversation;
}

function parseSpec(row) {
  if (!row) return null;
  return { ...JSON.parse(row.spec_json), markdown: row.spec_markdown, version: row.version, finalizedAt: row.finalized_at };
}

async function listConversations(request, env) {
  const user = await authenticate(request, env);
  const rows = await all(db(env).prepare("SELECT id, title, status, created_at, updated_at, completed_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20").bind(user.id));
  return json({ conversations: rows.map((row) => ({ id: row.id, title: row.title, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at })) });
}

async function createConversation(request, env) {
  assertSameOrigin(request);
  const user = await authenticate(request, env);
  await rateLimit(env, "conversation", user.id, 10, 24 * 60 * 60);
  const id = crypto.randomUUID();
  const timestamp = now();
  await db(env).prepare(
    "INSERT INTO conversations (id, user_id, status, title, created_at, updated_at, retention_expires_at) VALUES (?, ?, 'collecting', ?, ?, ?, ?)",
  ).bind(id, user.id, "새 프로그램 문의", timestamp, timestamp, isoAfter(INCOMPLETE_RETENTION_SECONDS)).run();
  return json({ conversation: { id, title: "새 프로그램 문의", status: "collecting", messages: [], spec: null } }, 201);
}

async function getConversation(request, env, conversationId) {
  const user = await authenticate(request, env);
  const conversation = await ownedConversation(env, user.id, conversationId);
  const messages = await all(db(env).prepare("SELECT id, role, content, generation_status, created_at FROM messages WHERE conversation_id = ? AND generation_status != 'failed' ORDER BY created_at, rowid").bind(conversationId));
  const attachments = await all(db(env).prepare("SELECT id, filename, media_type, byte_size, created_at FROM attachments WHERE conversation_id = ? ORDER BY created_at").bind(conversationId));
  const spec = await db(env).prepare("SELECT * FROM requirement_specs WHERE conversation_id = ?").bind(conversationId).first();
  return json({
    conversation: { id: conversation.id, title: conversation.title, status: conversation.status, createdAt: conversation.created_at, updatedAt: conversation.updated_at, completedAt: conversation.completed_at },
    messages: messages.map((item) => ({ id: item.id, role: item.role, content: item.content, status: item.generation_status, createdAt: item.created_at })),
    attachments: attachments.map((item) => ({ id: item.id, filename: item.filename, mediaType: item.media_type, byteSize: item.byte_size, createdAt: item.created_at })),
    spec: parseSpec(spec),
  });
}

async function uploadOpenAIFile(env, file, filename, mediaType) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", String(OPENAI_FILE_SECONDS));
  form.append("file", new File([file], filename, { type: mediaType }));
  const response = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${required(env, "OPENAI_API_KEY")}` }, body: form });
  if (!response.ok) throw new Error(`OpenAI file status ${response.status}`);
  const result = await response.json();
  if (!result.id) throw new Error("OpenAI file id missing");
  return result.id;
}

async function deleteOpenAIFile(env, fileId) {
  if (!fileId || !env.OPENAI_API_KEY) return;
  await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
}

async function uploadAttachment(request, env, conversationId) {
  assertSameOrigin(request);
  const user = await authenticate(request, env);
  const conversation = await ownedConversation(env, user.id, conversationId);
  if (conversation.status === "completed") throw new HttpError(409, "CONVERSATION_COMPLETED", "완료된 문의에는 파일을 추가할 수 없습니다.");
  await rateLimit(env, "upload", user.id, 30, 60 * 60);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "FILE_REQUIRED", "추가할 파일을 선택해 주세요.");
  const bytes = await file.arrayBuffer();
  const validated = validateAttachment({ name: file.name, type: file.type, size: file.size, firstBytes: bytes.slice(0, 16) });
  const quota = await db(env).prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM attachments WHERE conversation_id = ?").bind(conversationId).first();
  if (Number(quota?.total ?? 0) + file.size > MAX_CONVERSATION_FILE_BYTES) throw new HttpError(413, "CONVERSATION_FILE_LIMIT", "한 문의에는 파일을 합해 25MB까지 보관할 수 있습니다.");
  const id = crypto.randomUUID();
  const objectKey = `${user.id}/${conversationId}/${id}`;
  let openaiFileId;
  try {
    openaiFileId = await uploadOpenAIFile(env, bytes, validated.filename, validated.mediaType);
    await required(env, "INQUIRY_FILES").put(objectKey, bytes, { httpMetadata: { contentType: validated.mediaType }, customMetadata: { attachmentId: id } });
    const timestamp = now();
    await db(env).prepare(
      `INSERT INTO attachments (id, conversation_id, user_id, object_key, filename, media_type, byte_size, openai_file_id, openai_expires_at, created_at, retention_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, conversationId, user.id, objectKey, validated.filename, validated.mediaType, file.size, openaiFileId, isoAfter(OPENAI_FILE_SECONDS), timestamp, conversation.retention_expires_at).run();
    return json({ attachment: { id, filename: validated.filename, mediaType: validated.mediaType, byteSize: file.size } }, 201);
  } catch (error) {
    if (openaiFileId) await deleteOpenAIFile(env, openaiFileId).catch(() => {});
    await env.INQUIRY_FILES?.delete(objectKey).catch(() => {});
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "FILE_PROCESSING_FAILED", "파일을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function currentState(env, conversationId) {
  const row = await db(env).prepare("SELECT * FROM requirement_specs WHERE conversation_id = ?").bind(conversationId).first();
  return parseSpec(row);
}

function replayStream(assistant, state) {
  const body = `${sseEvent("delta", { text: assistant.content })}${state ? sseEvent("state", state) : ""}${sseEvent("done", { messageId: assistant.id })}`;
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function beginMessage(request, env, ctx, conversationId) {
  assertSameOrigin(request);
  const user = await authenticate(request, env);
  const conversation = await ownedConversation(env, user.id, conversationId);
  if (conversation.status === "completed") throw new HttpError(409, "CONVERSATION_COMPLETED", "이미 완료된 문의입니다.");
  await rateLimit(env, "chat", user.id, 60, 60 * 60);
  const body = await readJson(request);
  const content = String(body.content ?? "").trim();
  const clientMessageId = String(body.clientMessageId ?? "");
  const attachmentIds = Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds.map(String))] : [];
  if (!content || content.length > 8_000) throw new HttpError(400, "INVALID_MESSAGE", "메시지는 1자 이상 8,000자 이하로 입력해 주세요.");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientMessageId)) throw new HttpError(400, "INVALID_MESSAGE_ID", "메시지 식별값을 확인할 수 없습니다.");
  if (attachmentIds.length > MAX_FILES_PER_MESSAGE) throw new HttpError(400, "TOO_MANY_FILES", "한 번에 파일을 5개까지 보낼 수 있습니다.");

  const assistantClientId = `${clientMessageId}:assistant`;
  const previousUser = await db(env).prepare("SELECT * FROM messages WHERE conversation_id = ? AND client_message_id = ?").bind(conversationId, clientMessageId).first();
  const previousAssistant = await db(env).prepare("SELECT * FROM messages WHERE conversation_id = ? AND client_message_id = ?").bind(conversationId, assistantClientId).first();
  if (previousUser && previousAssistant?.generation_status === "completed") return replayStream(previousAssistant, await currentState(env, conversationId));
  if (previousAssistant?.generation_status === "pending") {
    const pendingFor = Date.now() - new Date(previousAssistant.created_at).getTime();
    if (pendingFor < 3 * 60 * 1000) throw new HttpError(409, "MESSAGE_IN_PROGRESS", "답변을 만들고 있습니다. 잠시 후 다시 확인해 주세요.");
    await db(env).prepare("UPDATE messages SET generation_status = 'failed' WHERE id = ? AND generation_status = 'pending'").bind(previousAssistant.id).run();
    previousAssistant.generation_status = "failed";
  }

  let attachments = [];
  if (attachmentIds.length) {
    const placeholders = attachmentIds.map(() => "?").join(",");
    attachments = await all(db(env).prepare(
      `SELECT id, media_type, openai_file_id, openai_expires_at FROM attachments WHERE conversation_id = ? AND user_id = ? AND id IN (${placeholders})`,
    ).bind(conversationId, user.id, ...attachmentIds));
    if (attachments.length !== attachmentIds.length || attachments.some((item) => !item.openai_file_id || item.openai_expires_at <= now())) throw new HttpError(400, "INVALID_ATTACHMENT", "파일을 다시 추가해 주세요.");
  }

  const userMessageId = previousUser?.id ?? crypto.randomUUID();
  const assistantMessageId = previousAssistant?.id ?? crypto.randomUUID();
  const timestamp = now();
  const statements = [];
  if (!previousUser) {
    statements.push(db(env).prepare(
      "INSERT INTO messages (id, conversation_id, role, content, client_message_id, generation_status, created_at) VALUES (?, ?, 'user', ?, ?, 'completed', ?)",
    ).bind(userMessageId, conversationId, content, clientMessageId, timestamp));
    for (const attachment of attachments) statements.push(db(env).prepare("INSERT INTO message_attachments (message_id, attachment_id) VALUES (?, ?)").bind(userMessageId, attachment.id));
  }
  if (previousAssistant) statements.push(db(env).prepare("UPDATE messages SET content = '', generation_status = 'pending', model = NULL WHERE id = ?").bind(assistantMessageId));
  else statements.push(db(env).prepare(
    "INSERT INTO messages (id, conversation_id, role, content, client_message_id, generation_status, created_at) VALUES (?, ?, 'assistant', '', ?, 'pending', ?)",
  ).bind(assistantMessageId, conversationId, assistantClientId, timestamp));
  statements.push(db(env).prepare("UPDATE conversations SET updated_at = ?, retention_expires_at = ? WHERE id = ?").bind(timestamp, isoAfter(INCOMPLETE_RETENTION_SECONDS), conversationId));
  await db(env).batch(statements);

  const history = await all(db(env).prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND generation_status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 40",
  ).bind(conversationId));
  history.reverse();
  const priorState = await currentState(env, conversationId);
  return streamModelReply({ env, ctx, conversationId, assistantMessageId, history, attachments, priorState });
}

async function callOpenAI(env, history, attachments, priorState, signal) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${required(env, "OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: required(env, "OPENAI_MODEL"),
      store: false,
      stream: true,
      max_output_tokens: 4000,
      instructions: `${SYSTEM_PROMPT}\n\n현재 저장된 구조화 상태입니다. 새 답변을 반영해 전체 상태를 다시 반환하세요. 이메일 주소는 모델에 전달되지 않습니다.\n${JSON.stringify(priorState ?? { readyForReview: false, note: "아직 저장된 상태 없음" })}`,
      input: openAIInput(history, attachments),
      tools: [INQUIRY_STATE_TOOL],
      tool_choice: "auto",
    }),
    signal,
  });
  if (!response.ok) throw new Error(`OpenAI response status ${response.status}`);
  return response;
}

function streamModelReply({ env, ctx, conversationId, assistantMessageId, history, attachments, priorState }) {
  const encoder = new TextEncoder();
  let clientOpen = true;
  let controller;
  const stream = new ReadableStream({
    start(value) { controller = value; },
    cancel() { clientOpen = false; },
  });
  const emit = (event, data) => {
    if (!clientOpen) return;
    try { controller.enqueue(encoder.encode(sseEvent(event, data))); } catch { clientOpen = false; }
  };
  const task = (async () => {
    let output = "";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
    try {
      const response = await callOpenAI(env, history, attachments, priorState, abort.signal);
      const completed = await consumeOpenAIStream(response.body, { onDelta(delta) { output += delta; emit("delta", { text: delta }); } });
      if (!output.trim()) throw new Error("OpenAI response text missing");
      const state = extractInquiryState(completed);
      const markdown = specToMarkdown(state);
      const timestamp = now();
      const status = state.readyForReview ? "review_ready" : "collecting";
      await db(env).batch([
        db(env).prepare("UPDATE messages SET content = ?, generation_status = 'completed', model = ? WHERE id = ?")
          .bind(output, required(env, "OPENAI_MODEL"), assistantMessageId),
        db(env).prepare(
          `INSERT INTO requirement_specs (conversation_id, version, ready_for_review, spec_json, spec_markdown, updated_at)
           VALUES (?, 1, ?, ?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET version = version + 1, ready_for_review = excluded.ready_for_review,
           spec_json = excluded.spec_json, spec_markdown = excluded.spec_markdown, updated_at = excluded.updated_at`,
        ).bind(conversationId, state.readyForReview ? 1 : 0, JSON.stringify(state), markdown, timestamp),
        db(env).prepare("UPDATE conversations SET title = ?, status = ?, updated_at = ?, retention_expires_at = ? WHERE id = ? AND status != 'completed'")
          .bind(state.conversationTitle.slice(0, 100), status, timestamp, isoAfter(INCOMPLETE_RETENTION_SECONDS), conversationId),
      ]);
      emit("state", { ...state, markdown });
      emit("done", { messageId: assistantMessageId });
    } catch {
      await db(env).prepare("UPDATE messages SET generation_status = 'failed' WHERE id = ?").bind(assistantMessageId).run();
      emit("error", { code: "REPLY_FAILED", message: "답변을 만들지 못했습니다. 같은 메시지로 다시 시도해 주세요." });
    } finally {
      clearTimeout(timer);
      if (clientOpen) { try { controller.close(); } catch {} }
    }
  })();
  ctx.waitUntil(task);
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
}

async function notifyOwner(env, conversationId, deliveryId) {
  const item = await db(env).prepare(
    `SELECT conversations.id, users.email, requirement_specs.spec_markdown
     FROM conversations JOIN users ON users.id = conversations.user_id
     JOIN requirement_specs ON requirement_specs.conversation_id = conversations.id
     WHERE conversations.id = ?`,
  ).bind(conversationId).first();
  if (!item) throw new Error("completed inquiry missing");
  await sendMail(env, {
    to: [required(env, "INQUIRY_OWNER_EMAIL")],
    reply_to: item.email,
    subject: `[Abalone 문의] ${item.id}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;line-height:1.6"><h1 style="font-size:20px">새 프로그램 문의가 완료되었습니다</h1><p><strong>문의 ID:</strong> ${escapeHtml(item.id)}</p><p><strong>회신 이메일:</strong> ${escapeHtml(item.email)}</p><pre style="white-space:pre-wrap;font:inherit;background:#f5f7fa;padding:16px;border-radius:8px">${escapeHtml(item.spec_markdown)}</pre></div>`,
  }, `inquiry-delivery/${deliveryId}`);
}

async function processDeliveryJob(env, job) {
  try {
    await notifyOwner(env, job.conversation_id, job.id);
    const timestamp = now();
    await db(env).prepare("UPDATE delivery_jobs SET status = 'sent', attempts = attempts + 1, sent_at = ?, updated_at = ?, last_error_class = NULL WHERE id = ?")
      .bind(timestamp, timestamp, job.id).run();
  } catch {
    await db(env).prepare("UPDATE delivery_jobs SET status = 'failed', attempts = attempts + 1, updated_at = ?, last_error_class = 'MAIL_DELIVERY_FAILED' WHERE id = ?")
      .bind(now(), job.id).run();
  }
}

async function completeConversation(request, env, ctx, conversationId) {
  assertSameOrigin(request);
  const user = await authenticate(request, env);
  const conversation = await ownedConversation(env, user.id, conversationId);
  const body = await readJson(request);
  if (body.confirmed !== true) throw new HttpError(400, "COMPLETION_CONFIRMATION_REQUIRED", "완료 여부를 확인해 주세요.");
  if (conversation.status === "completed") return json({ completed: true, delivery: "already_recorded" });
  const spec = await db(env).prepare("SELECT ready_for_review FROM requirement_specs WHERE conversation_id = ?").bind(conversationId).first();
  if (spec?.ready_for_review !== 1) throw new HttpError(409, "SPEC_NOT_READY", "아직 확인할 내용이 남아 있습니다.");
  const timestamp = now();
  const deliveryId = crypto.randomUUID();
  await db(env).batch([
    db(env).prepare("UPDATE conversations SET status = 'completed', completed_at = ?, updated_at = ?, retention_expires_at = ? WHERE id = ?")
      .bind(timestamp, timestamp, isoAfter(COMPLETED_RETENTION_SECONDS), conversationId),
    db(env).prepare("UPDATE attachments SET retention_expires_at = ? WHERE conversation_id = ?").bind(isoAfter(COMPLETED_RETENTION_SECONDS), conversationId),
    db(env).prepare("UPDATE requirement_specs SET finalized_at = ? WHERE conversation_id = ?").bind(timestamp, conversationId),
    db(env).prepare("INSERT INTO delivery_jobs (id, conversation_id, status, attempts, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?)")
      .bind(deliveryId, conversationId, timestamp, timestamp),
  ]);
  ctx.waitUntil(processDeliveryJob(env, { id: deliveryId, conversation_id: conversationId }));
  return json({ completed: true, delivery: "queued", message: "문의가 안전하게 저장되었습니다. 내용을 확인한 뒤 빠른 시일 안에 이메일로 답변드릴게요." });
}

async function deleteConversation(request, env, conversationId) {
  assertSameOrigin(request);
  const user = await authenticate(request, env);
  await ownedConversation(env, user.id, conversationId);
  const attachments = await all(db(env).prepare("SELECT object_key, openai_file_id FROM attachments WHERE conversation_id = ?").bind(conversationId));
  if (attachments.length) await required(env, "INQUIRY_FILES").delete(attachments.map((item) => item.object_key));
  await Promise.allSettled(attachments.map((item) => deleteOpenAIFile(env, item.openai_file_id)));
  await db(env).prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").bind(conversationId, user.id).run();
  return json({ deleted: true });
}

async function cleanupExpired(env) {
  const expired = await all(db(env).prepare("SELECT id, user_id FROM conversations WHERE retention_expires_at <= ? LIMIT 100").bind(now()));
  for (const conversation of expired) {
    const attachments = await all(db(env).prepare("SELECT object_key, openai_file_id FROM attachments WHERE conversation_id = ?").bind(conversation.id));
    if (attachments.length) await env.INQUIRY_FILES.delete(attachments.map((item) => item.object_key));
    await Promise.allSettled(attachments.map((item) => deleteOpenAIFile(env, item.openai_file_id)));
    await db(env).prepare("DELETE FROM conversations WHERE id = ?").bind(conversation.id).run();
  }
  await db(env).batch([
    db(env).prepare("DELETE FROM email_challenges WHERE expires_at <= ?").bind(now()),
    db(env).prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now()),
    db(env).prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(now()),
    db(env).prepare("UPDATE messages SET generation_status = 'failed' WHERE generation_status = 'pending' AND created_at <= ?").bind(isoAfter(-5 * 60)),
    db(env).prepare(
      `DELETE FROM users WHERE updated_at <= ?
       AND NOT EXISTS (SELECT 1 FROM conversations WHERE conversations.user_id = users.id)
       AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.user_id = users.id)`,
    ).bind(isoAfter(-30 * 24 * 60 * 60)),
  ]);
  const deliveries = await all(db(env).prepare("SELECT id, conversation_id FROM delivery_jobs WHERE status IN ('pending', 'failed') AND attempts < 5 ORDER BY created_at LIMIT 20"));
  for (const delivery of deliveries) await processDeliveryJob(env, delivery);
}

async function api(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (url.pathname === "/api/health" && method === "GET") {
    const configured = Boolean(env.INQUIRY_DB && env.INQUIRY_FILES && env.OPENAI_API_KEY && env.OPENAI_MODEL && env.OTP_PEPPER && env.RESEND_API_KEY && env.EMAIL_FROM && env.INQUIRY_OWNER_EMAIL);
    return json({ status: configured ? "ready" : "configuration_required" }, configured ? 200 : 503);
  }
  if (url.pathname === "/api/auth/request-code" && method === "POST") return requestCode(request, env);
  if (url.pathname === "/api/auth/verify-code" && method === "POST") return verifyCode(request, env);
  if (url.pathname === "/api/auth/session" && method === "GET") return sessionStatus(request, env);
  if (url.pathname === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (url.pathname === "/api/conversations" && method === "GET") return listConversations(request, env);
  if (url.pathname === "/api/conversations" && method === "POST") return createConversation(request, env);
  const match = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]+)(?:\/(attachments|messages|complete))?$/i);
  if (match) {
    const [, conversationId, action] = match;
    if (!action && method === "GET") return getConversation(request, env, conversationId);
    if (!action && method === "DELETE") return deleteConversation(request, env, conversationId);
    if (action === "attachments" && method === "POST") return uploadAttachment(request, env, conversationId);
    if (action === "messages" && method === "POST") return beginMessage(request, env, ctx, conversationId);
    if (action === "complete" && method === "POST") return completeConversation(request, env, ctx, conversationId);
  }
  throw new HttpError(404, "API_NOT_FOUND", "요청한 기능을 찾을 수 없습니다.");
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env, ctx);
      return required(env, "ASSETS").fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  },
};

export { api, cleanupExpired };
