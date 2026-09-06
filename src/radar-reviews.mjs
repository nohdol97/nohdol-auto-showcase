import { HttpError } from "./inquiry-core.mjs";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_COUNT = 10;
const MAX_TEXT_LENGTH = 600;
const PROFILE_ROUTE = "routes/kr.local-profile.$local_profile_id";
const FAILURES = {
  DAANGN_BLOCKED: "당근에서 공개 페이지 접근을 제한했습니다. 잠시 뒤 다시 시도해 주세요.",
  DAANGN_RATE_LIMITED: "당근 요청이 제한되었습니다. 잠시 뒤 다시 시도해 주세요.",
  DAANGN_FETCH_FAILED: "당근 페이지를 가져오지 못했습니다. 링크를 확인하고 다시 시도해 주세요.",
  DAANGN_PAGE_TOO_LARGE: "당근 페이지가 수집 가능한 크기를 초과했습니다.",
  DAANGN_UNSUPPORTED_PAGE: "당근 페이지 구조를 확인할 수 없습니다. 다른 공개 업체 링크를 입력해 주세요.",
  DAANGN_NO_REVIEWS: "초기 공개 페이지에서 고객 후기 본문을 찾지 못했습니다. 다른 업체 링크를 입력해 주세요.",
};

function failure(code) { return new HttpError(422, code, FAILURES[code]); }

