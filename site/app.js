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

function isPrototype(app) {
  return app.kind === "prototype";
}

function hasInstallRoute(app) {
  return !isPrototype(app) || app.installPreview === true;
}

function renderDemo(app, card) {
  if (!app.demoGif) return;
  const figure = element("figure", "workflow-demo");
  figure.append(element("span", "demo-label", app.demoLabel ?? "프로그램 흐름 · 결제 전 안전 정지"));
  const picture = element("picture", "workflow-media");
  const reducedMotionSource = element("source");
  reducedMotionSource.media = "(prefers-reduced-motion: reduce)";
  reducedMotionSource.srcset = app.demoGif.replace(/\.gif$/i, "-poster.png");
  const image = element("img", "workflow-image");
  image.src = app.demoGif;
  image.alt = app.demoAlt;
  image.loading = card.classList.contains("detail-shell") ? "eager" : "lazy";
  image.decoding = "async";
  picture.append(reducedMotionSource, image);
  figure.append(picture, element("figcaption", "workflow-caption", app.demoCaption));
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
    app.authEndpoint ? "" : app.availabilityNote ?? "인증 서버 배포 후 다운로드가 활성화됩니다.",
  );
  status.role = "status";
  status.dataset.state = app.authEndpoint ? "ready" : "blocked";
  submit.disabled = !app.authEndpoint;
  form.append(copy, assetLabel, codeLabel, submit, status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!app.authEndpoint) return;
    submit.disabled = true;
    status.textContent = "인증 중입니다…";
    status.dataset.state = "busy";
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
      status.dataset.state = "success";
      window.location.assign(result.url);
    } catch {
      code.value = "";
      status.textContent = "인증에 실패했습니다. 코드와 네트워크 상태를 확인하세요.";
      status.dataset.state = "error";
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
  const domainLabel = [app.audience, app.sector].filter(Boolean).join(" · ") || "맞춤 프로그램";
  copy.append(
    element("span", "app-kicker", domainLabel),
    element("h3", "", app.name),
    element("p", "app-description", app.description),
  );
  const flow = element("p", "program-flow");
  const flowSteps = ["문제와 대상", "화면 흐름", "설치 안내"];
  flowSteps.forEach((step, flowIndex) => {
    if (flowIndex > 0) flow.append(element("i", "", "→"));
    flow.append(element("span", "", step));
  });
  const actions = element("div", "catalog-actions");
  actions.append(link("primary-action", "사례 보기", routeHref("apps", app.id)));
  if (hasInstallRoute(app)) actions.append(link("secondary-action", "설치 안내", routeHref("install", app.id)));
  copy.append(flow, actions);
  card.append(number, copy);
  return card;
}

function renderCatalog(catalog, page) {
  document.title = "Abalone — 업무 맞춤 프로그램 제작";
  const hero = element("section", "hero");
  hero.setAttribute("aria-labelledby", "hero-title");
  const heroCopy = element("div", "hero-copy");
  heroCopy.append(eyebrow("업무 가까이에서 만드는 프로그램"));
  const title = element("h1", "", "복잡한 일을 이해하고");
  title.id = "hero-title";
  const mobileTitleBreak = document.createElement("br");
  mobileTitleBreak.className = "mobile-title-break";
  const emphasizedTitle = element("em");
  emphasizedTitle.append("쓸 수 있는 흐름으로", mobileTitleBreak, " 정리합니다.");
  title.append(document.createElement("br"), emphasizedTitle);
  const intro = element(
    "p",
    "intro",
    "업종마다 사람, 규칙, 예외와 쓰는 도구가 다릅니다. 실제 담당자의 말과 화면으로 업무를 이해한 뒤, 가장 필요한 흐름을 작은 범위부터 검증하고 원격으로 적용합니다.",
  );
  const heroActions = element("div", "hero-actions");
  heroActions.append(
    link("primary-action", "제작 사례 보기", "#programs"),
    link("secondary-action", "프로그램 상담 시작", new URL("?inquiry=open", document.baseURI).href),
  );
  heroCopy.append(title, intro, heroActions);

  const visual = element("div", "hero-visual");
  visual.setAttribute("aria-label", "원격 맞춤 프로그램 제작 과정");
  const consoleCard = element("div", "route-card catalog-console");
  const top = element("div", "route-card-top");
  top.append(element("span", "", "진행 방식"), element("b", "path-state", "원격 밀착 협업"));
  const consoleTitle = element("div", "console-title");
  consoleTitle.append(
    element("h2", "", "이해부터 실제 적용까지"),
    element("p", "", "현업의 말과 화면을 바탕으로 필요한 범위를 함께 정합니다."),
  );
  const progress = element("div", "progress-stack");
  for (const [step, name, detail, state] of [
    ["01", "업무 이해", "사람·순서·규칙·예외 확인", "발견"],
    ["02", "작은 검증", "중요한 흐름부터 실제 화면으로 확인", "검증"],
    ["03", "적용과 개선", "사용 결과를 보고 합의한 범위에서 보완", "개선"],
  ]) {
    const row = element("div", state === "개선" ? "safe-step" : "");
    const description = element("p");
    description.append(element("strong", "", name), document.createTextNode(detail));
    row.append(element("span", "", step), description, element("b", "", state));
    progress.append(row);
  }
  consoleCard.append(top, consoleTitle, progress);
  visual.append(consoleCard);
  hero.append(heroCopy, visual);

  const notice = element("aside", "notice");
  notice.id = "delivery";
  notice.setAttribute("aria-label", "설치 방식 안내");
  notice.append(element("span", "notice-icon", "i"));
  const noticeCopy = element("div");
  noticeCopy.append(
    element("strong", "", "공개 설명과 설치 권한은 분리되어 있습니다."),
    element(
      "p",
      "",
      "프로그램 설명과 설치 페이지는 누구나 볼 수 있습니다. 배포가 완료된 설치 파일은 서버 인증을 통과한 경우에만 60초 동안 제공됩니다.",
    ),
  );
  notice.append(noticeCopy);

  const programs = element("section", "programs");
  programs.id = "programs";
  programs.setAttribute("aria-labelledby", "apps-title");
  const heading = element("div", "section-heading");
  const headingCopy = element("div");
  headingCopy.append(eyebrow("제작 사례"));
  const appsTitle = element("h2", "", "업종별 문제를 이렇게 풀 수 있습니다");
  appsTitle.id = "apps-title";
  headingCopy.append(appsTitle);
  heading.append(headingCopy);
  const list = element("div", "app-list catalog-list");
  if (catalog.apps.length === 0) {
    list.append(element("p", "empty-message", "현재 공개된 제작 사례가 없습니다."));
  } else {
    catalog.apps.forEach((app, index) => list.append(renderCatalogCard(app, index)));
  }
  programs.append(heading, list);
  page.append(hero, programs, notice);
}

