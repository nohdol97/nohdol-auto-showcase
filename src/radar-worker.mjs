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
  validateRadarSettings,
  verifyRadarSession,
} from "./radar-core.mjs";
import { HttpError, assertSameOrigin, hmacHex, json, parseCookies, safeEqual } from "./inquiry-core.mjs";

const RETENTION_DAYS = 365;
const RADAR_QUEUE_ATTEMPTS = 3;
const RADAR_RETRY_DELAY_SECONDS = 30;
const STALE_RUN_MS = 15 * 60 * 1000;

function required(env, name) {
  const value = env[name];
  if (!value) throw new HttpError(503, "RADAR_NOT_CONFIGURED", "Radar 서비스를 준비하고 있습니다.");
  return value;
}

function radarDb(env) {
  return required(env, "INQUIRY_DB");
}

function timestamp() {
  return new Date().toISOString();
}

async function readJson(request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 32 * 1024) throw new HttpError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 깁니다.");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, "INVALID_JSON", "입력 내용을 확인해 주세요."); }
}

async function radarLoginRateLimit(request, env) {
  const secret = required(env, "RADAR_ADMIN_PASSWORD");
  const clientAddress = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limitKey = await hmacHex(secret, `radar-login:${clientAddress}`);
  const bucketMs = 15 * 60 * 1000;
  const instant = Date.now();
  const bucketStart = new Date(Math.floor(instant / bucketMs) * bucketMs).toISOString();
  const expiresAt = new Date(instant + bucketMs * 2).toISOString();
  const row = await radarDb(env).prepare(
    `INSERT INTO rate_limits (limit_key, bucket_start, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(limit_key, bucket_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(limitKey, bucketStart, expiresAt).first();
  if (Number(row?.count ?? 11) > 10) throw new HttpError(429, "RADAR_LOGIN_RATE_LIMITED", "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
}

async function authenticateRadar(request, env) {
  const token = parseCookies(request.headers.get("Cookie")).get(RADAR_SESSION_COOKIE);
  if (!token || !await verifyRadarSession(token, required(env, "RADAR_ADMIN_PASSWORD"))) throw new HttpError(401, "RADAR_AUTH_REQUIRED", "Radar 관리자 로그인이 필요합니다.");
}

async function login(request, env) {
  assertSameOrigin(request);
  await radarLoginRateLimit(request, env);
  const body = await readJson(request);
  const configured = required(env, "RADAR_ADMIN_PASSWORD");
  if (!safeEqual(String(body.password ?? ""), configured)) throw new HttpError(401, "RADAR_LOGIN_FAILED", "입력한 관리자 값이 맞지 않습니다.");
  const token = await createRadarSession(configured);
  return json({ authenticated: true }, 200, { "Set-Cookie": radarSessionCookie(token) });
}

async function session(request, env) {
  try {
    await authenticateRadar(request, env);
    return json({ authenticated: true });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return json({ authenticated: false });
    throw error;
  }
}

async function logout(request) {
  assertSameOrigin(request);
  return json({ authenticated: false }, 200, { "Set-Cookie": clearRadarSessionCookie() });
}

function settingsFromRow(row) {
  if (!row) return null;
  return validateRadarSettings({
    location: row.location,
    keywords: JSON.parse(row.keywords_json),
    radiusMeters: row.radius_meters,
    maxCandidates: row.max_candidates,
    autoEnabled: row.auto_enabled === 1,
  });
}

async function loadSettings(env) {
  return settingsFromRow(await radarDb(env).prepare("SELECT * FROM radar_settings WHERE id = 1").first());
}

async function saveSettings(request, env) {
  assertSameOrigin(request);
  await authenticateRadar(request, env);
  const settings = validateRadarSettings(await readJson(request));
  const now = timestamp();
  await radarDb(env).prepare(
    `INSERT INTO radar_settings (id, location, keywords_json, radius_meters, max_candidates, auto_enabled, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET location = excluded.location, keywords_json = excluded.keywords_json,
       radius_meters = excluded.radius_meters, max_candidates = excluded.max_candidates,
       auto_enabled = excluded.auto_enabled, updated_at = excluded.updated_at`,
  ).bind(settings.location, JSON.stringify(settings.keywords), settings.radiusMeters, settings.maxCandidates, settings.autoEnabled ? 1 : 0, now, now).run();
  return json({ settings });
}

async function kakaoGet(pathname, parameters, env) {
  const url = new URL(`https://dapi.kakao.com${pathname}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `KakaoAK ${required(env, "KAKAO_REST_API_KEY")}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "KAKAO_UNREACHABLE", "Kakao 장소 검색에 연결하지 못했습니다.");
  }
  if (response.status === 401 || response.status === 403) throw new HttpError(503, "KAKAO_AUTH_FAILED", "Kakao REST API 설정을 확인해 주세요.");
  if (response.status === 429) throw new HttpError(503, "KAKAO_RATE_LIMITED", "Kakao 장소 검색 사용량이 잠시 제한되었습니다.");
  if (!response.ok) throw new HttpError(502, "KAKAO_FAILED", "Kakao 장소 목록을 불러오지 못했습니다.");
  const body = await response.json();
  if (!Array.isArray(body?.documents)) throw new HttpError(502, "KAKAO_INVALID", "Kakao 장소 검색 응답을 확인하지 못했습니다.");
  return body.documents;
}

function coordinate(document) {
  const longitude = Number(document?.x);
  const latitude = Number(document?.y);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
}

export async function searchRadarPlaces(settings, env) {
  let centers = await kakaoGet("/v2/local/search/address.json", { query: settings.location, size: 1 }, env);
  if (!coordinate(centers[0])) centers = await kakaoGet("/v2/local/search/keyword.json", { query: settings.location, size: 1 }, env);
  const center = coordinate(centers[0]);
  if (!center) throw new HttpError(404, "RADAR_LOCATION_NOT_FOUND", "입력한 위치를 찾지 못했습니다.");
  const groups = await Promise.all(settings.keywords.map((query) => kakaoGet("/v2/local/search/keyword.json", {
    query, x: center.longitude, y: center.latitude, radius: settings.radiusMeters, sort: "distance", size: 15, page: 1,
  }, env)));
  const places = new Map();
  for (const document of groups.flat()) {
    const place = mapKakaoPlace(document);
    if (place && !places.has(place.kakaoId)) places.set(place.kakaoId, place);
  }
  return [...places.values()].sort((left, right) => (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER));
}

async function analyzePlace(place, env) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${required(env, "OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildRadarOpenAIRequest({ model: required(env, "OPENAI_MODEL"), place })),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`OpenAI Radar status ${response.status}`);
  const body = await response.json();
  return reconcileRadarSources(extractRadarAnalysis(body), body);
}

function errorClass(error) {
  if (error instanceof HttpError) return error.code;
  if (String(error?.message ?? "").startsWith("OpenAI Radar status")) return "OPENAI_RESPONSE_FAILED";
  if (error?.name === "TimeoutError") return "UPSTREAM_TIMEOUT";
  return "RADAR_ANALYSIS_FAILED";
}

async function insertCandidate(env, runId, place, analysis, failure) {
  const sources = analysis?.sources ?? [];
  const confidence = analysis?.confidence ?? 0;
  const score = Math.min(100, confidence + sources.length * 3);
  await radarDb(env).prepare(
    `INSERT INTO radar_candidates
      (id, run_id, kakao_id, name, address, category, phone, map_url, distance_meters, analysis_json, score, confidence, source_count, analysis_status, error_class, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, kakao_id) DO NOTHING`,
  ).bind(crypto.randomUUID(), runId, place.kakaoId, place.name, place.address, place.category, place.phone, place.mapUrl, place.distanceMeters,
    analysis ? JSON.stringify(analysis) : null, score, confidence, sources.length, failure ? "failed" : "completed", failure ? errorClass(failure) : null, timestamp()).run();
}

async function candidateExists(env, runId, kakaoId) {
  return Boolean(await radarDb(env).prepare(
    "SELECT id FROM radar_candidates WHERE run_id = ? AND kakao_id = ?",
  ).bind(runId, kakaoId).first());
}

async function candidateStats(database, runId) {
  const row = await database.prepare(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN analysis_status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN analysis_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM radar_candidates WHERE run_id = ?`,
  ).bind(runId).first();
  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

async function refreshRadarRun(env, runId, instant = Date.now()) {
  const database = radarDb(env);
  const run = await database.prepare(
    "SELECT id, status, places_found FROM radar_runs WHERE id = ?",
  ).bind(runId).first();
  if (!run || run.status !== "running") return;
  const stats = await candidateStats(database, runId);
  const now = new Date(instant).toISOString();
  if (Number(run.places_found) > 0 && stats.total >= Number(run.places_found)) {
    const status = stats.failed === 0 ? "completed" : stats.completed === 0 ? "failed" : "partial";
    await database.prepare(
      "UPDATE radar_runs SET status = ?, candidates_analyzed = ?, error_class = ?, completed_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'",
    ).bind(status, stats.completed, stats.failed ? "CANDIDATE_ANALYSIS_FAILED" : null, now, now, runId).run();
    return;
  }
  await database.prepare(
    "UPDATE radar_runs SET candidates_analyzed = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'",
  ).bind(stats.completed, now, runId).run();
}

function radarQueuePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const runId = typeof body.runId === "string" ? body.runId : "";
  const place = body.place;
  if (!runId || runId.length > 80 || !place || typeof place !== "object" || Array.isArray(place)) return null;
  if (typeof place.kakaoId !== "string" || !place.kakaoId || place.kakaoId.length > 80) return null;
  if (typeof place.name !== "string" || !place.name || place.name.length > 120) return null;
  return { runId, place };
}

async function consumeRadarMessage(message, env) {
  const payload = radarQueuePayload(message.body);
  if (!payload) {
    message.ack();
    return;
  }
  const run = await radarDb(env).prepare(
    "SELECT id, status, places_found FROM radar_runs WHERE id = ?",
  ).bind(payload.runId).first();
  if (!run || run.status !== "running") {
    message.ack();
    return;
  }
  if (await candidateExists(env, payload.runId, payload.place.kakaoId)) {
    await refreshRadarRun(env, payload.runId);
    message.ack();
    return;
  }
  try {
    const analysis = await analyzePlace(payload.place, env);
    await insertCandidate(env, payload.runId, payload.place, analysis, null);
    await refreshRadarRun(env, payload.runId);
    message.ack();
  } catch (error) {
    if (Number(message.attempts ?? 1) < RADAR_QUEUE_ATTEMPTS) {
      message.retry({ delaySeconds: RADAR_RETRY_DELAY_SECONDS });
      return;
    }
    try {
      await insertCandidate(env, payload.runId, payload.place, null, error);
      await refreshRadarRun(env, payload.runId);
      message.ack();
    } catch {
      message.retry({ delaySeconds: RADAR_RETRY_DELAY_SECONDS });
    }
  }
}

export async function consumeRadarQueue(batch, env) {
  await Promise.all(batch.messages.map((message) => consumeRadarMessage(message, env)));
}

export async function recoverStaleRadarRuns(database, instant = Date.now()) {
  const cutoff = new Date(instant - STALE_RUN_MS).toISOString();
  const stalled = (await database.prepare(
    "SELECT id, places_found FROM radar_runs WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) <= ?",
  ).bind(cutoff).all()).results ?? [];
  const now = new Date(instant).toISOString();
  for (const run of stalled) {
    const stats = await candidateStats(database, run.id);
    const status = stats.total > 0 ? "partial" : "failed";
    await database.prepare(
      `UPDATE radar_runs SET status = ?, places_found = MAX(places_found, ?), candidates_analyzed = ?,
       error_class = 'RADAR_RUN_STALE', completed_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'`,
    ).bind(status, stats.total, stats.completed, now, now, run.id).run();
  }
  return stalled.length;
}

export async function runRadarDiscovery(env, { trigger = "manual", localDate = seoulDateKey() } = {}) {
  await recoverStaleRadarRuns(radarDb(env));
  const settings = await loadSettings(env);
  if (!settings) throw new HttpError(409, "RADAR_SETTINGS_REQUIRED", "먼저 검색 범위를 저장해 주세요.");
  const active = await radarDb(env).prepare("SELECT id FROM radar_runs WHERE status = 'running' LIMIT 1").first();
  if (active) throw new HttpError(409, "RADAR_RUN_ACTIVE", "이미 발굴 작업이 진행 중입니다.");
  const runId = crypto.randomUUID();
  const runKey = trigger === "scheduled" ? `scheduled:${localDate}` : `manual:${runId}`;
  const startedAt = timestamp();
  try {
    await radarDb(env).prepare(
      `INSERT INTO radar_runs (id, run_key, trigger_type, local_date, status, settings_json, places_found, candidates_analyzed, started_at, heartbeat_at)
       VALUES (?, ?, ?, ?, 'running', ?, 0, 0, ?, ?)`,
    ).bind(runId, runKey, trigger, localDate, JSON.stringify(settings), startedAt, startedAt).run();
  } catch (error) {
    if (trigger === "scheduled") return { skipped: true, reason: "already_started" };
    throw error;
  }

  try {
    const places = (await searchRadarPlaces(settings, env)).slice(0, settings.maxCandidates);
    const heartbeatAt = timestamp();
    await radarDb(env).prepare(
      "UPDATE radar_runs SET places_found = ?, heartbeat_at = ? WHERE id = ?",
    ).bind(places.length, heartbeatAt, runId).run();
    if (places.length === 0) {
      await radarDb(env).prepare(
        "UPDATE radar_runs SET status = 'completed', completed_at = ?, heartbeat_at = ? WHERE id = ?",
      ).bind(heartbeatAt, heartbeatAt, runId).run();
      return { runId, status: "completed", placesFound: 0, candidatesAnalyzed: 0 };
    }
    await required(env, "RADAR_QUEUE").sendBatch(places.map((place) => ({ body: { runId, place } })));
    return { runId, status: "running", placesFound: places.length, candidatesAnalyzed: 0 };
  } catch (error) {
    const failedAt = timestamp();
    await radarDb(env).prepare("UPDATE radar_runs SET status = 'failed', error_class = ?, completed_at = ?, heartbeat_at = ? WHERE id = ?")
      .bind(errorClass(error), failedAt, failedAt, runId).run();
    throw error;
  }
}

function publicRun(row) {
  return row ? { id: row.id, trigger: row.trigger_type, localDate: row.local_date, status: row.status, placesFound: row.places_found, candidatesAnalyzed: row.candidates_analyzed, startedAt: row.started_at, completedAt: row.completed_at } : null;
}

function publicCandidate(row) {
  return {
    id: row.id, name: row.name, address: row.address, category: row.category, phone: row.phone, mapUrl: row.map_url,
    distanceMeters: row.distance_meters, score: row.score, confidence: row.confidence, sourceCount: row.source_count,
    analysisStatus: row.analysis_status, analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null, createdAt: row.created_at,
  };
}

async function state(request, env) {
  await authenticateRadar(request, env);
  const settings = await loadSettings(env);
  const lastRun = await radarDb(env).prepare("SELECT * FROM radar_runs ORDER BY started_at DESC LIMIT 1").first();
  const rows = (await radarDb(env).prepare(
    `SELECT radar_candidates.* FROM radar_candidates
     JOIN radar_runs ON radar_runs.id = radar_candidates.run_id
     WHERE radar_runs.id = (SELECT id FROM radar_runs ORDER BY started_at DESC LIMIT 1)
     ORDER BY radar_candidates.score DESC, radar_candidates.distance_meters ASC LIMIT 20`,
  ).all()).results ?? [];
  return json({ configured: Boolean(env.KAKAO_REST_API_KEY && env.OPENAI_API_KEY && env.OPENAI_MODEL && env.RADAR_QUEUE), settings, lastRun: publicRun(lastRun), candidates: rows.map(publicCandidate) });
}

async function beginRun(request, env) {
  assertSameOrigin(request);
  await authenticateRadar(request, env);
  return json({ accepted: true, ...await runRadarDiscovery(env) }, 202);
}

export async function radarApi(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (url.pathname === "/api/admin/radar/login" && method === "POST") return login(request, env);
  if (url.pathname === "/api/admin/radar/session" && method === "GET") return session(request, env);
  if (url.pathname === "/api/admin/radar/logout" && method === "POST") return logout(request);
  if (url.pathname === "/api/admin/radar/state" && method === "GET") return state(request, env);
  if (url.pathname === "/api/admin/radar/settings" && method === "PUT") return saveSettings(request, env);
  if (url.pathname === "/api/admin/radar/runs" && method === "POST") return beginRun(request, env);
  throw new HttpError(404, "RADAR_API_NOT_FOUND", "요청한 Radar 기능을 찾을 수 없습니다.");
}

export async function scheduledRadar(env) {
  const settings = await loadSettings(env);
  if (!settings?.autoEnabled || !env.KAKAO_REST_API_KEY || !env.OPENAI_API_KEY || !env.OPENAI_MODEL || !env.RADAR_QUEUE) return { skipped: true, reason: "disabled_or_unconfigured" };
  const lastScheduled = await radarDb(env).prepare("SELECT local_date FROM radar_runs WHERE trigger_type = 'scheduled' ORDER BY started_at DESC LIMIT 1").first();
  if (!shouldRunDaily({ autoEnabled: settings.autoEnabled, lastScheduledDate: lastScheduled?.local_date ?? null })) return { skipped: true, reason: "already_attempted" };
  return runRadarDiscovery(env, { trigger: "scheduled", localDate: seoulDateKey() });
}

export async function cleanupRadar(env) {
  await recoverStaleRadarRuns(radarDb(env));
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await radarDb(env).prepare("DELETE FROM radar_runs WHERE started_at < ?").bind(cutoff).run();
}