export function normalizeDaangnUrl(value) {
  const invalid = () => new HttpError(400, "RADAR_INVALID_DAANGN_URL", "당근 공개 업체의 HTTPS 링크를 입력해 주세요.");
  if (typeof value !== "string" || value.length > 2048) throw invalid();
  const input = value.trim();
  // Check the raw authority and path before URL parsing can erase explicit ports or dot segments.
  const matched = /^https:\/\/www\.daangn\.com(\/[^?#]*)(?:[?#][\s\S]*)?$/i.exec(input);
  if (!matched || /[\\\u0000-\u0020\u007f]/.test(matched[1]) || /%(?:2f|2e|5c|25)/i.test(matched[1])) throw invalid();
  let path;
  try { path = decodeURIComponent(matched[1]); } catch { throw invalid(); }
  const profile = /^\/kr\/local-profile\/([\p{L}\p{N}_-]+-[a-z0-9]{1,64})\/$/u.exec(path);
  if (!profile) throw invalid();
  return `https://www.daangn.com/kr/local-profile/${encodeURIComponent(profile[1])}/`;
}

export function daangnQueuePlace(value) {
  const url = normalizeDaangnUrl(value);
  const segment = decodeURIComponent(new URL(url).pathname.split("/")[3]);
  const separator = segment.lastIndexOf("-");
  return {
    kakaoId: `daangn:${segment.slice(separator + 1)}`,
    name: segment.slice(0, separator).slice(0, 120),
    address: "공개 주소 확인 중", category: "당근 업체", phone: null,
    mapUrl: url, distanceMeters: null, daangnUrl: url,
  };
}

function plain(value, limit) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function reviewText(value) {
  if (typeof value !== "string") return "";
  // Minimize all text before applying the output limit, so a cut cannot retain half a contact detail.
  return plain(value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, " ")
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|kr|io|co|me|app|dev)(?:\/[^\s<>"']*)?\b/gi, " ")
    .replace(/(?:\+82[\s().-]?(?:0)?|0)\d{1,3}[\s().-]?\d{3,4}[\s().-]?\d{4}\b/g, " "), MAX_TEXT_LENGTH);
}

function publishedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseProfile(html) {
  // This is deliberately a known JSON assignment, never executable JavaScript or JSON-LD reviews.
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const assignment = /^\s*window\.__remixContext\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(script[1]);
    if (!assignment) continue;
    try {
      const data = JSON.parse(assignment[1]);
      const profile = data?.state?.loaderData?.[PROFILE_ROUTE]?.localProfile;
      if (profile && typeof profile === "object" && !Array.isArray(profile)) return profile;
    } catch { /* Schema mismatch is reported without exposing remote content. */ }
  }
  throw failure("DAANGN_UNSUPPORTED_PAGE");
}

export function parseDaangnReviews(html, value, fetchedAt = new Date().toISOString()) {
  const place = daangnQueuePlace(value);
  if (typeof html !== "string") throw failure("DAANGN_UNSUPPORTED_PAGE");
  if (new TextEncoder().encode(html).byteLength > MAX_PAGE_BYTES) throw failure("DAANGN_PAGE_TOO_LARGE");
  const profile = parseProfile(html);
  try {
    if (normalizeDaangnUrl(profile.href) !== place.daangnUrl || typeof profile.id !== "string" ||
        normalizeDaangnUrl(`https://www.daangn.com${profile.id}`) !== place.daangnUrl ||
        !Array.isArray(profile.reviews) || !plain(profile.name, 120)) throw new Error("profile mismatch");
  } catch { throw failure("DAANGN_UNSUPPORTED_PAGE"); }
  place.name = plain(profile.name, 120);
  place.address = plain(profile.address?.road || profile.address?.jibun, 300) || "공개 주소 없음";
  place.category = plain(profile.category?.name, 120) || "당근 업체";
  // Only the business's own public contact field may become a place contact.
  place.phone = typeof profile.phone === "string" && /^[+\d ()-]{7,30}$/.test(profile.phone) ? profile.phone : null;
  const observations = [];
  const customers = new Set();
  const replies = new Set();
  function append(kind, value, date, seen) {
    const text = reviewText(value);
    if (!text || seen.size >= MAX_REVIEW_COUNT || seen.has(text)) return;
    seen.add(text);
    observations.push({ id: `${kind === "customer_review" ? "review" : "reply"}-${seen.size}`, kind, text, publishedAt: publishedAt(date) });
  }
  for (const review of profile.reviews) {
    if (!review || typeof review !== "object" || review.postStopped === true) continue;
    append("customer_review", review.content, review.createdAt, customers);
    if (review.comment && typeof review.comment === "object") append("owner_reply", review.comment.content, review.comment.createdAt, replies);
    if (customers.size >= MAX_REVIEW_COUNT && replies.size >= MAX_REVIEW_COUNT) break;
  }
  return { place, evidence: {
    provider: "daangn", url: place.daangnUrl, fetchedAt, coverage: "initial_page",
    customerReviewCount: customers.size, ownerReplyCount: replies.size,
    reportedReviewCount: Number.isSafeInteger(profile.count?.reviewCount) && profile.count.reviewCount >= 0 ? profile.count.reviewCount : null,
    observations,
  } };
}

export async function collectDaangnReviews(value, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const url = normalizeDaangnUrl(value);
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure("DAANGN_FETCH_FAILED")); }, Math.max(1, Math.min(timeoutMs, 15_000)));
  });
  try {
    const response = await Promise.race([fetchImpl(url, {
      redirect: "manual", credentials: "omit", headers: { Accept: "text/html" }, signal: controller.signal,
    }), deadline]);
    if (response.body) reader = response.body.getReader();
    if (response.status === 403) throw failure("DAANGN_BLOCKED");
    if (response.status === 429) throw failure("DAANGN_RATE_LIMITED");
    if (!response.ok || response.redirected) throw failure("DAANGN_FETCH_FAILED");
    if (!/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) throw failure("DAANGN_UNSUPPORTED_PAGE");
    if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) throw failure("DAANGN_PAGE_TOO_LARGE");
    if (!reader) throw failure("DAANGN_UNSUPPORTED_PAGE");
    let size = 0;
    let html = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const { done, value: chunk } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_PAGE_BYTES) throw failure("DAANGN_PAGE_TOO_LARGE");
      html += decoder.decode(chunk, { stream: true });
    }
    html += decoder.decode();
    const result = parseDaangnReviews(html, url, new Date().toISOString());
    if (result.evidence.customerReviewCount === 0) throw failure("DAANGN_NO_REVIEWS");
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw failure("DAANGN_FETCH_FAILED");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
