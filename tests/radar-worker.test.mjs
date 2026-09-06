import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../scripts/build-site.mjs";
import {
  RADAR_SESSION_COOKIE,
  buildRadarOpenAIRequest,
  clearRadarSessionCookie,
  createRadarSession,
  extractRadarAnalysis,
  mapKakaoPlace,
  radarSessionCookie,
  reconcileRadarSources,
  seoulDateKey,
  shouldRunDaily,
  validateRadarAnalysis,
  validateRadarSettings,
  verifyRadarSession,
} from "../src/radar-core.mjs";
import { consumeRadarQueue, radarApi, recoverStaleRadarRuns } from "../src/radar-worker.mjs";
import showcaseWorker from "../src/worker.mjs";

const root = path.resolve(import.meta.dirname, "..");

function queueDbFixture({ runs, candidates = [] }) {
  const state = {
    runs: new Map(runs.map((run) => [run.id, { ...run }])),
    candidates: new Map(candidates.map((candidate) => [`${candidate.run_id}:${candidate.kakao_id}`, { ...candidate }])),
  };
  const aggregate = (runId) => {
    const rows = [...state.candidates.values()].filter((candidate) => candidate.run_id === runId);
    return {
      total: rows.length,
      completed: rows.filter((candidate) => candidate.analysis_status === "completed").length,
      failed: rows.filter((candidate) => candidate.analysis_status === "failed").length,
    };
  };
  return {
    state,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("COUNT(*) AS total")) return aggregate(this.args[0]);
          if (sql.includes("FROM radar_candidates") && sql.includes("kakao_id = ?")) {
            return state.candidates.get(`${this.args[0]}:${this.args[1]}`) ?? null;
          }
          if (sql.includes("FROM radar_runs") && sql.includes("WHERE id = ?")) return state.runs.get(this.args[0]) ?? null;
          return null;
        },
        async all() {
          if (sql.includes("COALESCE(heartbeat_at, started_at)")) {
            const cutoff = this.args[0];
            return { results: [...state.runs.values()].filter((run) => run.status === "running" && (run.heartbeat_at ?? run.started_at) <= cutoff) };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO radar_candidates")) {
            const [id, runId, kakaoId, name, address, category, phone, mapUrl, distanceMeters, analysisJson, score, confidence, sourceCount, analysisStatus, errorClass, createdAt] = this.args;
            state.candidates.set(`${runId}:${kakaoId}`, {
              id, run_id: runId, kakao_id: kakaoId, name, address, category, phone, map_url: mapUrl,
              distance_meters: distanceMeters, analysis_json: analysisJson, score, confidence,
              source_count: sourceCount, analysis_status: analysisStatus, error_class: errorClass, created_at: createdAt,
            });
          } else if (sql.includes("status = ?, candidates_analyzed = ?")) {
            const [status, analyzed, errorClass, completedAt, heartbeatAt, runId] = this.args;
            Object.assign(state.runs.get(runId), { status, candidates_analyzed: analyzed, error_class: errorClass, completed_at: completedAt, heartbeat_at: heartbeatAt });
          } else if (sql.includes("SET candidates_analyzed = ?, heartbeat_at = ?")) {
            const [analyzed, heartbeatAt, runId] = this.args;
            Object.assign(state.runs.get(runId), { candidates_analyzed: analyzed, heartbeat_at: heartbeatAt });
          } else if (sql.includes("RADAR_RUN_STALE")) {
            const [status, placesFound, analyzed, completedAt, heartbeatAt, runId] = this.args;
            Object.assign(state.runs.get(runId), {
              status, places_found: Math.max(state.runs.get(runId).places_found, placesFound),
              candidates_analyzed: analyzed, error_class: "RADAR_RUN_STALE", completed_at: completedAt, heartbeat_at: heartbeatAt,
            });
          }
          return { success: true };
        },
      };
    },
  };
}

