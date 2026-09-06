import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDaangnUrl, daangnQueuePlace, parseDaangnReviews, collectDaangnReviews } from "../src/radar-reviews.mjs";

const url = "https://www.daangn.com/kr/local-profile/sample-demo123/";
const fetchedAt = "2026-09-06T10:00:00.000Z";
function review(content = "수업 후 연습 내용을 다시 확인하고 싶어요.", extra = {}) {
  return { __typename: "BusinessReview", content, createdAt: "2026-08-17T11:13:30.317011Z", postStopped: false,
    user: { nickname: "작성자 비공개", profileImage: "https://private.example/avatar" },
    comment: { __typename: "ReviewComment", content: "복습 자료를 안내해드릴게요.", createdAt: "2026-08-17T11:37:43.562482Z" }, ...extra };
}
function fixture(reviews = [review()], extra = {}) {
  const localProfile = { id: "/kr/local-profile/sample-demo123/", href: url, name: "가상 레슨실", status: "ACTIVE", __typename: "LocalProfile",
    address: { road: "경기도 수원시 영통구 가상로 1" }, category: { name: "골프" }, count: { reviewCount: 11 }, reviews, ...extra };
  return `<script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", review: [{ reviewBody: "잘못 분류된 사장님 답글" }] })}</script><script>window.__remixContext = ${JSON.stringify({ state: { loaderData: { "routes/kr.local-profile.$local_profile_id": { localProfile } } } })};</script>`;
}
const htmlResponse = (html = fixture(), init = {}) => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const hasCode = (code) => (error) => error.code === code;

test("[REG:radar.daangn_url] normalizes canonical profiles and rejects authority/path bypasses", () => {
  assert.equal(normalizeDaangnUrl(`${url}?utm_source=test#reviews`), url);
  assert.equal(normalizeDaangnUrl("https://www.daangn.com/kr/local-profile/가상업체-demo123/"), "https://www.daangn.com/kr/local-profile/%EA%B0%80%EC%83%81%EC%97%85%EC%B2%B4-demo123/");
  for (const bad of [url.replace("https:", "http:"), url.replace("www.", ""), url.replace("www.", "user@www."), url.replace(".com/", ".com:443/"), url.replace("sample", "%2e%2e/sample"), url.replace("sample", "a%2fb"), url.replace("sample", "a%252fb"), url.replace("sample", "../sample"), url.replace("local-profile", "articles"), url.replace("sample", "a\\b"), url.replace("sample", "a%00b")]) assert.throws(() => normalizeDaangnUrl(bad));
  assert.deepEqual(daangnQueuePlace(url), { kakaoId: "daangn:demo123", name: "sample", address: "공개 주소 확인 중", category: "당근 업체", phone: null, mapUrl: url, distanceMeters: null, daangnUrl: url });
});

test("[REG:radar.daangn_roles] extracts customer and owner separately, ignores JSON-LD and author profiles", () => {
  const result = parseDaangnReviews(fixture(), url, fetchedAt);
  assert.equal(result.place.name, "가상 레슨실");
  assert.equal(result.place.address, "경기도 수원시 영통구 가상로 1");
  assert.equal(result.evidence.coverage, "initial_page");
  assert.equal(result.evidence.customerReviewCount, 1);
  assert.equal(result.evidence.ownerReplyCount, 1);
  assert.equal(result.evidence.reportedReviewCount, 11);
  assert.equal(result.evidence.fetchedAt, fetchedAt);
  assert.deepEqual(result.evidence.observations.map(({ id, kind }) => ({ id, kind })), [{ id: "review-1", kind: "customer_review" }, { id: "reply-1", kind: "owner_reply" }]);
  assert.doesNotMatch(JSON.stringify(result), /작성자 비공개|private.example|잘못 분류된|profileImage|nickname/);
});

