function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(className, text, href) {
  const node = element("a", className, text);
  node.href = href;
  return node;
}

function routeHref(route, appId = "") {
  const suffix = appId ? `${route}/${appId}/` : `${route}/`;
  return new URL(suffix, document.baseURI).href;
}

function eyebrow(text) {
  const node = element("p", "eyebrow", text);
  node.prepend(element("span"));
  return node;
}

function statusBadge(text = "설치 인증코드 필요") {
  return element("span", "app-status", text);
}

function renderDemo(app, card) {
  if (!app.demoGif) return;
  const figure = element("figure", "workflow-demo");
  figure.append(element("span", "demo-label", "REAL PROGRAM · ACTUAL SITE · SAFE STOP"));
  const image = element("img", "workflow-image");
  image.src = app.demoGif;
  image.alt = app.demoAlt;
  image.loading = "lazy";
  image.decoding = "async";
  figure.append(image, element("figcaption", "workflow-caption", app.demoCaption));
  card.append(figure);
}

function renderInstallForm(app, card) {
  const form = element("form", "access-panel");
  const copy = element("div", "access-copy");
  copy.append(
    element("strong", "", "최신 버전 설치하기"),
    element("p", "", "공유받은 프로그램별 인증코드는 브라우저에 저장하지 않습니다."),
  );

  const assetLabel = element("label", "field-label", "운영체제");
  const asset = element("select", "field-control");
  asset.name = "assetId";
  for (const item of app.assets) {
    const option = element("option", "", item.label);
    option.value = item.id;
    asset.append(option);
  }
  const detectedAssetId = window.showcasePlatform.detectAssetId(
    navigator.userAgentData?.platform ?? navigator.platform ?? "",
    navigator.userAgent ?? "",
  );
  asset.value = app.assets.some((item) => item.id === detectedAssetId)
    ? detectedAssetId
    : app.defaultAssetId;
  assetLabel.append(asset);

  const codeLabel = element("label", "field-label", "설치 인증코드");
  const code = element("input", "field-control");
  code.type = "password";
  code.name = "code";
  code.autocomplete = "off";
  code.required = true;
  code.maxLength = 200;
  codeLabel.append(code);

  const submit = element("button", "download-link", "인증하고 최신 파일 받기");
  submit.type = "submit";
  const status = element(
    "p",
    "form-status",
    app.authEndpoint ? "" : "인증 서버 배포 후 다운로드가 활성화됩니다.",
  );
  status.role = "status";
  submit.disabled = !app.authEndpoint;
  form.append(copy, assetLabel, codeLabel, submit, status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "인증 중입니다…";
    try {
      const response = await fetch(app.authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id, assetId: asset.value, code: code.value }),
      });
      code.value = "";
      if (!response.ok) throw new Error("authorization failed");
      const result = await response.json();
      status.textContent = "인증되었습니다. 다운로드를 시작합니다.";
      window.location.assign(result.url);
    } catch {
      code.value = "";
      status.textContent = "인증에 실패했습니다. 코드와 네트워크 상태를 확인하세요.";
      submit.disabled = false;
      code.focus();
    }
  });
  card.append(form);
}

function renderCatalogCard(app, index) {
  const card = element("article", "app-card catalog-card");
  const number = element("span", "catalog-number", String(index + 1).padStart(2, "0"));
  const copy = element("div", "catalog-copy");
  copy.append(
    element("span", "app-kicker", "DESKTOP AUTOMATION"),
    element("h3", "", app.name),
    element("p", "app-description", app.description),
  );
  const actions = element("div", "catalog-actions");
  actions.append(
    link("primary-action", "프로그램 보기", routeHref("apps", app.id)),
    link("secondary-action", "설치 페이지", routeHref("install", app.id)),
  );
  copy.append(actions);
  card.append(number, copy, statusBadge("설치 가능"));
  return card;
}

