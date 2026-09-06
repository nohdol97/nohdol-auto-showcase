import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("../site/admin/radar/radar.js", import.meta.url), "utf8");
const html = await readFile(new URL("../site/admin/radar/index.html", import.meta.url), "utf8");

class Node {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; this.value = ""; this.disabled = false; this.hidden = false; this.attributes = {}; this.ownText = ""; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((node) => node.textContent).join(" "); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.ownText = ""; this.children = nodes; }
  addEventListener(name, listener) { this.events[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  querySelector() { return this.children[0] ??= new Node("button"); }
  querySelectorAll() { return this.children; }
}

function mount(data, post = async () => ({ status: 202, body: {} })) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [`#${match[1]}`, new Node()]));
  const requests = [];
  const timers = [];
  const context = vm.createContext({
    document: { querySelector: (selector) => nodes.get(selector), createElement: (tag) => new Node(tag), body: new Node("body") },
    navigator: {}, URL, Date, JSON, Number,
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: async (path, options) => {
      requests.push({ path, options });
      let result;
      if (path.endsWith("/session")) result = { body: { authenticated: true } };
      else if (path.endsWith("/state")) result = { body: data };
      else result = await post(path, options);
      return { ok: (result.status ?? 200) < 400, status: result.status ?? 200, json: async () => result.body };
    },
  });
  vm.runInContext(script, context);
  return { nodes, requests, timers, context };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const initial = { configured: false, reviewConfigured: true, settings: null, lastRun: null, candidates: [] };
const url = "https://www.daangn.com/kr/local-profile/test-abc123/";

test("[REG:radar.review_ui] review submission works without Kakao/settings and preserves input across failure and state reload", async () => {
  const app = mount(initial, async () => ({ status: 429, body: { error: { message: "잠시 후 다시 시도하세요." } } }));
  await settle();
  assert.ok(app.nodes.has("#review-form"), "authenticated review form exists");
  assert.equal(app.nodes.get("#review-run").disabled, false);
  assert.equal(app.nodes.get("#run-now").disabled, true);
  app.nodes.get("#review-url").value = url;
  await app.nodes.get("#review-form").events.submit({ preventDefault() {} });
  const request = app.requests.find((request) => request.path.endsWith("/review-runs"));
  assert.deepEqual(JSON.parse(request.options.body), { url });
  assert.equal(app.nodes.get("#review-url").value, url);
  assert.match(app.nodes.get("#review-status").textContent, /다시 시도/);
  assert.equal(app.nodes.get("#review-run").disabled, false);
  vm.runInContext("loadState()", app.context);
  await settle();
  assert.equal(app.nodes.get("#review-url").value, url);
});

test("[REG:radar.review_ui] running work blocks duplicate requests and session expiry returns to login", async () => {
  let respond;
  const app = mount(initial, () => new Promise((resolve) => { respond = resolve; }));
  await settle();
  assert.ok(app.nodes.has("#review-form"));
  app.nodes.get("#review-url").value = url;
  const first = app.nodes.get("#review-form").events.submit({ preventDefault() {} });
  await app.nodes.get("#review-form").events.submit({ preventDefault() {} });
  assert.equal(app.requests.filter((request) => request.path.endsWith("/review-runs")).length, 1);
  assert.equal(app.nodes.get("#review-run").disabled, true);
  respond({ status: 401, body: {} });
  await first;
  assert.equal(app.nodes.get("#workspace").hidden, true);
  assert.equal(app.nodes.get("#login-view").hidden, false);
  assert.equal(app.nodes.get("#review-url").value, url);
});

test("[REG:radar.review_ui] accepted work polls to completion and provider readiness stays independent", async () => {
  const data = { ...initial };
  const app = mount(data);
  await settle();
  app.nodes.get("#review-url").value = url;
  await app.nodes.get("#review-form").events.submit({ preventDefault() {} });
  assert.equal(app.nodes.get("#review-run").disabled, true);
  assert.equal(app.timers.length, 1);
  data.lastRun = { status: "running", startedAt: "2026-09-06T00:00:00Z", placesFound: 1, candidatesAnalyzed: 0 };
  await app.timers[0]();
  assert.equal(app.nodes.get("#review-run").disabled, true);
  data.lastRun.status = "completed";
  data.lastRun.candidatesAnalyzed = 1;
  await app.timers[1]();
  assert.equal(app.nodes.get("#review-run").disabled, false);
  assert.equal(app.nodes.get("#review-url").value, url);
  assert.match(app.nodes.get("#run-summary").textContent, /발굴 완료/);
  data.reviewConfigured = false;
  vm.runInContext("loadState()", app.context);
  await settle();
  assert.equal(app.nodes.get("#review-run").disabled, true);
  assert.match(app.nodes.get("#review-status").textContent, /서버 설정/);
});

test("[REG:radar.review_ui] review results separate roles, coverage and item validation while retaining old results", async () => {
  const analysis = { confirmedFacts: ["공개 레슨 안내"], painHypothesis: "기록 공유 가설", suggestedTool: "복습 카드", openingQuestion: "현재 기록 방식은?", doNotClaim: "수요 미확인", sources: [],
    reviewEvidence: { provider: "daangn", url, fetchedAt: "2026-09-06T00:00:00Z", coverage: "initial_page", customerReviewCount: 3, ownerReplyCount: 2, reportedReviewCount: 11 },
    reviewInsights: { signals: [{ evidenceId: "review-1", kind: "customer_review", summary: "<img src=x onerror=alert(1)> 친절한 설명" }, { evidenceId: "reply-1", kind: "owner_reply", summary: "사장님 운영 설명" }], items: [{ name: "레슨 복습 카드", evidenceIds: ["review-1"], hypothesis: "수업 내용을 복습할 수 있다", firstQuestion: "과제는 어떻게 전달하나요?", demoScope: "교정 포인트 카드 한 장", validationMetric: "회원의 다음 수업 과제 기억률" }], limitation: "구매 수요는 확인되지 않았습니다." },
  };
  const candidate = { id: "one", name: "예시 레슨", category: "교육", address: "성수동", phone: "", mapUrl: url, score: 30, confidence: 30, sourceCount: 1, analysis };
  const app = mount({ ...initial, candidates: [candidate] });
  await settle();
  const detail = app.nodes.get("#evidence-detail").textContent;
  for (const text of ["당근", "고객 후기 3개", "사장님 답글 2개", "전체 후기 11개", "초기 페이지", "고객 후기의 주장", "사장님 답글", "레슨 복습 카드", "과제는 어떻게 전달하나요?", "교정 포인트 카드 한 장", "회원의 다음 수업 과제 기억률", "review-1"]) assert.ok(detail.includes(text), text);
  assert.ok(detail.includes("<img src=x onerror=alert(1)>"), "external content is inert text");
  delete analysis.reviewEvidence; delete analysis.reviewInsights;
  app.context.fixture = { ...initial, candidates: [candidate] };
  vm.runInContext("renderSnapshot(fixture)", app.context);
  assert.match(app.nodes.get("#evidence-detail").textContent, /공개 레슨 안내/);
});
