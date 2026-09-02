import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_DEMO_PATH = /^\.\/assets\/[a-z0-9][a-z0-9.-]*\.gif$/;
const CANONICAL_ORIGIN = "https://byabalone.com";
const LAST_MODIFIED = "2026-08-31";

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 3 || !Array.isArray(catalog.apps)) throw new Error("apps.json must use schemaVersion 3 and define apps");
  const ids = new Set();
  for (const app of catalog.apps) {
    const kind = app.kind ?? "product";
    if (!SAFE_ID.test(app.id) || ids.has(app.id) || !app.name || !app.description || !["product", "prototype"].includes(kind)) throw new Error(`invalid app metadata: ${app.id}`);
    ids.add(app.id);
    if (kind === "prototype") {
      if (app.authEndpoint !== null || app.installPreview !== true || !app.demoGif || !app.demoAlt || !app.demoCaption || !app.demoLabel || !app.availabilityNote || !app.audience || !app.sector) throw new Error(`prototype ${app.id} must define a truthful disabled install preview`);
      if (!SAFE_DEMO_PATH.test(app.demoGif)) throw new Error(`invalid demo GIF path: ${app.id}`);
    } else if (!app.activationNote) throw new Error(`invalid app metadata: ${app.id}`);
    if (kind === "product" && app.authEndpoint !== null) {
      const endpoint = new URL(app.authEndpoint);
      if (endpoint.protocol !== "https:" || endpoint.pathname !== "/authorize") throw new Error(`invalid authorization endpoint: ${app.id}`);
    }
    if (kind === "product" && app.demoGif !== null && !SAFE_DEMO_PATH.test(app.demoGif)) throw new Error(`invalid demo GIF path: ${app.id}`);
    if (app.demoGif && (!app.demoAlt || !app.demoCaption)) throw new Error(`demo GIF requires alt text and caption: ${app.id}`);
    if (!Array.isArray(app.assets) || app.assets.length === 0 || app.assets.some((asset) => !SAFE_ID.test(asset.id) || !asset.label)) throw new Error(`app ${app.id} must define valid assets`);
    if (!SAFE_ID.test(app.defaultAssetId) || !app.assets.some((asset) => asset.id === app.defaultAssetId)) throw new Error(`app ${app.id} must define a valid default asset`);
  }
  return catalog;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function jsonLd(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function absolutePath(routePath) {
  return new URL(routePath, `${CANONICAL_ORIGIN}/`).href;
}

function metadata({ title, description, routePath, noindex = false, schemas = [] }) {
  const canonical = absolutePath(routePath);
  return [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    noindex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />',
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:locale" content="ko_KR" />`,
    `<meta property="og:site_name" content="Abalone" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${CANONICAL_ORIGIN}/icon-512.png?v=black-white" />`,
    '<meta name="twitter:card" content="summary" />',
    ...schemas.map((schema) => `<script type="application/ld+json">${jsonLd(schema)}</script>`),
  ].join("\n    ");
}

function routeDocument(template, { page, appId = "", baseHref, title, description, routePath, content, noindex = false, schemas = [] }) {
  return template
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, metadata({ title, description, routePath, noindex, schemas }))
    .replace(/<title>[\s\S]*?<\/title>/, `<base href="${escapeHtml(baseHref)}" />\n    <title>${escapeHtml(title)}</title>`)
    .replace('<body data-page="catalog">', `<body data-page="${escapeHtml(page)}"${appId ? ` data-app-id="${escapeHtml(appId)}"` : ""}>`)
    .replace('<main id="page" aria-busy="true"></main>', `<main id="page" aria-busy="false">${content}</main>`);
}

function homeSchemas() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Abalone",
      url: `${CANONICAL_ORIGIN}/`,
      logo: `${CANONICAL_ORIGIN}/icon-512.png?v=black-white`,
      email: "inquiry@mail.byabalone.com",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Abalone",
      url: `${CANONICAL_ORIGIN}/`,
      inLanguage: "ko-KR",
      description: "업무 흐름을 이해하고 필요한 프로그램을 작은 범위부터 검증하는 Abalone의 제작 사례와 문의 사이트입니다.",
    },
  ];
}