function renderCatalog(catalog, page) {
  document.title = "nohdol auto — 데스크톱 자동화 카탈로그";
  const hero = element("section", "hero");
  hero.setAttribute("aria-labelledby", "hero-title");
  const heroCopy = element("div", "hero-copy");
  heroCopy.append(eyebrow("DESKTOP AUTOMATION CATALOG"));
  const title = element("h1", "", "반복 작업은 프로그램으로.");
  title.id = "hero-title";
  title.append(document.createElement("br"), element("em", "", "설치와 실행은 안전하게."));
  const intro = element(
    "p",
    "intro",
    "여러 자동화 프로그램의 실제 동작을 한곳에서 확인하세요. 각 프로그램은 독립적으로 관리되며 승인된 사용자에게 최신 설치 파일만 제공합니다.",
  );
  const heroActions = element("div", "hero-actions");
  heroActions.append(
    link("primary-action", "프로그램 카탈로그 보기", "#programs"),
    element("span", "availability", `${catalog.apps.length}개 프로그램 등록`),
  );
  heroCopy.append(title, intro, heroActions);

  const visual = element("div", "hero-visual");
  visual.setAttribute("aria-label", "프로그램별 자동화와 안전한 설치 흐름");
  visual.append(element("div", "visual-glow"));
  const consoleCard = element("div", "route-card catalog-console");
  const top = element("div", "route-card-top");
  const dots = element("span", "window-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(element("i"), element("i"), element("i"));
  top.append(dots, element("span", "", "NOHDOL AUTO / PROGRAM HUB"));
  const consoleTitle = element("div", "console-title");
  consoleTitle.append(
    element("span", "console-count", String(catalog.apps.length).padStart(2, "0")),
    element("p", "", "독립 프로그램\n하나의 안전한 배포 흐름"),
  );
  const progress = element("div", "progress-stack");
  for (const [step, name, detail, state] of [
    ["01", "프로그램 선택", "용도와 실제 동작 확인", "공개"],
    ["02", "설치 인증", "프로그램별 코드 검증", "보호"],
    ["03", "안전 실행", "최종 동작 전 명시적 경계", "제어"],
  ]) {
    const row = element("div", state === "제어" ? "safe-step" : "");
    const description = element("p");
    description.append(element("strong", "", name), document.createTextNode(detail));
    row.append(element("span", "", step), description, element("b", "", state));
    progress.append(row);
  }
  consoleCard.append(top, consoleTitle, progress);
  visual.append(consoleCard);
  hero.append(heroCopy, visual);

  const trust = element("section", "trust-strip");
  trust.setAttribute("aria-label", "공통 제공 원칙");
  for (const [number, text] of [
    ["01", "프로그램별 독립 관리"],
    ["02", "실제 동작 GIF 공개"],
    ["03", "인증코드 설치 보호"],
    ["04", "최신 버전만 제공"],
  ]) {
    const item = element("div");
    item.append(element("strong", "", number), element("span", "", text));
    trust.append(item);
  }

  const notice = element("aside", "notice");
  notice.id = "delivery";
  notice.setAttribute("aria-label", "설치 방식 안내");
  notice.append(element("span", "notice-icon", "⌁"));
  const noticeCopy = element("div");
  noticeCopy.append(
    element("strong", "", "설명 페이지와 설치 페이지를 분리했습니다."),
    element(
      "p",
      "",
      "프로그램 설명은 누구나 볼 수 있지만 설치 파일은 각 프로그램의 전용 설치 페이지에서 서버 인증을 통과한 경우에만 60초 동안 제공됩니다.",
    ),
  );
  notice.append(noticeCopy);

  const programs = element("section", "programs");
  programs.id = "programs";
  programs.setAttribute("aria-labelledby", "apps-title");
  const heading = element("div", "section-heading");
  const headingCopy = element("div");
  headingCopy.append(eyebrow("AVAILABLE PROGRAMS"));
  const appsTitle = element("h2", "", "필요한 자동화를 선택하세요");
  appsTitle.id = "apps-title";
  headingCopy.append(appsTitle);
  heading.append(headingCopy, element("p", "", `${catalog.apps.length}개 앱`));
  const list = element("div", "app-list");
  if (catalog.apps.length === 0) {
    list.append(element("p", "empty-message", "현재 공개된 프로그램이 없습니다."));
  } else {
    catalog.apps.forEach((app, index) => list.append(renderCatalogCard(app, index)));
  }
  programs.append(heading, list);
  page.append(hero, trust, notice, programs);
}

function renderDetail(app, page) {
  document.title = `${app.name} — nohdol auto`;
  const hero = element("section", "route-hero");
  const breadcrumb = element("nav", "breadcrumb");
  breadcrumb.setAttribute("aria-label", "현재 위치");
  breadcrumb.append(link("", "프로그램", new URL("./#programs", document.baseURI).href), element("span", "", "/"), element("span", "", app.name));
  hero.append(breadcrumb, element("span", "app-kicker", "DESKTOP AUTOMATION"));
  const header = element("div", "route-title-row");
  const copy = element("div");
  copy.append(element("h1", "", app.name), element("p", "intro", app.description));
  header.append(copy, statusBadge());
  const actions = element("div", "hero-actions");
  actions.append(
    link("primary-action", "설치 페이지로 이동", routeHref("install", app.id)),
    link("secondary-action", "전체 프로그램", new URL("./#programs", document.baseURI).href),
  );
  hero.append(header, actions);

  const detail = element("section", "detail-shell");
  renderDemo(app, detail);
  const infoGrid = element("div", "info-grid");
  for (const [title, text] of [
    ["실제 흐름 확인", "프로그램 실행부터 실제 사이트의 안전 정지 지점까지 공개 데모로 확인합니다."],
    ["최신 버전만", "설치 페이지는 해당 프로그램의 현재 배포 버전만 선택할 수 있습니다."],
    ["프로그램별 권한", "다른 프로그램의 인증코드나 설치 파일과 섞이지 않는 앱별 경계를 사용합니다."],
  ]) {
    const item = element("article", "info-card");
    item.append(element("strong", "", title), element("p", "", text));
    infoGrid.append(item);
  }
  detail.append(infoGrid);
  if (app.warning) detail.append(element("p", "warning route-warning", app.warning));
  page.append(hero, detail);
}

function renderInstallIndex(catalog, page) {
  document.title = "프로그램 설치 — nohdol auto";
  const hero = element("section", "route-hero compact-route-hero");
  hero.append(eyebrow("AUTHORIZED INSTALLATION"), element("h1", "", "설치할 프로그램을 선택하세요"));
  hero.append(
    element(
      "p",
      "intro",
      "설치 인증코드는 프로그램별로 관리됩니다. 선택한 프로그램의 전용 페이지에서 운영체제와 코드를 확인합니다.",
    ),
  );
  const list = element("div", "install-index-list");
  catalog.apps.forEach((app) => {
    const card = element("article", "app-card install-index-card");
    const copy = element("div");
    copy.append(element("span", "app-kicker", "LATEST RELEASE"), element("h2", "", app.name), element("p", "app-description", app.description));
    card.append(copy, link("primary-action", `${app.name} 설치`, routeHref("install", app.id)));
    list.append(card);
  });
  page.append(hero, list);
}

function renderInstall(app, page) {
  document.title = `${app.name} 설치 — nohdol auto`;
  const hero = element("section", "route-hero compact-route-hero");
  const breadcrumb = element("nav", "breadcrumb");
  breadcrumb.setAttribute("aria-label", "현재 위치");
  breadcrumb.append(link("", "설치", routeHref("install")), element("span", "", "/"), element("span", "", app.name));
  hero.append(breadcrumb, eyebrow("CODE-GATED INSTALLATION"), element("h1", "", `${app.name} 설치`));
  hero.append(
    element(
      "p",
      "intro",
      "운영체제를 선택하고 공유받은 설치 인증코드를 입력하면 현재 최신 설치 파일만 전달됩니다.",
    ),
  );

  const layout = element("section", "install-layout");
  const guide = element("div", "install-guide");
  guide.append(element("h2", "", "설치와 활성화 순서"));
  for (const [number, title, text] of [
    ["01", "최신 설치 파일 받기", "이 페이지에서 프로그램별 설치 인증코드를 서버로 검증합니다."],
    ["02", "운영체제 경고 확인", "현재 설치 파일은 서명·공증되지 않아 보안 경고가 표시될 수 있습니다."],
    ["03", "앱에서 한 번 활성화", app.activationNote],
  ]) {
    const step = element("article", "install-step");
    step.append(element("span", "", number), element("strong", "", title), element("p", "", text));
    guide.append(step);
  }
  guide.append(
    element(
      "p",
      "warning",
      "제품키는 설치한 앱의 제품키 입력란에서만 사용합니다. 이 공개 페이지에는 제품키 발급·조회·폐기 같은 관리자 기능이 없습니다.",
    ),
  );
  const card = element("div", "app-card install-card");
  const heading = element("div", "install-card-heading");
  heading.append(element("div", "brand-mark", app.name.slice(0, 1).toUpperCase()), element("div", ""));
  heading.lastElementChild.append(element("span", "app-kicker", "CURRENT RELEASE"), element("h2", "", app.name));
  card.append(heading);
  renderInstallForm(app, card);
  if (app.warning) card.append(element("p", "warning", app.warning));
  card.append(link("secondary-action full-action", "프로그램 설명 보기", routeHref("apps", app.id)));
  layout.append(guide, card);
  page.append(hero, layout);
}

function renderMissing(page) {
  document.title = "프로그램을 찾을 수 없음 — nohdol auto";
  const panel = element("section", "route-hero missing-route");
  panel.append(eyebrow("NOT FOUND"), element("h1", "", "프로그램을 찾을 수 없습니다."));
  panel.append(link("primary-action", "전체 프로그램으로", new URL("./#programs", document.baseURI).href));
  page.append(panel);
}

async function loadPage() {
  const page = document.querySelector("#page");
  const pageType = document.body.dataset.page ?? "catalog";
  const appId = document.body.dataset.appId ?? "";
  try {
    const response = await fetch(new URL("apps.json", document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error("catalog unavailable");
    const catalog = await response.json();
    const app = catalog.apps.find((item) => item.id === appId);
    if (pageType === "catalog") renderCatalog(catalog, page);
    else if (pageType === "install-index") renderInstallIndex(catalog, page);
    else if (!app) renderMissing(page);
    else if (pageType === "detail") renderDetail(app, page);
    else if (pageType === "install") renderInstall(app, page);
    else renderMissing(page);
  } catch {
    page.append(element("p", "empty-message route-error", "프로그램 목록을 불러오지 못했습니다."));
  } finally {
    page.setAttribute("aria-busy", "false");
  }
}

loadPage();