function queueMessage(body, attempts = 1) {
  const calls = { ack: 0, retry: [] };
  return {
    body,
    attempts,
    ack() { calls.ack += 1; },
    retry(options) { calls.retry.push(options); },
    calls,
  };
}

test("[REG:radar.admin_auth] password-derived sessions expire, reject tampering, and stay in a strict host cookie", async () => {
  const secret = "a-long-random-admin-password";
  const issuedAt = Date.parse("2026-09-05T00:00:00.000Z");
  const token = await createRadarSession(secret, issuedAt);
  assert.equal(await verifyRadarSession(token, secret, issuedAt + 1_000), true);
  assert.equal(await verifyRadarSession(`${token}changed`, secret, issuedAt + 1_000), false);
  assert.equal(await verifyRadarSession(token, "another-long-random-password", issuedAt + 1_000), false);
  assert.equal(await verifyRadarSession(token, secret, issuedAt + 8 * 60 * 60 * 1000 + 1), false);
  assert.match(radarSessionCookie(token), new RegExp(`^${RADAR_SESSION_COOKIE}=`));
  assert.match(radarSessionCookie(token), /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
  assert.match(clearRadarSessionCookie(), /Max-Age=0/);
});

test("[REG:radar.admin_auth] login API compares only server configuration and protects the admin document response", async () => {
  const secret = "a-long-random-admin-password";
  const fakeDb = {
    prepare() { return { bind() { return this; }, async first() { return { count: 1 }; } }; },
  };
  const context = { waitUntil() {} };
  const loginRequest = (password, origin = "https://byabalone.com") => new Request("https://byabalone.com/api/admin/radar/login", {
    method: "POST",
    headers: { Origin: origin, "X-Requested-With": "abalone-showcase", "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const response = await radarApi(loginRequest(secret), { RADAR_ADMIN_PASSWORD: secret, INQUIRY_DB: fakeDb }, context);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /__Host-abalone_radar_admin=/);
  await assert.rejects(() => radarApi(loginRequest("wrong-password-value"), { RADAR_ADMIN_PASSWORD: secret, INQUIRY_DB: fakeDb }, context), /맞지 않습니다/);
  await assert.rejects(() => radarApi(loginRequest(secret, "https://evil.example"), { RADAR_ADMIN_PASSWORD: secret, INQUIRY_DB: fakeDb }, context), /출처/);

  const sessionResponse = await radarApi(new Request("https://byabalone.com/api/admin/radar/session", { headers: { Cookie: cookie.split(";")[0] } }), { RADAR_ADMIN_PASSWORD: secret }, context);
  assert.deepEqual(await sessionResponse.json(), { authenticated: true });
  const adminResponse = await showcaseWorker.fetch(new Request("https://byabalone.com/admin/radar/"), {
    ASSETS: { fetch: async () => new Response("<!doctype html><title>Radar</title>", { headers: { "Content-Type": "text/html" } }) },
  }, context);
  assert.equal(adminResponse.headers.get("Cache-Control"), "no-store");
  assert.equal(adminResponse.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

test("[REG:radar.public_place_contact] Kakao public phone and allowlisted map URL are retained without upstream secrets", () => {
  const place = mapKakaoPlace({
    id: "42", place_name: "가상 한결 공방", road_address_name: "서울 가상구 차분로 12", address_name: "서울 가상구",
    category_name: "문화 > 공방", distance: "320", phone: "02-1234-5678", place_url: "https://place.map.kakao.com/42",
  });
  assert.deepEqual(place, {
    kakaoId: "42", name: "가상 한결 공방", address: "서울 가상구 차분로 12", category: "문화 > 공방",
    distanceMeters: 320, phone: "02-1234-5678", mapUrl: "https://place.map.kakao.com/42",
  });
  assert.equal(mapKakaoPlace({ id: "7", place_name: "가상점", phone: "not-a-phone", place_url: "https://evil.example/7" }).phone, null);
  assert.equal(mapKakaoPlace({ id: "7", place_name: "가상점", phone: "not-a-phone", place_url: "https://evil.example/7" }).mapUrl, null);
  assert.equal(Object.hasOwn(place, "apiKey"), false);
  assert.doesNotMatch(JSON.stringify(place), /secret/i);
});

test("Radar settings normalize duplicates and reject unsafe search scope", () => {
  assert.deepEqual(validateRadarSettings({
    location: " 성수역 ", keywords: ["공방", " 공방 ", "세탁소"], radiusMeters: 1200, maxCandidates: 5, autoEnabled: true,
  }), { location: "성수역", keywords: ["공방", "세탁소"], radiusMeters: 1200, maxCandidates: 5, autoEnabled: true });
  assert.throws(() => validateRadarSettings({ location: "가", keywords: [], radiusMeters: 50, maxCandidates: 99, autoEnabled: true }), /위치|검색/);
});

test("[REG:radar.evidence_analysis] structured evidence rejects reviews and untrusted URLs", () => {
  const valid = {
    confirmedFacts: ["공식 예약 페이지에 예약 변경 안내가 있습니다."],
    painHypothesis: "변경 요청을 수기로 다시 정리할 가능성이 있습니다.", confidence: 72,
    sources: [{ kind: "booking_flow", title: "가상 공방 예약", url: "https://official.example/reserve", summary: "예약 변경 안내가 공개되어 있습니다." }],
    suggestedTool: "변경 요청을 한 화면에서 분류하는 작은 접수 도구", openingQuestion: "예약 변경이 들어오면 지금은 어디에 다시 적으시나요?",
    doNotClaim: "수기로 처리한다는 점은 아직 확인되지 않았습니다.",
    prototypeOffer: {
      name: "예약 변경 정리 서비스",
      promise: "흩어진 변경 요청을 한 화면에서 확인하게 합니다.",
      demoScope: "변경 요청 입력, 상태 분류, 오늘 처리 목록까지 시연합니다.",
      requiredInput: "현재 사용하는 예약 항목과 변경 요청 예시 5건",
      proofOfValue: "요청 한 건을 다시 찾고 정리하는 시간을 전후 비교합니다.",
    },
  };
  assert.equal(validateRadarAnalysis(valid), valid);
  const missingOffer = structuredClone(valid);
  delete missingOffer.prototypeOffer;
  assert.throws(() => validateRadarAnalysis(missingOffer), /prototype offer/);
  assert.throws(() => validateRadarAnalysis({ ...valid, sources: [{ ...valid.sources[0], kind: "review" }] }), /source kind/);
  assert.throws(() => validateRadarAnalysis({ ...valid, sources: [{ ...valid.sources[0], url: "javascript:alert(1)" }] }), /source url/);
  assert.throws(() => validateRadarAnalysis({ ...valid, sources: [], confidence: 70 }), /confidence/);

  const request = buildRadarOpenAIRequest({
    model: "gpt-test", place: { kakaoId: "42", name: "가상 한결 공방", address: "서울 가상구", category: "공방", phone: "02-1234-5678", mapUrl: "https://place.map.kakao.com/42", distanceMeters: 320 },
  });
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
  assert.deepEqual(request.include, ["web_search_call.action.sources"]);
  assert.equal(request.text.format.type, "json_schema");
  assert.match(request.instructions, /리뷰|평점|커뮤니티/);
  assert.match(request.instructions, /신뢰할 수 없는 관찰 자료/);
  assert.doesNotMatch(JSON.stringify(request), /OPENAI_API_KEY|KAKAO_REST_API_KEY/);

  const extracted = extractRadarAnalysis({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(valid) }] }] });
  assert.deepEqual(extracted, valid);
  const reconciled = reconcileRadarSources(valid, { output: [{ type: "web_search_call", action: { sources: [{ url: "https://official.example/reserve" }] } }] });
  assert.equal(reconciled.sources.length, 1);
  const unsupported = reconcileRadarSources(valid, { output: [{ type: "web_search_call", action: { sources: [] } }] });
  assert.equal(unsupported.sources.length, 0);
  assert.equal(unsupported.confidence, 30);
});

test("[REG:radar.daily_discovery] Seoul calendar date gates automatic discovery to one scheduled attempt per day", () => {
  const beforeMidnightUtc = Date.parse("2026-09-04T14:59:00.000Z");
  const afterMidnightUtc = Date.parse("2026-09-04T15:01:00.000Z");
  assert.equal(seoulDateKey(beforeMidnightUtc), "2026-09-04");
  assert.equal(seoulDateKey(afterMidnightUtc), "2026-09-05");
  assert.equal(shouldRunDaily({ autoEnabled: true, lastScheduledDate: "2026-09-04", instant: afterMidnightUtc }), true);
  assert.equal(shouldRunDaily({ autoEnabled: true, lastScheduledDate: "2026-09-05", instant: afterMidnightUtc }), false);
  assert.equal(shouldRunDaily({ autoEnabled: false, lastScheduledDate: null, instant: afterMidnightUtc }), false);
});

test("[REG:radar.queue_delivery] manual runs enqueue every public place without waitUntil background work", async () => {
  const statements = [];
  const fakeDb = {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("SELECT * FROM radar_settings")) return {
            id: 1, location: "영통역", keywords_json: '["정형외과"]', radius_meters: 1200,
            max_candidates: 3, auto_enabled: 0, created_at: "2026-09-06T00:00:00.000Z", updated_at: "2026-09-06T00:00:00.000Z",
          };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { statements.push({ sql, args: this.args }); return { success: true }; },
      };
      return statement;
    },
  };
  const queued = [];
  const background = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/search/address.json")) {
      return Response.json({ documents: [{ x: "127.071", y: "37.251" }] });
    }
    if (url.pathname.endsWith("/search/keyword.json")) {
      return Response.json({ documents: [
        { id: "1", place_name: "가상 의원 1", road_address_name: "경기 가상로 1", category_name: "의료", distance: "100", phone: "031-000-0001", place_url: "https://place.map.kakao.com/1" },
        { id: "2", place_name: "가상 의원 2", road_address_name: "경기 가상로 2", category_name: "의료", distance: "200", phone: "031-000-0002", place_url: "https://place.map.kakao.com/2" },
        { id: "3", place_name: "가상 의원 3", road_address_name: "경기 가상로 3", category_name: "의료", distance: "300", phone: "031-000-0003", place_url: "https://place.map.kakao.com/3" },
      ] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const secret = "a-long-random-admin-password";
    const token = await createRadarSession(secret);
    const response = await radarApi(new Request("https://byabalone.com/api/admin/radar/runs", {
      method: "POST",
      headers: { Origin: "https://byabalone.com", "X-Requested-With": "abalone-showcase", Cookie: `${RADAR_SESSION_COOKIE}=${token}` },
      body: "{}",
    }), {
      RADAR_ADMIN_PASSWORD: secret,
      INQUIRY_DB: fakeDb,
      KAKAO_REST_API_KEY: "fake-kakao-key",
      OPENAI_API_KEY: "fake-openai-key",
      OPENAI_MODEL: "gpt-test",
      RADAR_QUEUE: { async sendBatch(messages) { queued.push(...messages); } },
    }, { waitUntil(task) { background.push(task); } });
    assert.equal(response.status, 202);
    assert.equal(background.length, 0);
    assert.equal(queued.length, 3);
    assert.deepEqual(queued.map((message) => message.body.place.kakaoId), ["1", "2", "3"]);
    assert.ok(statements.some(({ sql, args }) => sql.includes("places_found") && args.includes(3)));
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(background);
  }
});

test("[REG:radar.queue_delivery] a queued place persists one analysis and completes its run", async () => {
  const db = queueDbFixture({ runs: [{
    id: "run-success", status: "running", places_found: 1, candidates_analyzed: 0,
    started_at: "2026-09-06T00:00:00.000Z", heartbeat_at: "2026-09-06T00:00:00.000Z",
  }] });
  const analysis = {
    confirmedFacts: [],
    painHypothesis: "접수 업무를 다시 정리하는 과정이 있는지 확인할 필요가 있습니다.",
    confidence: 30,
    sources: [],
    suggestedTool: "접수 요청을 한 화면에서 분류하는 작은 도구",
    openingQuestion: "접수 요청은 지금 어떤 순서로 정리하시나요?",
    doNotClaim: "현재 접수 과정이 비효율적이라고 확인된 것은 아닙니다.",
    prototypeOffer: {
      name: "접수 요청 정리 도구",
      promise: "접수 요청의 처리 상태를 한 화면에서 확인하게 합니다.",
      demoScope: "요청 입력, 상태 분류, 오늘 처리 목록을 시연합니다.",
      requiredInput: "현재 사용하는 접수 항목과 가상 요청 예시",
      proofOfValue: "요청 한 건을 찾고 분류하는 시간을 비교합니다.",
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }],
  });
  try {
    const place = { kakaoId: "8", name: "가상 의원", address: "경기 가상로 8", category: "의료", phone: "031-000-0008", mapUrl: "https://place.map.kakao.com/8", distanceMeters: 80 };
    const message = queueMessage({ runId: "run-success", place });
    await consumeRadarQueue({ messages: [message] }, { INQUIRY_DB: db, OPENAI_API_KEY: "fake", OPENAI_MODEL: "gpt-test" });
    assert.equal(message.calls.ack, 1);
    assert.equal(message.calls.retry.length, 0);
    assert.equal(db.state.candidates.get("run-success:8").analysis_status, "completed");
    assert.equal(db.state.runs.get("run-success").status, "completed");
    assert.equal(db.state.runs.get("run-success").candidates_analyzed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("[REG:radar.queue_retry] transient analysis retries and a third failure becomes a terminal candidate", async () => {
  const db = queueDbFixture({ runs: [{
    id: "run-retry", status: "running", places_found: 1, candidates_analyzed: 0,
    started_at: "2026-09-06T00:00:00.000Z", heartbeat_at: "2026-09-06T00:00:00.000Z",
  }] });
  const place = { kakaoId: "42", name: "가상 공방", address: "서울 가상구", category: "공방", phone: null, mapUrl: null, distanceMeters: 100 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream failed", { status: 500 });
  try {
    const first = queueMessage({ runId: "run-retry", place }, 1);
    await consumeRadarQueue({ messages: [first] }, { INQUIRY_DB: db, OPENAI_API_KEY: "fake", OPENAI_MODEL: "gpt-test" });
    assert.equal(first.calls.ack, 0);
    assert.deepEqual(first.calls.retry, [{ delaySeconds: 30 }]);
    assert.equal(db.state.candidates.size, 0);
    assert.equal(db.state.runs.get("run-retry").status, "running");

    const third = queueMessage({ runId: "run-retry", place }, 3);
    await consumeRadarQueue({ messages: [third] }, { INQUIRY_DB: db, OPENAI_API_KEY: "fake", OPENAI_MODEL: "gpt-test" });
    assert.equal(third.calls.ack, 1);
    assert.equal(third.calls.retry.length, 0);
    assert.equal(db.state.candidates.get("run-retry:42").analysis_status, "failed");
    assert.equal(db.state.runs.get("run-retry").status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("[REG:radar.queue_idempotency] duplicate delivery skips the model and preserves completed progress", async () => {
  const db = queueDbFixture({
    runs: [{ id: "run-done", status: "running", places_found: 1, candidates_analyzed: 0, started_at: "2026-09-06T00:00:00.000Z", heartbeat_at: "2026-09-06T00:00:00.000Z" }],
    candidates: [{ id: "candidate-1", run_id: "run-done", kakao_id: "7", analysis_status: "completed" }],
  });
  let modelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { modelCalls += 1; throw new Error("model must not be called"); };
  try {
    const message = queueMessage({ runId: "run-done", place: { kakaoId: "7", name: "가상점" } });
    await consumeRadarQueue({ messages: [message] }, { INQUIRY_DB: db, OPENAI_API_KEY: "fake", OPENAI_MODEL: "gpt-test" });
    assert.equal(modelCalls, 0);
    assert.equal(message.calls.ack, 1);
    assert.equal(db.state.runs.get("run-done").status, "completed");
    assert.equal(db.state.runs.get("run-done").candidates_analyzed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("[REG:radar.stale_recovery] a stalled run becomes partial from its durable candidate count", async () => {
  const db = queueDbFixture({
    runs: [{ id: "run-stale", status: "running", places_found: 3, candidates_analyzed: 0, started_at: "2026-09-06T00:00:00.000Z", heartbeat_at: "2026-09-06T00:01:00.000Z" }],
    candidates: [
      { id: "candidate-1", run_id: "run-stale", kakao_id: "1", analysis_status: "completed" },
      { id: "candidate-2", run_id: "run-stale", kakao_id: "2", analysis_status: "completed" },
    ],
  });
  const recovered = await recoverStaleRadarRuns(db, Date.parse("2026-09-06T00:20:00.000Z"));
  assert.equal(recovered, 1);
  assert.deepEqual(db.state.runs.get("run-stale"), {
    id: "run-stale", status: "partial", places_found: 3, candidates_analyzed: 2,
    started_at: "2026-09-06T00:00:00.000Z", heartbeat_at: "2026-09-06T00:20:00.000Z",
    error_class: "RADAR_RUN_STALE", completed_at: "2026-09-06T00:20:00.000Z",
  });
});

test("[REG:radar.admin_surface] private Radar files expose explicit states and remain outside public discovery", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "abalone-radar-admin-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const [html, script, styles, robots, sitemap] = await Promise.all([
    readFile(path.join(output, "admin/radar/index.html"), "utf8"),
    readFile(path.join(output, "admin/radar/radar.js"), "utf8"),
    readFile(path.join(output, "admin/radar/radar.css"), "utf8"),
    readFile(path.join(output, "robots.txt"), "utf8"),
    readFile(path.join(output, "sitemap.xml"), "utf8"),
  ]);
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /RADAR_ADMIN_PASSWORD/);
  assert.match(html, /지금 발굴하기/);
  for (const state of ["login", "setup", "ready", "busy", "empty", "error"]) assert.match(script, new RegExp(`\\b${state}\\b`));
  assert.match(script, /\/api\/admin\/radar\/session/);
  assert.match(script, /\$\{analyzed\}\/\$\{run\.placesFound\}곳 분석/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|innerHTML/);
  assert.match(styles, /--brand-accent: #111111/);
  assert.match(styles, /outline: 3px solid var\(--brand-focus\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(robots, /Disallow: \/admin\//);
  assert.doesNotMatch(sitemap, /\/admin\/radar/);
  const migration = await readFile(path.join(root, "migrations/0002_opportunity_radar.sql"), "utf8");
  assert.match(migration, /CREATE TABLE radar_settings/);
  assert.match(migration, /CREATE TABLE radar_runs/);
  assert.match(migration, /run_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE UNIQUE INDEX radar_runs_single_active_idx/);
  assert.match(migration, /CREATE TABLE radar_candidates/);
  assert.match(migration, /phone TEXT/);
  const progressMigration = await readFile(path.join(root, "migrations/0003_radar_progress.sql"), "utf8");
  assert.match(progressMigration, /ADD COLUMN heartbeat_at TEXT/);
  assert.match(progressMigration, /radar_runs_status_heartbeat_idx/);
  const wrangler = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  assert.deepEqual(wrangler.queues.producers, [{ binding: "RADAR_QUEUE", queue: "nohdol-auto-showcase-radar" }]);
  assert.equal(wrangler.queues.consumers[0].max_retries, 3);
  assert.equal(wrangler.queues.consumers[0].retry_delay, 30);
});

test('[REG:radar.review_run] authenticated URL runs enqueue without Kakao settings and reject unauthenticated or invalid inputs', async () => {
  const queued=[]; const statements=[];
  let active=false;
  const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return active && sql.includes("status = 'running' LIMIT 1") ? {id:'active'} : null;},async all(){return {results:[]};},async run(){statements.push({sql,args:this.args});}};}};
  const secret='a-long-random-admin-password'; const token=await createRadarSession(secret);
  const env={RADAR_ADMIN_PASSWORD:secret,INQUIRY_DB:db,OPENAI_API_KEY:'fake',OPENAI_MODEL:'gpt-test',RADAR_QUEUE:{async sendBatch(messages){queued.push(...messages);}}};
  const request=(url,authenticated=true,origin='https://byabalone.com')=>new Request('https://byabalone.com/api/admin/radar/review-runs',{method:'POST',headers:{Origin:origin,'X-Requested-With':'abalone-showcase',Cookie:authenticated ? `${RADAR_SESSION_COOKIE}=${token}` : ''},body:JSON.stringify({url})});
  const url='https://www.daangn.com/kr/local-profile/sample-demo123/?utm_source=tracking';
  await assert.rejects(()=>radarApi(request(url,false),env,{}),error=>error.status===401);
  await assert.rejects(()=>radarApi(request(url,true,'https://evil.example'),env,{}),error=>error.status===403);
  await assert.rejects(()=>radarApi(request('https://evil.example/'),env,{}),error=>error.status===400);
  assert.equal(queued.length,0);
  const response=await radarApi(request(url),env,{});
  assert.equal(response.status,202);
  assert.equal((await response.json()).placesFound,1);
  assert.equal(queued.length,1);
  assert.equal(queued[0].body.place.kakaoId,'daangn:demo123');
  assert.equal(queued[0].body.place.daangnUrl,'https://www.daangn.com/kr/local-profile/sample-demo123/');
  assert.doesNotMatch(JSON.stringify(queued),/utm_source|observations|reviewBody|OPENAI/);
  assert.ok(statements.some(s=>s.sql.includes('INSERT INTO radar_runs')));
  active=true;
  await assert.rejects(()=>radarApi(request(url),env,{}),error=>error.status===409);
  assert.equal(queued.length,1);
  const state=await radarApi(new Request('https://byabalone.com/api/admin/radar/state',{headers:{Cookie:`${RADAR_SESSION_COOKIE}=${token}`}}),env,{});
  const snapshot=await state.json();
  assert.equal(snapshot.configured,false);
  assert.equal(snapshot.reviewConfigured,true);
});

function reviewPageFixture() {
  const profile={id:'/kr/local-profile/sample-demo123/',href:'https://www.daangn.com/kr/local-profile/sample-demo123/',name:'가상 레슨실',status:'ACTIVE',address:{road:'가상로 1'},category:{name:'골프'},count:{reviewCount:12},reviews:[
    {content:'고유한 합성 고객 원문입니다.',createdAt:'2026-09-01T00:00:00Z',user:{nickname:'수집금지작성자'},comment:{content:'고유한 합성 사장 답글입니다.',createdAt:'2026-09-02T00:00:00Z'}},
  ]};
  return `<script>window.__remixContext = ${JSON.stringify({state:{loaderData:{'routes/kr.local-profile.$local_profile_id':{localProfile:profile}}}})};</script>`;
}
function reviewAnalysisFixture() {
  return {
    confirmedFacts:['가상 레슨실은 골프 업체입니다.'],painHypothesis:'수업 기록 전달 방식에 개선 여지가 있는지 확인해야 합니다.',confidence:60,
    sources:[{kind:'daangn_profile',url:'https://www.daangn.com/kr/local-profile/sample-demo123/',title:'가상 레슨실 후기',summary:'고객 경험과 사장님 답글을 구분해 읽었습니다.'}],
    suggestedTool:'복습 카드',openingQuestion:'수업 내용을 어떻게 전달하시나요?',doNotClaim:'불편과 구매 수요는 미확인입니다.',
    prototypeOffer:{name:'복습 카드',promise:'수업 내용을 정리합니다.',demoScope:'가상 기록 카드',requiredInput:'가상 항목',proofOfValue:'작성 시간을 비교합니다.'},
    reviewInsights:{signals:[{evidenceId:'review-1',kind:'customer_review',summary:'한 고객이 수업 경험을 전했습니다.'}],items:[{name:'복습 카드',evidenceIds:['review-1'],hypothesis:'기록 전달에 도움을 줄 가능성을 확인합니다.',firstQuestion:'수업 내용을 어떻게 전달하시나요?',demoScope:'가상 수업 카드',validationMetric:'작성 시간'}],limitation:'초기 페이지 일부 후기이며 수요는 미확인입니다.'},
  };
}

test('[REG:radar.review_queue] consumer fetches reviews, validates items, stores summaries and skips duplicate delivery', async () => {
  const db=queueDbFixture({runs:[{id:'review-run',status:'running',places_found:1,started_at:'2026-09-06T00:00:00Z'}]});
  const place={kakaoId:'daangn:demo123',name:'당근 업체',daangnUrl:'https://www.daangn.com/kr/local-profile/sample-demo123/'};
  const originalFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=async (input,options)=>{
    calls+=1;
    if(String(input).includes('www.daangn.com')) return new Response(reviewPageFixture(),{headers:{'content-type':'text/html'}});
    const request=JSON.parse(options.body);
    assert.equal(request.store,false); assert.deepEqual(request.tools,[]);
    assert.match(request.input,/고유한 합성 고객 원문/);
    assert.match(request.input,/owner_reply/);
    assert.doesNotMatch(request.input,/수집금지작성자/);
    return Response.json({output_text:JSON.stringify(reviewAnalysisFixture())});
  };
  try {
    const message=queueMessage({runId:'review-run',place});
    await consumeRadarQueue({messages:[message]},{INQUIRY_DB:db,OPENAI_API_KEY:'fake',OPENAI_MODEL:'gpt-test'});
    assert.equal(message.calls.ack,1);assert.equal(message.calls.retry.length,0);
    const stored=db.state.candidates.get('review-run:daangn:demo123');
    assert.equal(stored.name,'가상 레슨실');assert.equal(stored.confidence,30);
    const analysis=JSON.parse(stored.analysis_json);
    assert.equal(analysis.reviewEvidence.customerReviewCount,1);
    assert.equal(analysis.reviewEvidence.ownerReplyCount,1);
    assert.equal(analysis.reviewEvidence.reportedReviewCount,12);
    assert.doesNotMatch(stored.analysis_json,/고유한 합성|수집금지작성자|reviewBody/);
    assert.equal(db.state.runs.get('review-run').status,'completed');
    const second=queueMessage({runId:'review-run',place});
    await consumeRadarQueue({messages:[second]},{INQUIRY_DB:db});
    assert.equal(second.calls.ack,1);assert.equal(calls,2);
  } finally {globalThis.fetch=originalFetch;}
});

test('[REG:radar.review_queue] a blocked provider produces a bounded terminal failure without model calls',async()=>{
  const db=queueDbFixture({runs:[{id:'blocked-run',status:'running',places_found:1,started_at:'2026-09-06T00:00:00Z'}]});
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('',{status:403});};
  try{
    const message=queueMessage({runId:'blocked-run',place:{kakaoId:'daangn:demo123',name:'당근 업체',daangnUrl:'https://www.daangn.com/kr/local-profile/sample-demo123/'}},3);
    await consumeRadarQueue({messages:[message]},{INQUIRY_DB:db});
    assert.equal(message.calls.ack,1);assert.equal(calls,1);
    assert.equal(db.state.candidates.get('blocked-run:daangn:demo123').error_class,'DAANGN_BLOCKED');
    assert.equal(db.state.runs.get('blocked-run').status,'failed');
  }finally{globalThis.fetch=originalFetch;}
});
