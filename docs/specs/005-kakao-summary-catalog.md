# Kakao Summary 공개 안내와 설치 경계

상태: 공개 배포 및 인증 다운로드 검증 완료 · 예시 데이터 GIF 공개 반영·재생 검증 완료

## 문제와 목표

Kakao Summary v0.2.0을 Abalone에서 찾고 지원 환경과 데이터 처리 범위를 확인할 수 있어야 한다. 기존 AutoTrip 전용 활성화·결제 전 정지 설명이 이 프로그램의 기능처럼 표시되지 않아야 한다.

## 범위와 권한

원본은 private `nohdol97/kakao-summary`, tag `v0.2.0`, commit `fb82dea63326ac3ebe57bd8556c706a9939992ae`다. 이 변경은 공개 metadata와 생성 페이지만 소유한다. 설치 파일 승격, 최초 코드 발급, 제품키 발급, 원본 앱 변경은 포함하지 않는다. 인증 연결은 실제 배포 검증 전 `null`로 유지하고, 승인된 코드 설정과 정상 다운로드 검증 후 운영 gateway로 연결한다.

사용자가 승인한 후속 GIF는 실제 앱의 빌드된 화면을 격리된 로컬 환경에서 예시 응답으로 구동해 녹화한다. 이 영상은 화면 흐름을 설명하는 결정적 시연이며 실제 카카오톡 수집이나 OpenAI 실행 증거가 아니다. 이미 배포된 제품의 분류, 인증 endpoint, 설치 자산과 활성화 경계는 그대로 유지한다.

## 요구사항

1. `kakao-summary`의 카탈로그, `/apps/kakao-summary/`, `/install/kakao-summary/`, sitemap을 metadata로 생성한다. 승인된 예시 데이터 GIF를 추가할 때 시연의 출처와 외부 미연동 범위를 표시하며 실제 연동 실행 증거로 주장하지 않는다.
2. macOS 15 이상 Apple Silicon·Intel ZIP과 Windows x64를 구분한다. Windows는 진단과 이력 조회만 지원하며 카카오톡 대화 수집·요약을 제공한다고 주장하지 않는다. OS 감지는 허용된 platform metadata를 따르고 Mac CPU를 추측하지 않는다.
3. 원본 대화의 요약 API 전송, 사용자 제공 API 키의 실행 중 메모리 보관, 요약 이력의 로컬 저장을 안내한다. 별도 앱 활성화나 제품키를 요구하지 않는다. ZIP 전체 압축 해제, Mac `시작.command`·Windows `시작.cmd`, 터미널 `Ctrl+C` 종료와 본인의 OpenAI API 키를 안내한다. 대화방 열기의 읽음 처리와 OpenAI 전송을 고지한다.
4. 미연결 설치는 동적 제출을 막고 초기 HTML과 동적 화면에 제공 상태를 표시한다. 공개 자산에 코드·키·직접 설치 URL을 포함하지 않는다.
5. 기존 AutoTrip의 제품키 안내와 prototype 제공 경계를 유지한다.
6. `site/assets/kakao-summary-workflow.gif`는 실제 앱 화면에서 가상 대화방 선택 → 수집·요약 진행 → 요약 결과 → 근거 원문 확인 흐름을 보여 준다. 모든 프레임에 `기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동`을 표시한다. 실제 대화, 개인정보, API 키, 인증코드, 세션 URL, 브라우저 도구는 담지 않는다. 캡처 중 API는 예시 응답으로 대체하고 외부 통신은 차단한다.
7. 초기 상세 HTML과 동적 상세 화면 모두 GIF, 한국어 대체 텍스트와 캡션을 제공한다. 캡션은 실제 앱 화면에 예시 응답을 사용했고 실제 카카오톡 수집·OpenAI 요청을 실행하지 않았으며 Windows에서 대화 수집·요약을 지원하지 않는다는 점을 밝힌다. 제품은 `product` 분류와 기존 운영 gateway 및 세 ZIP 자산을 유지한다.
8. GIF는 최대 폭 1200px, 8MB 이하, 6–15초를 목표로 하며 첫·전환·중간·마지막 프레임을 검사한다. 재생은 [스펙 001](001-workflow-gif-autoplay.md)의 사용자 승인 예외를 따라 기존 직접 GIF 재생을 유지하고 포스터·재생 제어를 추가하지 않는다. 원본 캡처와 임시 프레임은 공개 자산에서 제외한다.

## 수용 기준과 검증

- `node --test tests/build-pages.test.mjs`: 새 앱의 초기 HTML·metadata·sitemap, 동적 detail/install 설명, 제출 차단, OS 선택과 기존 활성화 경계를 확인한다.
- `npm run verify`: 전체 회귀, 정적 빌드, Worker dry-run을 확인한다.
- Abalone static audit 및 390/768/1440px 렌더로 줄바꿈과 가로 넘침을 확인한다. 운영 연결은 별도 evidence다.
- GIF metadata와 생성된 GIF 파일 헤더·크기, 초기 HTML/동적 화면의 대체 텍스트·캡션, 기존 인증 제출을 회귀 테스트로 확인한다. 프레임의 출처·민감정보·상태 흐름은 캡처 요청 기록과 첫·전환·중간·마지막 이미지의 직접 검토로 확인한다. 픽셀 내용의 진실성은 문자열 회귀만으로 판정할 수 없으므로 이 독립 검토를 별도로 기록한다.
- 공개 반영은 운영 상세 페이지 및 GIF의 HTTP 상태와 로컬 빌드 해시 일치로 확인한다. 실제 카카오톡 수집·OpenAI 요청·검색엔진 색인 반영은 이 GIF 작업의 검증 범위 밖이다.

