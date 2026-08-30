import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  INQUIRY_STATE_TOOL,
  PRIVACY_VERSION,
  SYSTEM_PROMPT,
  consumeOpenAIStream,
  normalizeEmail,
  sessionCookie,
  specToMarkdown,
  validateAttachment,
  validateInquiryState,
} from "../src/inquiry-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const workerSource = await readFile(path.join(root, "src", "worker.mjs"), "utf8");
const migration = await readFile(path.join(root, "migrations", "0001_inquiry_assistant.sql"), "utf8");
const html = await readFile(path.join(root, "site", "index.html"), "utf8");
const client = await readFile(path.join(root, "site", "inquiry.js"), "utf8");

const completeState = {
  readyForReview: false,
  conversationTitle: "반복 보고서 정리",
  answeredTopics: ["현재 업무"],
  openQuestions: ["결과 파일 형식"],
  choices: [{ id: "output", question: "어떤 결과가 편한가요?", options: [
    { id: "sheet", label: "엑셀", description: "표로 확인합니다." },
    { id: "mail", label: "이메일", description: "받은 편지함에서 확인합니다." },
  ] }],
  spec: {
    summary: "반복 보고서를 줄입니다.", usersAndRoles: [], currentProblem: [], desiredWorkflow: [], inputs: [], outputs: [], integrations: [],
    rulesAndExceptions: [], dataAndPrivacy: [], safetyBoundaries: [], environment: [], acceptanceCriteria: [], priorities: [], exclusions: [],
    assumptions: [], openNotes: [], followUpPreference: "이메일",
  },
};

test("[REG:inquiry.email_verification] email entry is normalized but authentication requires a one-time challenge", () => {
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), /이메일 주소/);
  assert.match(workerSource, /email_challenges/);
  assert.match(workerSource, /expiresInSeconds: 600/);
  assert.match(workerSource, /attempts >= 5/);
  assert.match(workerSource, /turnstile\/v0\/siteverify/);
  assert.match(workerSource, /TURNSTILE_SECRET_KEY/);
  assert.match(workerSource, /result\.hostname !== expectedHostname/);
  assert.match(workerSource, /result\.action !== "inquiry_email"/);
  assert.match(workerSource, /bytes\.byteLength > JSON_LIMIT/);
  assert.match(sessionCookie("opaque"), /HttpOnly; Secure; SameSite=Lax/);
});

test("[REG:inquiry.consent_separation] required service consent and optional marketing consent are independent", () => {
  assert.match(html, /id="inquiry-required-consent"[^>]*required/);
  assert.match(html, /id="inquiry-marketing-consent"/);
  assert.match(html, /<strong>필수<\/strong>/);
  assert.match(html, /<strong>선택<\/strong>/);
  assert.match(html, /동의하지 않아도 문의할 수 있고/);
  assert.match(client, new RegExp(`privacyVersion: PRIVACY_VERSION`));
  assert.equal(PRIVACY_VERSION, "2026-08-30");
  assert.match(migration, /marketing INTEGER NOT NULL CHECK \(marketing IN \(0, 1\)\)/);
});

test("[REG:inquiry.session_ownership] every conversation route authenticates and scopes records to its owner", () => {
  assert.match(workerSource, /async function authenticate/);
  assert.match(workerSource, /WHERE id = \? AND user_id = \?/);
  assert.match(workerSource, /WHERE conversation_id = \? AND user_id = \?/);
  assert.doesNotMatch(workerSource, /localStorage|sessionStorage/);
});

test("[REG:inquiry.choice_options] the strict state tool supports two to four plain-language options", () => {
  assert.equal(INQUIRY_STATE_TOOL.strict, true);
  assert.equal(INQUIRY_STATE_TOOL.parameters.additionalProperties, false);
  assert.deepEqual(INQUIRY_STATE_TOOL.parameters.required, ["readyForReview", "conversationTitle", "answeredTopics", "openQuestions", "choices", "spec"]);
  assert.equal(validateInquiryState(completeState), completeState);
  assert.match(SYSTEM_PROMPT, /2~4개의 짧은 선택지/);
  const invalid = structuredClone(completeState);
  invalid.choices[0].options = [invalid.choices[0].options[0]];
  assert.throws(() => validateInquiryState(invalid), /choice card/);
});

