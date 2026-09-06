const states = Object.freeze({ login: "login", setup: "setup", ready: "ready", busy: "busy", empty: "empty", error: "error" });
const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const workspace = $("#workspace");
const loginForm = $("#login-form");
const loginStatus = $("#login-status");
const workspaceStatus = $("#workspace-status");
const settingsForm = $("#settings-form");
const runButton = $("#run-now");
const reviewForm = $("#review-form");
const reviewUrl = $("#review-url");
const reviewButton = $("#review-run");
const reviewStatus = $("#review-status");
const logoutButton = $("#logout");
let state = states.login;
let snapshot = null;
let selectedId = null;
let pollTimer = null;

function setState(next, message = "") {
  state = next;
  document.body.dataset.state = next;
  const busy = next === states.busy || snapshot?.lastRun?.status === "running";
  runButton.disabled = busy || snapshot?.configured === false || !snapshot?.settings;
  reviewButton.disabled = busy || snapshot?.reviewConfigured !== true;
  reviewUrl.disabled = busy;
  reviewForm.setAttribute("aria-busy", String(busy));
  settingsForm.querySelectorAll("input, select, button").forEach((control) => { control.disabled = busy; });
  workspaceStatus.textContent = message;
  workspaceStatus.dataset.state = next === states.error ? "error" : busy ? "busy" : "ready";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Requested-With": "abalone-showcase", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDistance(value) {
  if (!Number.isFinite(value)) return "거리 미확인";
  return value < 1000 ? `${value.toLocaleString("ko-KR")}m` : `${(value / 1000).toFixed(1)}km`;
}

