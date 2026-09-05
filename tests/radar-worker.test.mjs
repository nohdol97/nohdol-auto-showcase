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
import { radarApi } from "../src/radar-worker.mjs";
import showcaseWorker from "../src/worker.mjs";

const root = path.resolve(import.meta.dirname, "..");

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
});