test("[REG:inquiry.explicit_completion] the model can mark review-ready but only the user confirmation completes", () => {
  const invalid = structuredClone(completeState);
  invalid.readyForReview = true;
  assert.throws(() => validateInquiryState(invalid), /open questions/);
  assert.match(SYSTEM_PROMPT, /직접 대화를 완료 처리하지 마세요/);
  assert.match(workerSource, /body\.confirmed !== true/);
  assert.match(workerSource, /spec\?\.ready_for_review !== 1/);
  assert.match(html, /id="inquiry-complete-check"/);
});

test("[REG:inquiry.private_attachments] allowlisted files have size and signature gates and private-only bindings", () => {
  const pdf = validateAttachment({ name: "요청.pdf", type: "application/pdf", size: 120, firstBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
  assert.equal(pdf.mediaType, "application/pdf");
  assert.throws(() => validateAttachment({ name: "run.exe", type: "application/octet-stream", size: 10, firstBytes: new Uint8Array(4) }), /지원하지 않는/);
  assert.throws(() => validateAttachment({ name: "fake.pdf", type: "application/pdf", size: 10, firstBytes: new Uint8Array(4) }), /PDF 파일/);
  assert.throws(() => validateAttachment({ name: "fake.doc", type: "application/msword", size: 10, firstBytes: new Uint8Array(8) }), /Office 파일/);
  assert.match(workerSource, /INQUIRY_FILES/);
  assert.match(workerSource, /purpose", "user_data"/);
  assert.doesNotMatch(workerSource, /nohdol-auto-installers|INSTALL_ACCESS_CODE|DOWNLOAD_SIGNING/);
});

test("[REG:inquiry.sse_persistence] typed deltas use the disconnect grace period and stale generations recover", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"안녕"}\n\n'));
    controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}\n\n'));
    controller.close();
  } });
  let text = "";
  const response = await consumeOpenAIStream(body, { onDelta(delta) { text += delta; } });
  assert.equal(text, "안녕");
  assert.deepEqual(response.output, []);
  assert.match(workerSource, /ctx\.waitUntil\(task\)/);
  assert.match(workerSource, /cancel\(\) \{ clientOpen = false; \}/);
  assert.match(workerSource, /pendingFor < 3 \* 60 \* 1000/);
  assert.match(workerSource, /generation_status = 'pending' AND created_at <= \?/);
  assert.match(workerSource, /store: false/);
});

test("final specifications preserve visibly unknown fields instead of inventing answers", () => {
  const markdown = specToMarkdown(completeState);
  assert.match(markdown, /# 반복 보고서 정리/);
  assert.match(markdown, /## 사용 환경\n\n- 아직 확인되지 않음/);
  assert.match(markdown, /## 답변 방식\n\n이메일/);
});

test("[REG:inquiry.delivery_retry] completion is durable before operator mail and failed mail stays observable", () => {
  const completionFunction = workerSource.match(/async function completeConversation[\s\S]+?\n}\n\nasync function deleteConversation/)?.[0] ?? "";
  const completedWrite = completionFunction.indexOf("UPDATE conversations SET status = 'completed'");
  const queuedDelivery = completionFunction.indexOf("ctx.waitUntil(processDeliveryJob");
  assert.ok(completedWrite > 0 && queuedDelivery > completedWrite);
  assert.match(workerSource, /status = 'failed'.*MAIL_DELIVERY_FAILED/s);
  assert.match(workerSource, /Idempotency-Key/);
  assert.match(workerSource, /attempts < 5/);
  assert.match(workerSource, /delivery: "queued"/);
});

test("[REG:inquiry.retention_cleanup] schema and scheduled cleanup enforce finite retention", () => {
  assert.match(migration, /retention_expires_at TEXT NOT NULL/);
  assert.match(workerSource, /INCOMPLETE_RETENTION_SECONDS/);
  assert.match(workerSource, /COMPLETED_RETENTION_SECONDS/);
  assert.match(workerSource, /DELETE FROM conversations WHERE id = \?/);
  assert.match(workerSource, /async scheduled/);
  assert.match(workerSource, /DELETE FROM sessions WHERE expires_at <= \?/);
  assert.match(workerSource, /DELETE FROM users WHERE updated_at <= \?/);
});