function formatRun(run) {
  if (!run) return "아직 실행하지 않았습니다.";
  const labels = { running: "발굴 중", completed: "발굴 완료", partial: "일부 발굴 완료", failed: "발굴 실패" };
  const date = new Date(run.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
  const analyzed = run.candidatesAnalyzed ?? 0;
  const progress = run.placesFound > 0 ? `${analyzed}/${run.placesFound}곳 분석` : `${analyzed}곳 분석`;
  return `${date} · ${labels[run.status] ?? run.status} · ${progress}`;
}

function fillSettings(settings) {
  if (!settings) return;
  $("#location").value = settings.location;
  $("#keywords").value = settings.keywords.join(", ");
  $("#radius").value = String(settings.radiusMeters);
  $("#max-candidates").value = String(settings.maxCandidates);
  $("#auto-enabled").checked = settings.autoEnabled;
}

function addDefinition(container, label, value, className = "") {
  const group = element("div", `evidence-block ${className}`.trim());
  group.append(element("h3", "", label), element("p", "", value));
  container.append(group);
}

function publicLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

function renderReviewInsights(detail, analysis) {
  const evidence = analysis.reviewEvidence;
  const insights = analysis.reviewInsights;
  if (!evidence || !insights) return;
  const section = element("section", "review-evidence");
  section.append(element("h3", "", "후기에서 확인한 업무 신호"));
  const count = Number.isInteger(evidence.reportedReviewCount) ? `페이지에 표시된 전체 후기 ${evidence.reportedReviewCount}개` : "페이지의 전체 후기 수 미확인";
  section.append(element("p", "review-coverage", `당근 · 실제 수집 고객 후기 ${evidence.customerReviewCount}개 · 사장님 답글 ${evidence.ownerReplyCount}개\n${count} · 초기 페이지 일부 수집`));
  const fetchedAt = new Date(evidence.fetchedAt);
  section.append(element("p", "muted", `확인 시각 · ${Number.isNaN(fetchedAt.getTime()) ? "미확인" : fetchedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)`));
  for (const [kind, title] of [["customer_review", "고객 후기의 주장"], ["owner_reply", "사장님 답글"]]) {
    const group = element("div", "review-signals");
    group.append(element("h4", "", title));
    const signals = insights.signals.filter((signal) => signal.kind === kind);
    if (signals.length === 0) group.append(element("p", "muted", "이 구분에서 아이템 근거로 요약한 신호가 없습니다."));
    else {
      const list = element("ul", "review-signal-list");
      signals.forEach((signal) => list.append(element("li", "", `${signal.evidenceId} · ${signal.summary}`)));
      group.append(list);
    }
    section.append(group);
  }
  section.append(element("p", "review-limitation", insights.limitation));
  section.append(element("h3", "", "검증할 프로그램 아이템"));
  insights.items.slice(0, 3).forEach((item, index) => {
    const proposal = element("section", "review-item");
    proposal.append(element("h4", "", `${index + 1}. ${item.name}`), element("p", "muted", `근거 · ${item.evidenceIds.join(", ")}`));
    addDefinition(proposal, "업무 가설", item.hypothesis);
    addDefinition(proposal, "첫 확인 질문", item.firstQuestion);
    addDefinition(proposal, "작은 데모", item.demoScope);
    addDefinition(proposal, "검증 지표", item.validationMetric);
    section.append(proposal);
  });
  detail.append(section);
}

function renderDetail(candidate) {
  const detail = $("#evidence-detail");
  detail.replaceChildren();
  const heading = element("header", "detail-heading");
  const copy = element("div");
  copy.append(element("span", "confidence-label", `근거 신뢰도 ${candidate.confidence} · 출처 ${candidate.sourceCount}개`), element("h2", "", candidate.name), element("p", "", `${candidate.category} · ${candidate.address}`));
  const contact = element("div", "contact-actions");
  if (candidate.phone) {
    const phone = element("span", "public-phone", candidate.phone);
    const copyButton = element("button", "secondary-button", "전화번호 복사");
    copyButton.type = "button";
    copyButton.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(candidate.phone); setState(states.ready, "공개 전화번호를 복사했습니다."); }
      catch { setState(states.error, "전화번호를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요."); }
    });
    contact.append(phone, copyButton);
  } else contact.append(element("span", "muted", "공개 전화번호 없음"));
  const mapUrl = publicLink(candidate.mapUrl);
  if (mapUrl) {
    const hostname = new URL(mapUrl).hostname;
    const label = hostname === "www.daangn.com" ? "당근 업체 보기" : hostname === "place.map.kakao.com" ? "Kakao 장소 보기" : "업체 출처 보기";
    const link = element("a", "text-link", label);
    link.href = mapUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    contact.append(link);
  }
  heading.append(copy, contact);
  detail.append(heading);
  if (!candidate.analysis) {
    const failed = element("div", "analysis-failed");
    failed.append(element("strong", "", "공개 근거를 정리하지 못했습니다."), element("p", "", candidate.errorMessage || "업체 정보는 남아 있습니다. 출처에서 직접 확인하거나 다시 조사해 주세요."));
    detail.append(failed);
    return;
  }
  renderReviewInsights(detail, candidate.analysis);
  const ladder = element("div", "evidence-ladder");
  const facts = candidate.analysis.confirmedFacts.length ? candidate.analysis.confirmedFacts.join("\n") : "출처에서 확인된 구체적인 사실이 없습니다.";
  addDefinition(ladder, "1. 확인된 공개 사실", facts, "fact");
  addDefinition(ladder, "2. 검증할 페인포인트 가설", candidate.analysis.painHypothesis, "hypothesis");
  const offer = candidate.analysis.prototypeOffer;
  const offerText = offer
    ? `${offer.name}\n약속할 결과 · ${offer.promise}\n첫 데모 · ${offer.demoScope}\n받을 입력 · ${offer.requiredInput}\n효과 확인 · ${offer.proofOfValue}`
    : candidate.analysis.suggestedTool;
  addDefinition(ladder, "3. 제공할 프로토타입 서비스", offerText, "tool");
  addDefinition(ladder, "4. 첫 질문", candidate.analysis.openingQuestion, "question");
  addDefinition(ladder, "사실처럼 말하지 않을 것", candidate.analysis.doNotClaim, "boundary");
  detail.append(ladder);
  const sources = element("section", "source-section");
  sources.append(element("h3", "", "공개 근거"));
  if (candidate.analysis.sources.length === 0) sources.append(element("p", "muted", "확인 가능한 출처가 부족합니다. 이 후보의 가설은 낮은 신뢰도로만 사용하세요."));
  else {
    const list = element("ul", "source-list");
    candidate.analysis.sources.forEach((source) => {
      const item = element("li");
      const url = publicLink(source.url);
      const link = element(url ? "a" : "span", "", source.title);
      if (url) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      item.append(link, element("p", "", source.summary));
      list.append(item);
    });
    sources.append(list);
  }
  detail.append(sources);
}

function renderCandidates(candidates) {
  const list = $("#candidate-list");
  list.replaceChildren();
  $("#result-count").textContent = `${candidates.length}곳`;
  $("#empty-state").hidden = candidates.length > 0;
  $("#result-layout").hidden = candidates.length === 0;
  if (candidates.length === 0) return;
  if (!candidates.some((item) => item.id === selectedId)) selectedId = candidates[0].id;
  candidates.forEach((candidate) => {
    const item = element("li");
    const button = element("button", `candidate-button${candidate.id === selectedId ? " selected" : ""}`);
    button.type = "button";
    const topline = element("span", "candidate-topline");
    topline.append(element("span", "score", `${candidate.score}점`), element("span", "", formatDistance(candidate.distanceMeters)));
    button.append(topline, element("strong", "", candidate.name), element("span", "candidate-category", candidate.category), element("span", "candidate-contact", candidate.phone || "공개 전화번호 없음"));
    button.addEventListener("click", () => { selectedId = candidate.id; renderCandidates(candidates); });
    item.append(button);
    list.append(item);
  });
  renderDetail(candidates.find((item) => item.id === selectedId));
}