function softwareSchema(app) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: app.name,
    url: `${CANONICAL_ORIGIN}/apps/${app.id}/`,
    description: app.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: app.assets.map((asset) => asset.label).join(", "),
    inLanguage: "ko-KR",
    publisher: { "@type": "Organization", name: "Abalone", url: `${CANONICAL_ORIGIN}/` },
  };
}

function homeContent(catalog) {
  const cards = catalog.apps.map((app) => `
        <article class="catalog-card">
          <div class="product-mark" aria-hidden="true">${escapeHtml(app.name.slice(0, 1).toUpperCase())}</div>
          <div class="catalog-copy">
            <p class="app-kicker">${escapeHtml([app.audience, app.sector].filter(Boolean).join(" · ") || "맞춤 프로그램")}</p>
            <h3>${escapeHtml(app.name)}</h3>
            <p class="app-description">${escapeHtml(app.description)}</p>
            <div class="catalog-actions"><a class="primary-action" href="./apps/${escapeHtml(app.id)}/">${escapeHtml(app.name)} 제작 사례</a>${(app.kind ?? "product") === "product" ? `<a class="secondary-action" href="./install/${escapeHtml(app.id)}/">설치 안내</a>` : ""}</div>
          </div>
        </article>`).join("");
  return `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span></span>업무 가까이에서 만드는 프로그램</p>
          <h1>복잡한 일을 이해하고<br /><em>쓸 수 있는 흐름으로<br class="mobile-title-break" /> 정리합니다.</em></h1>
          <p class="intro">업종마다 사람, 규칙, 예외와 쓰는 도구가 다릅니다. 실제 담당자의 말과 화면으로 업무를 이해한 뒤, 가장 필요한 흐름을 작은 범위부터 검증하고 원격으로 적용합니다.</p>
          <div class="hero-actions"><a class="primary-action" href="#programs">제작 사례 보기</a><a class="secondary-action" href="?inquiry=open">프로그램 상담 시작</a></div>
        </div>
      </section>
      <section class="programs" id="programs" aria-labelledby="apps-title">
        <div class="section-heading"><div><p class="eyebrow"><span></span>제작 사례</p><h2 id="apps-title">업종별 문제를 이렇게 풀 수 있습니다</h2></div></div>
        <div class="app-list catalog-list">${cards}</div>
      </section>
      <aside class="notice" id="delivery"><span class="notice-icon">i</span><div><strong>공개 설명과 설치 권한은 분리되어 있습니다.</strong><p>프로그램 설명은 누구나 볼 수 있지만, 배포된 설치 파일은 서버 인증을 통과한 경우에만 짧은 시간 제공됩니다.</p></div></aside>`;
}

function detailContent(app) {
  const prototype = app.kind === "prototype";
  const demoPoster = app.demoGif?.replace(/\.gif$/i, "-poster.png");
  return `
      <section class="route-hero">
        <nav class="breadcrumb" aria-label="현재 위치"><a href="./#programs">제작 사례</a><span>/</span><span>${escapeHtml(app.name)}</span></nav>
        <span class="app-kicker">${escapeHtml([app.audience, app.sector].filter(Boolean).join(" · ") || "맞춤 프로그램")}</span>
        <div class="route-title-row"><div><h1>${escapeHtml(app.name)}</h1><p class="intro">${escapeHtml(app.description)}</p></div></div>
        <div class="hero-actions"><a class="primary-action" href="./install/${escapeHtml(app.id)}/">설치 페이지로 이동</a><a class="secondary-action" href="./#programs">전체 제작 사례</a></div>
      </section>
      <section class="detail-shell">
        ${app.demoGif ? `<figure class="workflow-demo"><span class="demo-label">${escapeHtml(app.demoLabel ?? "프로그램 흐름 · 결제 전 안전 정지")}</span><picture class="workflow-media"><source media="(prefers-reduced-motion: reduce)" srcset="${escapeHtml(demoPoster)}" /><img class="workflow-image" src="${escapeHtml(app.demoGif)}" alt="${escapeHtml(app.demoAlt)}" /></picture><figcaption class="workflow-caption">${escapeHtml(app.demoCaption)}</figcaption></figure>` : ""}
        <div class="info-grid"><article class="info-card"><strong>업무 흐름 확인</strong><p>${prototype ? "전용 입력, 실행 상태, 결과 화면을 예시 데이터로 확인합니다." : "프로그램 실행부터 연결된 사이트의 결제 전 안전 정지 지점까지 확인합니다."}</p></article><article class="info-card"><strong>제공 상태</strong><p>${prototype ? "기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동" : "검증된 프로그램 설명과 인증 설치 경로를 분리해 제공합니다."}</p></article></div>
        ${prototype ? `<p class="availability-notice">${escapeHtml(app.availabilityNote)} 기능 시연 화면이며 외부 시스템 미연동 상태입니다.</p>` : app.warning ? `<p class="warning route-warning">${escapeHtml(app.warning)}</p>` : ""}
      </section>`;
}