test("[REG:radar.daangn_limits] deduplicates, ignores stopped/empty entries, bounds text and strips contact details", () => {
  const first = review("연습 문의 foo@example.com 010-1234-5678 https://example.com 예약 www.example.org 안내 " + "가".repeat(1000));
  const result = parseDaangnReviews(fixture([first, first, review("", { comment: null }), review("숨겨진 후기", { postStopped: true }), ...Array.from({ length: 20 }, (_, i) => review(`후기 ${i}`, { comment: { content: `답글 ${i}` } }))]), url, fetchedAt);
  assert.equal(result.evidence.customerReviewCount, 10);
  assert.equal(result.evidence.ownerReplyCount, 10);
  assert.ok(result.evidence.observations.every(({ text }) => text.length <= 600));
  assert.doesNotMatch(JSON.stringify(result.evidence.observations), /foo@|010-1234|example.com|www.example|숨겨진 후기/);
  const orphan = parseDaangnReviews(fixture([review("")]), url, fetchedAt);
  assert.equal(orphan.evidence.customerReviewCount, 0);
  assert.equal(orphan.evidence.observations.filter((item) => item.kind === "customer_review").length, 0);
});

test("[REG:radar.daangn_schema] rejects mismatched profiles, absent/malformed hydration, and executable assignment", () => {
  for (const html of ["<html>changed</html>", fixture([], { href: url.replace("demo123", "other123") }), fixture([], { id: "/kr/local-profile/other-other123/" }), fixture([], { reviews: {} }), fixture().replace("window.__remixContext = ", "window.__remixContext = globalThis.__reviewExecuted = ")]) {
    assert.throws(() => parseDaangnReviews(html, url, fetchedAt), hasCode("DAANGN_UNSUPPORTED_PAGE"));
  }
  assert.equal(globalThis.__reviewExecuted, undefined);
});

test("[REG:radar.daangn_fetch] fetches with no credentials, redirects or privileged headers", async () => {
  const result = await collectDaangnReviews(`${url}?tracking=1`, { fetchImpl: async (target, options) => {
    assert.equal(target, url);
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.equal(new Headers(options.headers).has("authorization"), false);
    assert.equal(new Headers(options.headers).has("cookie"), false);
    return htmlResponse();
  } });
  assert.equal(result.evidence.customerReviewCount, 1);
});

test("[REG:radar.daangn_failures] reports access, rate, redirect, media, and no-review failures", async () => {
  for (const [response, code] of [[new Response("", { status: 403 }), "DAANGN_BLOCKED"], [new Response("", { status: 429 }), "DAANGN_RATE_LIMITED"], [new Response("", { status: 302, headers: { location: "https://elsewhere.example" } }), "DAANGN_FETCH_FAILED"], [new Response("{}", { headers: { "content-type": "application/json" } }), "DAANGN_UNSUPPORTED_PAGE"], [htmlResponse(fixture([])), "DAANGN_NO_REVIEWS"]]) {
    await assert.rejects(collectDaangnReviews(url, { fetchImpl: async () => response }), hasCode(code));
  }
});

test("[REG:radar.daangn_size] enforces streaming bytes without trusting content length", async () => {
  await assert.rejects(collectDaangnReviews(url, { fetchImpl: async () => htmlResponse("x".repeat(2 * 1024 * 1024 + 1)) }), hasCode("DAANGN_PAGE_TOO_LARGE"));
  await assert.rejects(collectDaangnReviews(url, { fetchImpl: async () => new Response("", { headers: { "content-type": "text/html", "content-length": String(2 * 1024 * 1024 + 1) } }) }), hasCode("DAANGN_PAGE_TOO_LARGE"));
});

test("[REG:radar.daangn_timeout] deadline covers fetch and stalled body stream", async () => {
  await assert.rejects(collectDaangnReviews(url, { timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) }), hasCode("DAANGN_FETCH_FAILED"));
  let cancelled = false;
  await assert.rejects(collectDaangnReviews(url, { timeoutMs: 10, fetchImpl: async () => htmlResponse(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } })) }), hasCode("DAANGN_FETCH_FAILED"));
  assert.equal(cancelled, true);
});