function renderSnapshot(data) {
  snapshot = data;
  fillSettings(data.settings);
  $("#run-summary").textContent = formatRun(data.lastRun);
  $("#service-warning").hidden = data.configured;
  reviewStatus.textContent = data.reviewConfigured ? "" : "후기 분석에 필요한 서버 설정이 없습니다. 관리자에게 설정 확인을 요청하세요.";
  renderCandidates(data.candidates);
  if (data.lastRun?.status === "running") setState(states.busy, "공개 장소와 근거를 조사하고 있습니다. 이 화면을 닫아도 계속 진행됩니다.");
  else if (data.lastRun?.status === "failed") setState(states.error, "최근 발굴을 완료하지 못했습니다. 설정과 API 상태를 확인한 뒤 다시 시도해 주세요.");
  else if (!data.settings && data.candidates.length === 0) setState(states.setup, "당근 업체 링크로 시작할 수 있습니다. 주변 업체를 찾으려면 위치와 업종을 저장해 주세요.");
  else if (data.candidates.length === 0) setState(states.empty, "아직 근거가 있는 후보가 없습니다. 범위를 바꾸거나 다시 발굴해 보세요.");
  else setState(states.ready, "확인된 사실과 가설을 나눠 검토하세요.");
}

async function loadState() {
  try {
    renderSnapshot(await api("/api/admin/radar/state"));
    if (state === states.busy) schedulePoll();
  } catch (error) {
    if (error.status === 401) showLogin();
    else {
      setState(states.error, error.message);
      if (snapshot?.lastRun?.status === "running") schedulePoll();
    }
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(loadState, 3000);
}

function showLogin() {
  clearTimeout(pollTimer);
  state = states.login;
  document.body.dataset.state = states.login;
  loginView.hidden = false;
  workspace.hidden = true;
  logoutButton.hidden = true;
  $("#password").value = "";
  $("#password").focus();
}

function showWorkspace() {
  loginView.hidden = true;
  workspace.hidden = false;
  logoutButton.hidden = false;
  $("#workspace-title").focus();
  loadState();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  loginStatus.textContent = "관리자 값을 확인하고 있습니다.";
  try {
    await api("/api/admin/radar/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    loginStatus.textContent = "";
    showWorkspace();
  } catch (error) { loginStatus.textContent = error.message; $("#password").focus(); }
  finally { submit.disabled = false; }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    location: $("#location").value,
    keywords: $("#keywords").value.split(",").map((item) => item.trim()).filter(Boolean),
    radiusMeters: Number($("#radius").value), maxCandidates: Number($("#max-candidates").value), autoEnabled: $("#auto-enabled").checked,
  };
  setState(states.busy, "검색 범위를 저장하고 있습니다.");
  try { await api("/api/admin/radar/settings", { method: "PUT", body: JSON.stringify(settings) }); await loadState(); }
  catch (error) { setState(states.error, error.message); }
});

runButton.addEventListener("click", async () => {
  setState(states.busy, "발굴 작업을 시작하고 있습니다.");
  try { await api("/api/admin/radar/runs", { method: "POST", body: "{}" }); schedulePoll(); }
  catch (error) { setState(states.error, error.message); }
});

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (reviewButton.disabled) return;
  const url = reviewUrl.value.trim();
  reviewStatus.textContent = "당근 후기 분석을 시작하고 있습니다.";
  setState(states.busy, "공개 후기를 읽고 검증할 아이템을 정리합니다.");
  try {
    await api("/api/admin/radar/review-runs", { method: "POST", body: JSON.stringify({ url }) });
    reviewStatus.textContent = "분석 중입니다. 이 화면을 닫아도 작업은 계속 진행됩니다.";
    schedulePoll();
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    reviewStatus.textContent = `${error.message} 입력한 주소는 그대로 있습니다. 확인 후 다시 시도해 주세요.`;
    setState(states.error, "후기 분석을 시작하지 못했습니다.");
    reviewUrl.focus();
    if (error.status === 409) schedulePoll();
  }
});

logoutButton.addEventListener("click", async () => {
  try { await api("/api/admin/radar/logout", { method: "POST", body: "{}" }); }
  finally { showLogin(); }
});

$("#settings-toggle").addEventListener("click", (event) => {
  settingsForm.hidden = !settingsForm.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!settingsForm.hidden));
  event.currentTarget.textContent = settingsForm.hidden ? "설정 펼치기" : "설정 접기";
});

api("/api/admin/radar/session").then((result) => result.authenticated ? showWorkspace() : showLogin()).catch(showLogin);