function installIndexContent(catalog) {
  const items = catalog.apps.map((app) => `<article class="app-card install-index-card"><div><span class="app-kicker">설치 안내</span><h2>${escapeHtml(app.name)}</h2><p class="app-description">${escapeHtml(app.description)}</p></div><a class="primary-action" href="./install/${escapeHtml(app.id)}/">${escapeHtml(app.name)} 설치 안내</a></article>`).join("");
  return `<section class="route-hero compact-route-hero"><p class="eyebrow"><span></span>인증 설치</p><h1>설치할 프로그램을 선택하세요</h1><p class="intro">실제 배포 프로그램은 프로그램별 인증을 거치며, 기능 예시는 다운로드 제공 여부를 분명히 표시합니다.</p></section><div class="install-index-list">${items}</div>`;
}

function installContent(app) {
  const prototype = app.kind === "prototype";
  return `<section class="route-hero compact-route-hero"><nav class="breadcrumb" aria-label="현재 위치"><a href="./install/">설치</a><span>/</span><span>${escapeHtml(app.name)}</span></nav><p class="eyebrow"><span></span>설치 안내</p><h1>${escapeHtml(app.name)} 설치</h1><p class="intro">${prototype ? "지원 운영체제 구성을 확인할 수 있지만 설치 파일과 인증코드는 현재 제공되지 않습니다." : "운영체제를 선택하고 공유받은 설치 인증코드를 입력하면 현재 최신 설치 파일만 전달됩니다."}</p></section><section class="install-layout"><div class="install-guide"><h2>${prototype ? "설치 제공 상태" : "설치와 활성화 순서"}</h2><article class="install-step"><span>01</span><strong>지원 환경 확인</strong><p>${escapeHtml(app.assets.map((asset) => asset.label).join(", "))}</p></article><article class="install-step"><span>02</span><strong>설치 파일</strong><p>${prototype ? "현재 다운로드 파일과 인증코드를 제공하지 않습니다." : "프로그램별 서버 인증 뒤 짧은 시간 동안 전달됩니다."}</p></article></div><div class="app-card install-card"><h2>${escapeHtml(app.name)}</h2><p>${prototype ? "기능 시연 화면 · 데모 데이터 · 외부 시스템 미연동" : "설치 인증은 브라우저에 코드를 저장하지 않는 동적 양식에서 진행합니다."}</p><a class="secondary-action full-action" href="./apps/${escapeHtml(app.id)}/">프로그램 설명 보기</a></div></section>`;
}