function renderDetail(app, page) {
  document.title = `${app.name} — Abalone`;
  const hero = element("section", "route-hero");
  const breadcrumb = element("nav", "breadcrumb");
  breadcrumb.setAttribute("aria-label", "현재 위치");
  breadcrumb.append(link("", "제작 사례", new URL("./#programs", document.baseURI).href), element("span", "", "/"), element("span", "", app.name));
  const domainLabel = [app.audience, app.sector].filter(Boolean).join(" · ") || "맞춤 프로그램";
  hero.append(breadcrumb, element("span", "app-kicker", domainLabel));
  const header = element("div", "route-title-row");
  const copy = element("div");
  copy.append(element("h1", "", app.name), element("p", "intro", app.description));
  header.append(copy);
  const actions = element("div", "hero-actions");
  if (hasInstallRoute(app)) actions.append(link("primary-action", "설치 페이지로 이동", routeHref("install", app.id)));
  actions.append(link("secondary-action", "전체 제작 사례", new URL("./#programs", document.baseURI).href));
  hero.append(header, actions);

  const detail = element("section", "detail-shell");
  renderDemo(app, detail);
  const infoGrid = element("div", "info-grid");
  const detailPoints = isPrototype(app)
    ? [
        ["업무 흐름 확인", "업무 담당자가 보게 될 전용 입력, 실행 상태, 결과 화면을 확인합니다."],
        ["지원 환경", "Windows, macOS, Linux용 설치 페이지 구성을 확인할 수 있습니다."],
        ["설치 페이지", "지원 운영체제와 설치 절차를 확인할 수 있습니다. 설치 파일과 인증코드는 현재 제공되지 않습니다."],
      ]
    : [
        ["업무 흐름 확인", "프로그램 실행부터 연결된 사이트의 안전 정지 지점까지 화면으로 확인합니다."],
        ["편하게 쓰는 화면", "자주 쓰는 기능과 필요한 정보를 한눈에 찾고, 진행 상태와 다음 행동을 쉽게 알 수 있도록 다듬었습니다."],
        ["프로그램별 권한", "다른 프로그램의 인증코드나 설치 파일과 섞이지 않는 앱별 경계를 사용합니다."],
      ];
  for (const [title, text] of detailPoints) {
    const item = element("article", "info-card");
    item.append(element("strong", "", title), element("p", "", text));
    infoGrid.append(item);
  }
  detail.append(infoGrid);
  if (isPrototype(app)) detail.append(element("p", "availability-notice", app.availabilityNote));
  else if (app.warning) detail.append(element("p", "warning route-warning", app.warning));
  page.append(hero, detail);
}

function renderInstallIndex(catalog, page) {
  document.title = "프로그램 설치 — Abalone";
  const hero = element("section", "route-hero compact-route-hero");
  hero.append(eyebrow("인증 설치"), element("h1", "", "설치할 프로그램을 선택하세요"));
  hero.append(
    element(
      "p",
      "intro",
      "설치 인증코드는 프로그램별로 관리됩니다. 선택한 프로그램의 전용 페이지에서 운영체제와 코드를 확인합니다.",
    ),
  );
  const list = element("div", "install-index-list");
  catalog.apps.filter(hasInstallRoute).forEach((app) => {
    const card = element("article", "app-card install-index-card");
    const copy = element("div");
    copy.append(element("span", "app-kicker", "설치 안내"), element("h2", "", app.name), element("p", "app-description", app.description));
    card.append(copy, link("primary-action", `${app.name} 설치 안내`, routeHref("install", app.id)));
    list.append(card);
  });
  page.append(hero, list);
}