## 화면 적용 선언

Surface: responsive showcase. Foundation: 지원 범위와 설치 가능 상태를 우선 안내한다. Brand: 기존 흑백 토큰·정확한 로고·한국어 문체를 유지한다. Product: 대화 선택, 요약, 로컬 이력의 실제 흐름. States: 미제공, 로드 실패, 인증 실패 복구. Evidence: 긴 한국어 안내, 모바일·중간·데스크톱, 기존 focus와 reduced-motion 유지.

## 복구

새 metadata를 제거하면 생성 경로가 함께 제거된다. 다운로드 권한은 공개 metadata만으로 열리지 않으며, 인증 endpoint는 검증 전 계속 비활성이다.

GIF만 복구할 때는 새 GIF metadata와 공개 GIF 파일만 이전 상태로 되돌린다. 이미 검증된 제품·설치 경로와 gateway 연결은 유지한다.

## 로컬 검증 결과

2026-09-11: 새 앱 부재로 회귀 2개가 실패한 뒤 구현했다. `npm run verify` 75개 테스트, 정적 101개 자산 빌드와 Worker dry-run을 통과했다. Abalone static audit와 도구 5개 테스트를 통과했다. 실제 Chromium에서 390/768/1440px detail·install 6개 화면의 가로 넘침 없음과 설치 제출 비활성을 확인했다. 공개 배포와 실제 다운로드는 미검증이다.


## 공개 배포 결과

2026-09-11 사용자가 공개 게시·최초 코드 설정·Keychain 보관을 승인했다. `authEndpoint`를 운영 gateway에 연결하고 미제공 metadata를 제거했다. 새 인증 양식 회귀는 null endpoint에서 실패 후 정상 연결에서 통과했으며 Windows ZIP 선택, 정확한 app/asset 전송, 인증 거부 뒤 코드 삭제와 재시도를 확인했다. 전체 76개 회귀와 build/dry-run 통과. Worker `5eb07b2e-6941-425e-80a9-d2897cdd9192`가 100% 운영 중이며 apps.json·app.js·소개·설치 HTML·sitemap·robots가 로컬 빌드와 byte 일치한다. HTTP/www는 308, compatibility Worker는 noindex다.

독립 downloads 채널에서 세 ZIP의 정상 인증 다운로드 크기/SHA-256과 잘못된 코드401·다른 origin403·변조403·실제 발급 링크 만료403을 확인했다. Rate limiter는 운영 바인딩에 5회/60초로 존재하지만 제한된 원격 반복 호출에서는429를 관측하지 못했다. API·카카오 대화 재실행 및 검색엔진 색인 반영은 검증 범위 밖이다.

## 후속 GIF 로컬 검증 결과

2026-09-11: 사용자의 예시 데이터 시연 승인에 따라 실제 앱 화면의 결정적 GIF를 추가했다. 캡처 원본 `d8c847c`는 배포 tag `fb82dea`와 `docs/verification.md`만 다르며 화면 소스는 동일하다. 공개 GIF는 1200×850, 108프레임, 약 13.51초, 804,153바이트이고 SHA-256은 `11fbba4d18520cb37bbf2a4374d6eda1756a07252321db2e713c3d086b0df429`다.

새 회귀는 GIF 경로가 `null`인 기존 상태에서 실패한 뒤 통과했다. `npm run verify`는 77개 회귀, 정적 102개 자산과 Worker dry-run을 통과했다. Abalone 정적 감사와 `git diff --check`도 통과했다. `artifacts/kakao-summary-gif/render-local.mjs`의 격리된 Chromium 검증에서 390/768/1440px 상세·설치 6개 화면에 가로 넘침이 없고, GIF 원본 크기 1200×850 로딩, 시연 라벨·캡션, 설치 제출 활성 및 기존 ZIP 3종을 확인했다. 외부 요청과 인증 제출은 수행하지 않았다. 상세 화면의 세 너비 스크린샷을 직접 확인했다.

캡처 검토에서는 원본 0·38·50·82·107 프레임과 GIF 첫·마지막 디코딩 이미지를 확인했다. 항상 보이는 미연동 표시와 선택→진행→결과→근거 원문 흐름을 검토했으며 실제 대화나 비밀값은 사용하지 않았다. 무시된 `artifacts/kakao-summary-gif/capture-evidence.json`은 외부 요청·native 호출·모델 호출 각 0건, 예시 run 요청 1건을 기록한다. 이 영상은 실제 수집·모델 실행 성공의 증거가 아니다. 운영 GIF 게시와 운영 자산 해시 일치는 아래 결과로 확인했다.


## 후속 GIF 공개 반영 결과

`npm run deploy`가 Worker `71c07d8d-36f2-4e5b-bca3-b08d6faadc8f`를 게시했고 deployments list에서100% 적용을 확인했다. 운영 GIF는 HTTP200·image/gif·804,153바이트이며 로컬 GIF와 SHA-256이 일치한다. apps.json, 초기 상세 HTML 및 기존 설치 HTML도 로컬 build와 byte 일치한다. 실제 수집·요약 호출이나 설치 credential 변경은 없다.

운영 Chromium의390/1440px 상세에서 HTTP200, GIF1200×850 로딩, 넘침 없음과 정확한 고지를 확인했다. 각 너비에서1초 간격 이미지 캡처의 해시가 달라 재생을 확인했으며 기존 설치 양식은 활성 상태였다. 인증 제출은0건이다. 재현 명령은 무시된 `artifacts/kakao-summary-gif/render-live.mjs`이고 공개 화면 증거는 같은 폴더에 보관한다.