function privacyContent() {
  return `<article class="policy-page">
      <p class="eyebrow"><span></span>시행일 2026년 8월 31일</p><h1>개인정보 처리방침</h1>
      <p class="intro">Abalone 공개 사이트 운영자(이하 “운영자”)는 맞춤 프로그램 문의를 처리하는 데 필요한 범위에서 개인정보를 처리합니다. 현재 사이트는 결제나 유료 계약 체결 기능을 제공하지 않습니다.</p>
      <section><h2>1. 처리하는 정보와 목적</h2><table><thead><tr><th>구분</th><th>항목</th><th>목적</th><th>필수 여부</th></tr></thead><tbody><tr><td>이메일 확인</td><td>이메일, 확인 코드의 암호학적 요약값, 요청·확인 시각</td><td>문의자 확인, 회신, 중복·오남용 방지</td><td>필수</td></tr><tr><td>문의</td><td>대화 내용, 정리된 요구사항, 진행·전달 상태</td><td>요구사항 구체화와 담당자 전달</td><td>필수</td></tr><tr><td>첨부</td><td>첨부 파일, 파일명·형식·크기</td><td>문의 맥락과 자료 확인</td><td>선택</td></tr><tr><td>서비스 보호</td><td>접속 IP를 이용해 만든 제한용 요약값, 세션 식별자의 요약값, 접속·만료 시각</td><td>요청 제한, 세션 유지, 보안 사고 대응</td><td>자동 생성</td></tr><tr><td>소식 수신</td><td>이메일, 선택 동의 여부·버전·시각</td><td>새 프로그램과 서비스 소식</td><td>선택</td></tr></tbody></table><p>필수 정보 제공을 거부하면 문의 이메일 확인과 대화를 이용할 수 없습니다. 첨부와 소식 수신에 동의하지 않아도 문의할 수 있습니다. 주민등록번호, 계정 비밀번호, 결제정보, 실제 환자·사건·고객 정보처럼 문의에 불필요한 민감정보는 보내지 마세요.</p></section>
      <section><h2>2. 보유 기간과 파기</h2><ul><li>이메일 확인 코드: 발급 후 10분 또는 확인 완료 시까지</li><li>로그인 세션: 최대 30일</li><li>완료하지 않은 문의·대화·첨부: 최근 활동 후 90일</li><li>완료한 문의·대화·첨부·최종 요구사항: 완료 후 1년</li><li>OpenAI 임시 파일: 생성 후 최대 30일로 만료를 설정하며, 문의 삭제·만료 시 API 삭제도 시도</li><li>요청 제한용 요약값: 제한 창 만료 후 정기 삭제</li></ul><p>기간이 끝나거나 이용자가 삭제하면 D1의 연결 기록과 R2의 첨부 원본을 삭제합니다. 외부 처리자가 이미 보관한 보안·오남용 기록은 각 처리자의 계약과 법적 보존기간에 따라 즉시 삭제되지 않을 수 있습니다.</p></section>
      <section><h2>3. 처리위탁과 국외 처리</h2><p>문의 기능 제공을 위해 아래 사업자에게 필요한 범위의 처리를 맡깁니다. 전송은 암호화된 HTTPS API 요청 시 이루어지며, 고정된 국내 처리 지역은 현재 설정되어 있지 않습니다.</p><table><thead><tr><th>수탁자·연락처</th><th>처리 정보와 목적</th><th>처리 국가</th><th>기간</th></tr></thead><tbody><tr><td>Cloudflare, Inc.<br />dpo@cloudflare.com</td><td>웹 요청, 접속 IP, 이메일·대화·첨부의 D1/R2 저장, 보안·전송</td><td>미국·유럽경제지역 및 글로벌 네트워크 처리 지역</td><td>위 보유 기간과 Cloudflare 계약·법정 기간</td></tr><tr><td>OpenAI, OpCo, LLC 및 공개된 하위처리자<br />privacy@openai.com</td><td>이메일을 제외한 대화·첨부·요구사항의 답변 생성</td><td>미국을 포함한 공개 하위처리자 처리 국가(고정 지역 미설정)</td><td>Responses는 <code>store: false</code>; 오남용 모니터링 기록은 통상 최대 30일, 파일은 최대 30일 또는 조기 삭제</td></tr><tr><td>Plus Five Five, Inc. (Resend)<br />support@resend.com</td><td>이메일 주소, 확인 코드 메일, 완료 문의의 담당자 알림</td><td>미국</td><td>메일 전송 및 계약·법정 보존에 필요한 기간</td></tr></tbody></table><p>국외 처리를 거부하려면 문의 기능을 사용하지 않거나 아래 연락처로 동의를 철회할 수 있습니다. 국외 처리가 필요한 이메일 확인·대화 생성을 거부하면 해당 문의 기능은 제공할 수 없습니다.</p></section>
      <section><h2>4. 쿠키와 자동 수집</h2><p>로그인 상태 유지를 위해 <code>abalone_inquiry</code> 세션 쿠키 하나를 사용합니다. 쿠키에는 무작위 세션 값이 들어가며 서버에는 그 요약값만 저장합니다. 쿠키는 HttpOnly, Secure, SameSite=Lax로 설정됩니다. 브라우저에서 쿠키를 거부하거나 삭제할 수 있지만 문의 대화가 유지되지 않을 수 있습니다. 광고·행동 추적 쿠키는 사용하지 않습니다.</p></section>
      <section><h2>5. 이용자의 권리</h2><p>문의창에서 개별 문의를 직접 삭제할 수 있습니다. 이메일로 개인정보 열람, 정정, 삭제, 처리정지, 동의 철회와 소식 수신 철회를 요청할 수 있습니다. 본인 확인에 필요한 최소 정보를 요청할 수 있으며, 관계 법령상 제한 사유가 있으면 그 이유를 안내합니다.</p></section>
      <section><h2>6. 보호조치와 아동</h2><p>세션·확인 코드는 요약값으로 저장하고, 첨부는 비공개 저장소에 두며, 소유자 확인과 파일 형식·크기 제한을 적용합니다. 전송 구간은 HTTPS를 사용하고 공개 사이트와 설치 배포 권한을 분리합니다. 이 문의 서비스는 만 14세 이상을 대상으로 하며, 만 14세 미만 아동의 개인정보를 의도적으로 수집하지 않습니다.</p></section>
      <section><h2>7. 문의와 권리구제</h2><p>개인정보 업무 및 고충 처리 연락처: <a href="mailto:inquiry@mail.byabalone.com">inquiry@mail.byabalone.com</a>. 개인정보 침해에 관한 상담·분쟁조정은 개인정보침해 신고센터(118), 개인정보분쟁조정위원회 등 관계 기관에 요청할 수 있습니다.</p></section>
      <section><h2>8. 변경</h2><p>이 방침의 내용이 달라지면 시행 전에 이 페이지에서 변경일과 내용을 알립니다. 현재 동의 버전은 <code>2026-08-31-abalone-privacy</code>입니다.</p></section>
    </article>`;
}