function renderInstall(app, page) {
  document.title = `${app.name} 설치 — Abalone`;
  const hero = element("section", "route-hero compact-route-hero");
  const breadcrumb = element("nav", "breadcrumb");
  breadcrumb.setAttribute("aria-label", "현재 위치");
  breadcrumb.append(link("", "설치", routeHref("install")), element("span", "", "/"), element("span", "", app.name));
  hero.append(breadcrumb, eyebrow("인증 설치"), element("h1", "", `${app.name} 설치`));
  hero.append(
    element(
      "p",
      "intro",
      isPrototype(app)
        ? "지원 운영체제와 설치 절차를 확인할 수 있습니다. 설치 파일과 인증코드는 현재 제공되지 않습니다."
        : "운영체제를 선택하고 공유받은 설치 인증코드를 입력하면 현재 최신 설치 파일만 전달됩니다.",
    ),
  );

  const layout = element("section", "install-layout");
  const guide = element("div", "install-guide");
  guide.append(element("h2", "", isPrototype(app) ? "설치 제공 상태" : "설치와 활성화 순서"));
  const installSteps = isPrototype(app)
    ? [
        ["01", "지원 운영체제 확인", "Windows, macOS, Linux 설치 페이지 구성을 제공합니다."],
        ["02", "설치 파일", "현재 다운로드 파일은 제공되지 않습니다."],
        ["03", "인증코드", "현재 프로그램별 설치 인증코드는 발급되지 않습니다."],
      ]
    : [
        ["01", "최신 설치 파일 받기", "이 페이지에서 프로그램별 설치 인증코드를 서버로 검증합니다."],
        ["02", "운영체제 경고 확인", "현재 설치 파일은 서명·공증되지 않아 보안 경고가 표시될 수 있습니다."],
        ["03", "앱에서 한 번 활성화", app.activationNote],
      ];
  for (const [number, title, text] of installSteps) {
    const step = element("article", "install-step");
    step.append(element("span", "", number), element("strong", "", title), element("p", "", text));
    guide.append(step);
  }
  if (!isPrototype(app)) guide.append(
    element(
      "p",
      "warning",
      "제품키는 설치한 앱의 제품키 입력란에서만 사용합니다. 이 공개 페이지에는 제품키 발급·조회·폐기 같은 관리자 기능이 없습니다.",
    ),
  );
  const card = element("div", "app-card install-card");
  const heading = element("div", "install-card-heading");
  heading.append(element("div", "product-mark", app.name.slice(0, 1).toUpperCase()), element("div", ""));
  heading.lastElementChild.append(element("span", "app-kicker", "설치 안내"), element("h2", "", app.name));
  card.append(heading);
  renderInstallForm(app, card);
  if (app.warning) card.append(element("p", "warning", app.warning));
  card.append(link("secondary-action full-action", "프로그램 설명 보기", routeHref("apps", app.id)));
  layout.append(guide, card);
  page.append(hero, layout);
}

function renderMissing(page) {
  document.title = "프로그램을 찾을 수 없음 — Abalone";
  const panel = element("section", "route-hero missing-route");
  panel.append(eyebrow("찾을 수 없음"), element("h1", "", "프로그램을 찾을 수 없습니다."));
  panel.append(link("primary-action", "전체 제작 사례로", new URL("./#programs", document.baseURI).href));
  page.append(panel);
}

function renderLoadError(page) {
  const panel = element("section", "route-error");
  panel.setAttribute("role", "alert");
  const title = element("h1", "", "프로그램 목록을 불러오지 못했습니다.");
  title.tabIndex = -1;
  panel.append(
    title,
    element("p", "app-description", "입력한 내용은 없습니다. 네트워크 상태를 확인한 뒤 다시 불러와 주세요."),
  );
  const retry = element("button", "primary-action", "다시 불러오기");
  retry.type = "button";
  retry.addEventListener("click", () => window.location.reload());
  panel.append(retry);
  page.append(panel);
  title.focus();
}

async function loadPage() {
  const page = document.querySelector("#page");
  const pageType = document.body.dataset.page ?? "catalog";
  const appId = document.body.dataset.appId ?? "";
  if (pageType === "policy") {
    page.setAttribute("aria-busy", "false");
    return;
  }
  try {
    const response = await fetch(new URL("apps.json", document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error("catalog unavailable");
    const catalog = await response.json();
    const app = catalog.apps.find((item) => item.id === appId);
    page.replaceChildren();
    if (pageType === "catalog") renderCatalog(catalog, page);
    else if (pageType === "install-index") renderInstallIndex(catalog, page);
    else if (!app) renderMissing(page);
    else if (pageType === "detail") renderDetail(app, page);
    else if (pageType === "install" && hasInstallRoute(app)) renderInstall(app, page);
    else renderMissing(page);
  } catch {
    page.replaceChildren();
    renderLoadError(page);
  } finally {
    page.setAttribute("aria-busy", "false");
  }
}

loadPage();
