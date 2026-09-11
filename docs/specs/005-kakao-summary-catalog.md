# Kakao Summary 공개 안내와 설치 경계

상태: 로컬 검증 완료 · 공개 배포 미검증

## 문제와 목표

Kakao Summary v0.2.0을 Abalone에서 찾고 지원 환경과 데이터 처리 범위를 확인할 수 있어야 한다. 기존 AutoTrip 전용 활성화·결제 전 정지 설명이 이 프로그램의 기능처럼 표시되지 않아야 한다.

## 범위와 권한

원본은 private `nohdol97/kakao-summary`, tag `v0.2.0`, commit `fb82dea63326ac3ebe57bd8556c706a9939992ae`다. 이 변경은 공개 metadata와 생성 페이지만 소유한다. 설치 파일 승격, 최초 코드 발급, 제품키 발급, 원본 앱 변경은 포함하지 않는다. 인증 연결은 실제 배포 검증 전 `null`로 유지한다.

## 요구사항

1. `kakao-summary`의 카탈로그, `/apps/kakao-summary/`, `/install/kakao-summary/`, sitemap을 metadata로 생성한다. GIF 없는 실제 제품을 허구 시연으로 채우지 않는다.
2. macOS 15 이상 Apple Silicon·Intel ZIP과 Windows x64를 구분한다. Windows는 진단과 이력 조회만 지원하며 카카오톡 대화 수집·요약을 제공한다고 주장하지 않는다. OS 감지는 허용된 platform metadata를 따르고 Mac CPU를 추측하지 않는다.
3. 원본 대화의 요약 API 전송, 사용자 제공 API 키의 실행 중 메모리 보관, 요약 이력의 로컬 저장을 안내한다. 별도 앱 활성화나 제품키를 요구하지 않는다. ZIP 전체 압축 해제, Mac `시작.command`·Windows `시작.cmd`, 터미널 `Ctrl+C` 종료와 본인의 OpenAI API 키를 안내한다. 대화방 열기의 읽음 처리와 OpenAI 전송을 고지한다.
4. 미연결 설치는 동적 제출을 막고 초기 HTML과 동적 화면에 제공 상태를 표시한다. 공개 자산에 코드·키·직접 설치 URL을 포함하지 않는다.
5. 기존 AutoTrip의 제품키 안내와 prototype 제공 경계를 유지한다.

## 수용 기준과 검증

- `node --test tests/build-pages.test.mjs`: 새 앱의 초기 HTML·metadata·sitemap, 동적 detail/install 설명, 제출 차단, OS 선택과 기존 활성화 경계를 확인한다.
- `npm run verify`: 전체 회귀, 정적 빌드, Worker dry-run을 확인한다.
- Abalone static audit 및 390/768/1440px 렌더로 줄바꿈과 가로 넘침을 확인한다. 운영 연결은 별도 evidence다.

## 화면 적용 선언

Surface: responsive showcase. Foundation: 지원 범위와 설치 가능 상태를 우선 안내한다. Brand: 기존 흑백 토큰·정확한 로고·한국어 문체를 유지한다. Product: 대화 선택, 요약, 로컬 이력의 실제 흐름. States: 미제공, 로드 실패, 인증 실패 복구. Evidence: 긴 한국어 안내, 모바일·중간·데스크톱, 기존 focus와 reduced-motion 유지.

## 복구

새 metadata를 제거하면 생성 경로가 함께 제거된다. 다운로드 권한은 공개 metadata만으로 열리지 않으며, 인증 endpoint는 검증 전 계속 비활성이다.

## 로컬 검증 결과

2026-09-11: 새 앱 부재로 회귀 2개가 실패한 뒤 구현했다. `npm run verify` 75개 테스트, 정적 101개 자산 빌드와 Worker dry-run을 통과했다. Abalone static audit와 도구 5개 테스트를 통과했다. 실제 Chromium에서 390/768/1440px detail·install 6개 화면의 가로 넘침 없음과 설치 제출 비활성을 확인했다. 공개 배포와 실제 다운로드는 미검증이다.