function termsContent() {
  return `<article class="policy-page"><p class="eyebrow"><span></span>시행일 2026년 8월 31일</p><h1>이용약관</h1><p class="intro">이 약관은 Abalone 공개 사이트의 제작 사례, 설치 안내, 맞춤 프로그램 문의 기능 이용에 적용됩니다.</p>
      <section><h2>1. 사이트의 역할</h2><p>사이트는 프로그램 제작 사례와 제공 상태를 설명하고, 문의 내용을 정리하며, 실제 배포가 완료된 일부 프로그램의 인증 설치 경로를 안내합니다. 사이트에서 문의를 보내거나 정리된 요구사항을 확인하는 것만으로 제작 계약이 아닙니다.</p></section>
      <section><h2>2. 문의와 별도 계약</h2><p>문의 답변은 검토를 위한 대화이며 확정 견적, 납기, 성능, 지원 범위 또는 계약 체결을 보장하지 않습니다. 유료 제작을 진행할 경우 당사자 신원, 범위, 대금, 일정, 검수, 유지보수, 지식재산권, 해지·환불 조건을 확인한 별도 계약을 체결합니다. 현재 사이트는 온라인 결제나 청약을 받지 않습니다.</p></section>
      <section><h2>3. 제작 사례와 프로토타입</h2><p>실제 프로그램은 확인된 범위와 안전 정지 지점을 설명합니다. 프로토타입과 기능 시연 화면은 예시 데이터만 사용하며 외부 시스템과 연결되지 않습니다. 프로토타입 설치 페이지는 화면 구성을 보여줄 뿐 설치 파일이나 인증코드를 제공하지 않습니다. 화면·설명은 확정 제품 사양이나 제3자 서비스의 보증이 아닙니다.</p></section>
      <section><h2>4. 설치 파일과 코드</h2><p>설치 파일이 제공되는 경우 프로그램별 설치 인증코드를 서버에서 확인한 뒤 짧은 시간 동안 현재 파일에 접근하게 합니다. 코드를 다른 사람에게 공개하거나 접근 제한을 우회해서는 안 됩니다. 설치 파일의 서명·공증 상태와 운영체제 경고는 해당 설치 페이지의 최신 안내를 확인해야 합니다.</p></section>
      <section><h2>5. 이용자의 책임</h2><p>타인의 개인정보, 계정 정보, 결제정보, 영업비밀 또는 제공 권한이 없는 자료를 문의에 올리지 마세요. 서비스 방해, 과도한 자동 요청, 보안 우회, 코드·제품키의 무단 공유, 불법 목적 이용을 금지합니다. 외부 사이트에서 결제·제출·예약처럼 되돌리기 어려운 행동을 수행하기 전에는 이용자가 내용을 직접 확인해야 합니다.</p></section>
      <section><h2>6. 서비스 변경과 중단</h2><p>보안, 장애, 외부 제공자 변경 또는 운영상 필요에 따라 기능을 변경하거나 일시 중단할 수 있습니다. 가능한 경우 이 사이트에 중요한 변경을 알립니다. 저장·배포 장애가 발생하면 확인되지 않은 완료나 제공 가능 상태를 표시하지 않습니다.</p></section>
      <section><h2>7. 지식재산권</h2><p>사이트의 브랜드, 설명, 화면, 코드와 자료에 관한 권리는 운영자 또는 정당한 권리자에게 있습니다. 별도 허락 없이 복제·배포하거나 권리 표시를 제거할 수 없습니다. 제3자 서비스와 상표에 관한 권리는 각 권리자에게 있습니다.</p></section>
      <section><h2>8. 책임의 경계</h2><p>운영자는 고의 또는 과실로 이용자에게 발생한 손해에 대해 관계 법령이 정한 책임을 부담합니다. 다만 이용자가 권한 없는 자료를 제공하거나 안내된 안전 경계를 벗어난 행동을 한 경우, 또는 합리적으로 통제하기 어려운 외부 서비스 장애로 발생한 손해는 구체적 사정과 관계 법령에 따라 판단합니다. 이 조항은 법이 허용하지 않는 소비자 권리를 제한하지 않습니다.</p></section>
      <section><h2>9. 준거법과 분쟁</h2><p>대한민국 법을 준거법으로 합니다. 분쟁이 생기면 먼저 <a href="mailto:inquiry@mail.byabalone.com">inquiry@mail.byabalone.com</a>으로 해결을 요청할 수 있으며, 해결되지 않으면 관계 법령이 정한 조정기관 또는 민사소송법상 관할 법원을 이용할 수 있습니다.</p></section>
      <section><h2>10. 변경</h2><p>약관을 바꾸면 시행일과 주요 변경 내용을 이 페이지에 알립니다. 별도 유료 계약과 이 약관이 다르면 해당 계약과 관계 법령을 우선 적용합니다.</p></section></article>`;
}

