# 검색·개인정보·약관 운영 계약

## 1. 검색 노출

- 대표 주소는 `https://byabalone.com/`이다. HTTP와 `www`는 경로·쿼리를 보존한 308로 대표 주소에 합친다.
- 홈, 제작 사례, 실제 제품 설치, 개인정보 처리방침, 이용약관은 초기 HTML에 제목, 고유 설명, 본문, 내부 링크와 canonical을 포함한다.
- `robots.txt`는 공개 문서를 허용하고 `/api/`를 크롤링 대상에서 제외하며 `sitemap.xml`을 알린다.
- `SoftwareApplication`은 실제 배포 제품인 AutoTrip에만 사용한다. 가격, 평점, 고객, 성능처럼 확인되지 않은 값은 만들지 않는다.
- 기능 시연 프로그램의 설치 미리보기는 `noindex, nofollow`이며 sitemap에 넣지 않는다. 설명 페이지는 외부 시스템 미연동과 예시 데이터 경계를 초기 HTML에도 표시한다.
- 유지 중인 `workers.dev` 주소는 응답 헤더의 `X-Robots-Tag`와 canonical로 색인을 막는다. GitHub Pages 호환 브리지는 배포 artifact 전체와 robots에 noindex/차단 규칙을 적용한다.
- 검색엔진 계정에서 사이트 소유권 확인, sitemap 제출, URL 검사, Naver Search Advisor 또는 IndexNow 등록은 파일 생성과 별개의 외부 증거다.

## 2. 코드와 개인정보 처리방침의 대응

| 공개 고지 | 구현 증거 |
|---|---|
| 이메일, 확인 코드 요약값, 10분 만료 | `email_challenges`, HMAC 요약, `requestCode`/`verifyCode` |
| 필수 문의 동의와 선택 마케팅 동의 분리 | `required_service`, `marketing`, `consent_events` |
| 세션 쿠키 최대 30일 | `abalone_inquiry`, `HttpOnly; Secure; SameSite=Lax`, `SESSION_SECONDS` |
| 미완료 90일, 완료 1년 | `INCOMPLETE_RETENTION_SECONDS`, `COMPLETED_RETENTION_SECONDS` |
| 대화·요구사항 D1, 첨부 원본 비공개 R2 | `INQUIRY_DB`, `INQUIRY_FILES`, 소유자 조건 쿼리 |
| OpenAI에 이메일 제외, Responses `store: false` | `openAIInput`, `/v1/responses` 요청 본문 |
| OpenAI 임시 파일 최대 30일과 삭제 시도 | `expires_after`, `OPENAI_FILE_SECONDS`, `deleteOpenAIFile` |
| Resend 이메일 확인과 운영자 전달 | `/emails`, `RESEND_API_KEY`, idempotency key |
| IP·이메일 요청 제한 정보의 요약 처리 | `digestRateKey`, `rate_limits` |
| 이용자 삭제와 정기 파기 | `deleteConversation`, `cleanupExpired` |

공개 동의 버전은 `2026-08-31-abalone-privacy`이며 브라우저와 Worker가 같은 값을 사용한다. 개인정보 고지와 구현 중 하나가 바뀌면 버전과 회귀 테스트를 함께 변경한다.

## 3. 최신 공식 근거

- 개인정보 보호법 제30조는 처리 목적, 보유 기간, 제3자 제공·파기·위탁, 권리 행사, 책임 연락처와 자동 수집 등을 개인정보 처리방침에 포함하도록 정한다. [국가법령정보센터](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127653)
- 개인정보 보호법 제28조의8은 동의에 의한 국외 이전 전에 항목, 국가·시기·방법, 수령자, 목적·기간, 거부 방법과 효과를 알리도록 정한다. [국가법령정보센터](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1033215841)
- OpenAI API 데이터는 기본적으로 모델 훈련에 쓰이지 않으며, Responses의 일반 오남용 모니터링 보관은 최대 30일이고 파일은 만료 설정 또는 API 삭제가 가능하다. [`store: false`는 별도의 조직 단위 ZDR을 의미하지 않는다.](https://developers.openai.com/api/docs/guides/your-data)
- OpenAI의 API 하위처리자는 미국을 포함한 여러 처리 국가를 사용하며 현재 프로젝트는 고정 국내 처리 endpoint를 설정하지 않았다. [OpenAI 하위처리자 목록](https://openai.com/policies/sub-processor-list/)
- Cloudflare는 미국 기반 글로벌 회사로 미국과 유럽경제지역 등에 정보를 저장·처리할 수 있다고 밝힌다. [Cloudflare 개인정보 정책](https://www.cloudflare.com/privacypolicy/)
- Resend의 계약 주체는 Plus Five Five, Inc.이며 현재 공개 하위처리자 목록은 미국 사업자를 열거한다. [Resend DPA](https://resend.com/legal/dpa), [하위처리자](https://resend.com/legal/subprocessors)
- 약관은 한글과 이해하기 쉬운 표현으로 작성하고 중요한 내용을 분명히 표시해야 한다. [약관법 제3조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025032403)

## 4. 유료 거래 전 차단 조건

현재 사이트는 문의를 정리할 뿐 온라인 결제, 청약, 확정 견적 또는 제작 계약을 체결하지 않는다. 유료 전자상거래를 시작하기 전에는 다음 실제 정보를 확인해 초기 화면과 계약 문서에 반영한다.

- 법적 상호 또는 성명과 대표자
- 영업소·소비자 불만 처리 주소
- 전화번호와 전자우편 주소
- 사업자등록번호와 해당 시 통신판매업 신고 정보
- 가격, 공급 시기, 검수, 청약철회·환불, 하자·유지보수, 지식재산권, 분쟁 처리 조건
- 개인정보 보호 책임자 지정 대상 여부와 실제 담당 정보
- 대한민국 개인정보·전자상거래 전문 검토

저장소에서 확인되지 않은 항목은 공개 placeholder로 만들지 않는다. 이 계약은 구현 검증 문서이며 법률 자문을 대체하지 않는다.
