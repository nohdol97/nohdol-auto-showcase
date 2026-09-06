# ADR 002: Radar 후보 분석을 Cloudflare Queue로 분리

- 날짜: 2026-09-06
- 상태: accepted

## 배경

Radar 수동 실행은 후보별 OpenAI 웹 검색을 HTTP 응답 이후 `ctx.waitUntil()`에서 이어갔다. Cloudflare HTTP 호출의 `waitUntil()`은 응답 후 최대 30초만 보장하지만 후보 분석 한 배치가 약 23초 걸렸고, 세 번째 후보 도중 호출이 종료되어 D1 실행 레코드가 `running`에 남았다. 최대 10곳과 최대 120초의 후보별 외부 호출은 짧은 후처리 경계에 맞지 않는다.

## 결정

기존 showcase Worker에 `RADAR_QUEUE` 생산자와 `nohdol-auto-showcase-radar` 소비자를 함께 둔다. 실행 API와 예약 작업은 D1 실행 및 발견 수를 먼저 저장한 뒤 후보별 공개 장소 메시지를 Queue에 넣는다. 같은 Worker의 Queue 핸들러가 OpenAI 분석, 후보 저장, 진행 집계와 실행 종료를 담당한다.

Queue는 최소 한 번 전달되므로 기존 `(run_id, kakao_id)` 고유 제약과 멱등 저장을 사용한다. 개별 메시지를 명시적으로 확인하거나 재시도하고, 세 번째 실패는 실패 후보로 남긴다. D1의 마지막 진행 시각을 이용한 15분 정체 복구를 별도로 두어 Queue 밖의 예외도 영구 잠금으로 이어지지 않게 한다.

## 대안

- HTTP 요청이 전체 분석을 기다림: 추가 리소스 없이 구현할 수 있지만 탭 종료·연결 해제 시 실행이 다시 중단되고 “화면을 닫아도 진행” 계약을 지킬 수 없다.
- 기존 `waitUntil()` 유지와 제한 시간 확대: CPU 제한은 외부 I/O 이후의 30초 후처리 수명을 늘리지 못하므로 문제를 해결하지 않는다.
- Cloudflare Workflows: 단계별 내구성과 관찰성이 더 강하지만 최대 10개의 독립 후보와 현재 운영 규모에는 정의·마이그레이션 복잡도가 크다.
- Cron에서 미완료 후보 재개: 별도 리소스는 줄지만 최대 5분 지연과 추가 작업 상태가 필요하고 수동 실행 반응성이 낮다.

## 결과

- 관리자 화면을 닫아도 후보 분석과 재시도가 Queue에서 계속된다.
- 후보별 완료가 D1에 반영되어 화면 진행 수와 실제 저장 수가 일치한다.
- Queue 리소스와 소비자 설정이 새로운 운영 의존성이 되며, Queue 생성과 Worker 배포를 별도 증거로 확인해야 한다.
- 최소 한 번 전달로 중복 가능성이 있으므로 모든 후보 소비는 멱등이어야 한다.
- Queue와 D1은 Worker 버전 롤백에 포함되지 않으므로 롤백 후에도 삭제하지 않고 호환 상태로 남긴다.

## 영향과 검증

- 영향: `src/radar-worker.mjs`, `src/worker.mjs`, `wrangler.jsonc`, `migrations/0003_radar_progress.sql`, `site/admin/radar/radar.js`, Radar 회귀 테스트와 운영 문서
- 검증: Radar 집중 회귀의 red-green, `npm run verify`, 원격 D1 마이그레이션 목록, Queue 목록·소비자 연결, 운영 3곳 실행 완료와 D1 집계