function parseArguments(argv) {
  const options = { catalog: "apps.json", site: "site", output: "_site" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--catalog") options.catalog = value;
    else if (argv[index] === "--site") options.site = value;
    else if (argv[index] === "--output") options.output = value;
    else continue;
    index += 1;
  }
  return options;
}

async function writeRoute(template, output, routePath, documentOptions) {
  const directory = routePath === "/" ? output : path.join(output, routePath.slice(1));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), routeDocument(template, documentOptions));
}

export async function buildSite(options) {
  const catalog = validateCatalog(JSON.parse(await readFile(options.catalog, "utf8")));
  await rm(options.output, { recursive: true, force: true });
  await mkdir(options.output, { recursive: true });
  await cp(options.site, options.output, { recursive: true });
  await writeFile(path.join(options.output, "apps.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  const template = await readFile(path.join(options.site, "index.html"), "utf8");

  await writeRoute(template, options.output, "/", {
    page: "catalog", baseHref: "./", title: "Abalone — 업무 맞춤 프로그램 제작",
    description: "업무 흐름을 이해하고 필요한 맞춤 프로그램을 작은 범위부터 검증합니다. 제작 사례와 안전한 설치 안내, 프로그램 상담 방법을 확인하세요.",
    routePath: "/", content: homeContent(catalog), schemas: homeSchemas(),
  });
  await writeRoute(template, options.output, "/install/", {
    page: "install-index", baseHref: "../", title: "프로그램 설치 안내 — Abalone",
    description: "Abalone 프로그램별 지원 운영체제와 설치 제공 상태, 인증 설치 절차를 확인하세요.",
    routePath: "/install/", content: installIndexContent(catalog),
  });
  for (const app of catalog.apps) {
    const prototype = app.kind === "prototype";
    await writeRoute(template, options.output, `/apps/${app.id}/`, {
      page: "detail", appId: app.id, baseHref: "../../", title: `${app.name} 제작 사례 — Abalone`,
      description: `${app.description} ${prototype ? "예시 데이터로 구성한 외부 시스템 미연동 기능 시연입니다." : "실제 업무 흐름과 안전 정지 지점을 확인하세요."}`,
      routePath: `/apps/${app.id}/`, content: detailContent(app), schemas: prototype ? [] : [softwareSchema(app)],
    });
    if (!prototype || app.installPreview === true) {
      await writeRoute(template, options.output, `/install/${app.id}/`, {
        page: "install", appId: app.id, baseHref: "../../", title: `${app.name} 설치 안내 — Abalone`,
        description: prototype ? `${app.name}의 지원 운영체제와 설치 화면 예시입니다. 설치 파일과 인증코드는 현재 제공되지 않습니다.` : `${app.name}의 지원 운영체제, 인증 설치 절차와 제품키 사용 경계를 확인하세요.`,
        routePath: `/install/${app.id}/`, content: installContent(app), noindex: prototype,
      });
    }
  }
  await writeRoute(template, options.output, "/privacy/", {
    page: "policy", baseHref: "../", title: "개인정보 처리방침 — Abalone",
    description: "Abalone 문의 서비스가 처리하는 이메일, 대화, 첨부, 접속 정보와 보유기간, 국외 처리, 삭제 및 권리 행사 방법을 안내합니다.",
    routePath: "/privacy/", content: privacyContent(),
  });
  await writeRoute(template, options.output, "/terms/", {
    page: "policy", baseHref: "../", title: "이용약관 — Abalone",
    description: "Abalone 제작 사례, 문의, 프로토타입, 설치 안내의 이용 조건과 별도 유료 계약의 경계를 안내합니다.",
    routePath: "/terms/", content: termsContent(),
  });
  await writeFile(path.join(options.output, "404.html"), routeDocument(template, {
    page: "policy", baseHref: "./", title: "페이지를 찾을 수 없음 — Abalone",
    description: "요청한 Abalone 페이지를 찾을 수 없습니다.", routePath: "/404/", noindex: true,
    content: '<section class="route-hero missing-route"><p class="eyebrow"><span></span>찾을 수 없음</p><h1>페이지를 찾을 수 없습니다.</h1><p class="intro">주소를 확인하거나 제작 사례로 돌아가 주세요.</p><a class="primary-action" href="./#programs">전체 제작 사례로</a></section>',
  }));

  const sitemapPaths = ["/", "/install/", ...catalog.apps.map((app) => `/apps/${app.id}/`), ...catalog.apps.filter((app) => (app.kind ?? "product") === "product").map((app) => `/install/${app.id}/`), "/privacy/", "/terms/"];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map((item) => `  <url><loc>${absolutePath(item)}</loc><lastmod>${LAST_MODIFIED}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  await writeFile(path.join(options.output, "sitemap.xml"), sitemap);
  await writeFile(path.join(options.output, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`);
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSite(parseArguments(process.argv.slice(2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
