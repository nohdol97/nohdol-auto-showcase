function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderDemo(app, card) {
  if (!app.demoGif) return;
  const figure = element("figure", "workflow-demo");
  figure.append(element("span", "demo-label", "TEST-ONLY WORKFLOW"));
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
  const title = element("strong", "", "최신 버전 설치하기");
  const description = element("p", "", "프로그램별 인증코드는 브라우저에 저장하지 않습니다.");
  copy.append(title, description);
  const assetLabel = element("label", "field-label", "운영체제");
  const asset = element("select", "field-control");
  asset.name = "assetId";
  for (const item of app.assets) {
    const option = element("option", "", item.label);
    option.value = item.id;
    asset.append(option);
  }
  assetLabel.append(asset);
  const codeLabel = element("label", "field-label", "인증코드");
  const code = element("input", "field-control");
  code.type = "password";
  code.name = "code";
  code.autocomplete = "off";
  code.required = true;
  code.maxLength = 200;
  codeLabel.append(code);
  const submit = element("button", "download-link", "인증하고 다운로드");
  submit.type = "submit";
  const status = element("p", "form-status", app.authEndpoint ? "" : "인증 서버 배포 후 다운로드가 활성화됩니다.");
  status.role = "status";
  submit.disabled = !app.authEndpoint;
  form.append(copy, assetLabel, codeLabel, submit, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "인증 중입니다…";
    try {
      const response = await fetch(app.authEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: app.id, assetId: asset.value, code: code.value }) });
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

function renderApp(app) {
  const card = element("article", "app-card");
  const header = element("div", "app-header");
  const heading = element("div");
  heading.append(
    element("span", "app-kicker", "DESKTOP AUTOMATION"),
    element("h3", "", app.name),
    element("p", "app-description", app.description),
  );
  header.append(heading, element("span", "app-status", "배포 준비됨"));
  card.append(header);
  renderDemo(app, card);
  renderInstallForm(app, card);
  if (app.warning) card.append(element("p", "warning", app.warning));
  return card;
}

async function loadCatalog() {
  const list = document.querySelector("#app-list");
  const status = document.querySelector("#catalog-status");
  try {
    const response = await fetch("./apps.json", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const catalog = await response.json();
    for (const app of catalog.apps) list.append(renderApp(app));
    status.textContent = `${catalog.apps.length}개 앱`;
  } catch {
    status.textContent = "목록을 불러오지 못했습니다.";
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

loadCatalog();
