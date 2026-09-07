# 당근 공개 후기의 Cloudflare 헤드리스 접근 실측

- 날짜: 2026-09-07
- 상태: 진단 성공, 운영 Radar 연결 미적용
- 관련 계약: [스펙 004](../specs/004-review-opportunity-items.md), [ADR 003](../adr/003-review-evidence-boundary.md)

## 확인할 문제

운영 Radar의 일반 HTTP 수집은 당근 접근 차단으로 실패했다. 같은 URL을 Mac의 Playwright 헤드리스 Chromium에서는 읽을 수 있었지만, 이 결과만으로 Cloudflare에서도 가능한지 알 수 없었다. 사용자가 Cloudflare 배포 후 실측을 요청했다.

## 시험 범위

기존 사이트와 별도인 `nohdol-radar-browser-probe-20260907` Worker를 동일 계정에 배포했다. Browser Run 바인딩, `nodejs_compat`, compatibility date `2026-09-06`, 정확히 고정한 `@cloudflare/puppeteer@1.4.0`을 사용했다. 로그인·기존 쿠키·프록시·User-Agent 변경 없이 공개 클럽메이커스 URL 하나만 탐색했다.

진단 요청은 인증된 `POST /probe`와 10분 만료로 제한하고 인증 값은 당근 요청에 전달하지 않았다. 탐색 제한은 30초이며 주 문서 리다이렉트는 중단했다. `response.status()`와 초기 응답 HTML을 기존 `parseDaangnReviews`에 전달해 확인했다. 작성자·후기 본문·HTML은 응답하거나 저장하지 않고 집계만 기록했다. 브라우저는 `finally`에서 종료했다.

## 관찰 결과

| 표면 | 결과 | 입증 범위 |
|---|---|---|
| 로컬 합성 진단 테스트 | 4개 통과, 미구현 상태의 실패 먼저 확인 | 인증·만료·고정 주소·403 중단·파서 오류 비노출·브라우저 종료 |
| Wrangler dry-run | 689.48 KiB, Browser Run 바인딩 확인 | 배포 설정과 번들 생성, 인증 원값 번들 미포함 |
| 원격 배포 | `bf453e6c-6695-40e3-87a2-024f8c314545`, 트래픽 100% | 실제 Cloudflare 배포 버전 |
| 미인증 요청 | GET 405, POST 401 | 브라우저 실행 전 진단 경계 |
| 실제 Browser Run | 2026-09-07 09:01 KST, HTTP 200, 최종 URL 일치 | 해당 시점·해당 업체의 Cloudflare headless 접근 성공 |
| 기존 후기 파서 | 고객 후기 8개, 사장님 답글 5개, 페이지 표시 전체 11개 | 초기 페이지 일부 데이터의 역할별 수집 성공 |
| 브라우저 종료 | `browserClosed: true` | 실제 세션의 정상 종료 |

## 해석과 다음 변경 범위

이 표본에서는 Cloudflare Browser Run을 사용하면 기존 일반 HTTP 수집의 접근 실패를 해결할 수 있었다. 원래 차단의 정확한 원인이나 모든 업체·지속 실행의 안정성을 입증한 것은 아니다. 전체 후기 수집, 실제 OpenAI 아이템 생성, 운영 Radar와 Browser Run의 연결은 이번 시험에 포함하지 않았다.

운영에 연결할 때는 Queue 소비자의 당근 수집 단계에 브라우저 경로를 적용하고, 제한 시간·크기·출처 역할·오류 처리·종료와 비용 범위를 다시 검증해야 한다. 이번 진단만으로 기존 Radar가 Browser Run을 사용한다고 표시하지 않는다.

## 진단 종료

시험 후 같은 진단 Worker를 HTTP 410만 반환하는 버전 `187bba5a-caad-4147-97f9-63244fbe0dac`으로 재배포하고 Browser Run 바인딩을 제거했다. 해당 버전의 트래픽 100%와 실제 POST 410을 확인했다. 기존 `nohdol-auto-showcase`는 버전 `aed7f0ef-bf49-452c-bce0-66745cbc7d0b`를 유지하고 health는 `ready`였다. 기존 도메인·D1·Queue·비밀값은 변경하지 않았다.

## 공식 근거

- [Cloudflare Browser Run 시작 안내](https://developers.cloudflare.com/browser-run/get-started/): Worker의 브라우저 바인딩과 Puppeteer 실행.
- [Cloudflare Browser Run FAQ](https://developers.cloudflare.com/browser-run/faq/): Cloudflare에서 봇으로 식별되므로 로컬 성공을 운영 성공으로 간주할 수 없는 이유.
- [Puppeteer Page.goto](https://pptr.dev/api/puppeteer.page.goto): HTTP 오류가 탐색 예외와 같지 않으므로 응답 상태를 별도 확인.
