import { renderMarkdown } from "./markdown.js";

(() => {
  const PRIVACY_VERSION = "2026-08-30-abalone";
  const byId = (id) => document.getElementById(id);
  const dialog = byId("inquiry-dialog");
  const auth = byId("inquiry-auth");
  const chat = byId("inquiry-chat");
  const emailForm = byId("inquiry-email-form");
  const codeForm = byId("inquiry-code-form");
  const messageForm = byId("inquiry-message-form");
  const messages = byId("inquiry-messages");
  const choices = byId("inquiry-choices");
  const attachments = byId("inquiry-attachments");
  const completion = byId("inquiry-completion");
  const authStatus = byId("inquiry-auth-status");
  const chatStatus = byId("inquiry-chat-status");
  const sendButton = byId("inquiry-send");
  let dialogReturnFocus = null;
  const state = { challengeId: null, email: null, conversationId: null, attachmentIds: [], busy: false, retryMessageId: null, retryContent: null, formStartedAt: Date.now() };

  function setStatus(node, message, kind = "") {
    node.textContent = message;
    node.dataset.state = kind;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET") headers.set("X-Requested-With", "abalone-showcase");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(result.error?.message ?? "잠시 후 다시 시도해 주세요.");
      error.code = result.error?.code;
      throw error;
    }
    return response;
  }

  function showAuth() {
    auth.hidden = false;
    chat.hidden = true;
  }

  function restoreDialogFocus() {
    const returnTarget = dialogReturnFocus;
    dialogReturnFocus = null;
    if (returnTarget?.isConnected) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => returnTarget.focus()));
    }
  }

  function closeInquiry() {
    dialog.close();
    restoreDialogFocus();
  }

  function showChat(email) {
    auth.hidden = true;
    chat.hidden = false;
    byId("inquiry-user-email").textContent = email;
  }

  function messageNode(role, content, pending = false) {
    const article = document.createElement("article");
    article.className = `chat-message ${role}`;
    if (pending) article.classList.add("pending");
    const label = document.createElement("strong");
    label.textContent = role === "assistant" ? "Abalone 도우미" : "나";
    const body = document.createElement("div");
    body.className = "message-body markdown-body";
    renderMarkdown(body, content);
    article.append(label, body);
    messages.append(article);
    article.scrollIntoView({ block: "nearest" });
    return { article, body, markdown: content };
  }

  function emptyConversation() {
    messages.replaceChildren();
    messageNode("assistant", "안녕하세요. 어떤 업종에서 어떤 일을 하고 계신가요? 지금 하는 순서, 자주 생기는 문제, 만들고 싶은 결과 중 편한 것부터 알려주세요. 화면이나 문서를 함께 보여주셔도 좋아요. 로그인 정보나 불필요한 개인정보는 적지 말아 주세요.");
    choices.replaceChildren();
    completion.hidden = true;
    state.attachmentIds = [];
    renderAttachments();
  }

  function renderChoices(cards = []) {
    choices.replaceChildren();
    for (const card of cards) {
      const group = document.createElement("section");
      group.className = "choice-card";
      const title = document.createElement("strong");
      title.textContent = card.question;
      group.append(title);
      const options = document.createElement("div");
      options.className = "choice-options";
      for (const option of card.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice-option";
        const label = document.createElement("strong");
        label.textContent = option.label;
        const description = document.createElement("span");
        description.textContent = option.description;
        button.append(label, description);
        button.addEventListener("click", () => {
          byId("inquiry-message").value = `${card.question}\n선택: ${option.label}`;
          byId("inquiry-message").focus();
        });
        options.append(button);
      }
      group.append(options);
      choices.append(group);
    }
  }

  function applySpec(spec) {
    const ready = spec?.readyForReview === true;
    renderMarkdown(byId("inquiry-spec-markdown"), spec?.markdown ?? "");
    completion.hidden = !ready;
    if (ready) completion.scrollIntoView({ block: "nearest" });
    renderChoices(spec?.choices ?? []);
  }

  function renderAttachments() {
    attachments.replaceChildren();
    for (const attachment of state.attachmentIds) {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      chip.textContent = attachment.filename;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `${attachment.filename} 이번 메시지에서 빼기`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        state.attachmentIds = state.attachmentIds.filter((item) => item.id !== attachment.id);
        renderAttachments();
      });
      chip.append(remove);
      attachments.append(chip);
    }
  }

  async function loadConversation(id) {
    const response = await api(`/api/conversations/${encodeURIComponent(id)}`);
    const result = await response.json();
    state.conversationId = result.conversation.id;
    messages.replaceChildren();
    if (result.messages.length === 0) emptyConversation();
    else for (const item of result.messages) messageNode(item.role, item.content);
    applySpec(result.spec);
    if (result.conversation.status === "completed") {
      messageForm.hidden = true;
      completion.hidden = true;
      setStatus(chatStatus, "완료된 문의입니다. 내용을 확인한 뒤 빠른 시일 안에 이메일로 답변드릴게요.", "success");
    } else {
      messageForm.hidden = false;
    }
  }

  async function enterChat(user) {
    showChat(user.email);
    setStatus(chatStatus, "문의 내역을 불러오는 중입니다…", "busy");
    try {
      const response = await api("/api/conversations");
      const result = await response.json();
      const active = result.conversations.find((item) => item.status !== "completed");
      if (active) await loadConversation(active.id);
      else {
        const created = await api("/api/conversations", { method: "POST", body: "{}" });
        const createdResult = await created.json();
        state.conversationId = createdResult.conversation.id;
        emptyConversation();
      }
      setStatus(chatStatus, "");
    } catch (error) {
      setStatus(chatStatus, error.message, "error");
    }
  }

  async function restoreSession() {
    try {
      const response = await api("/api/auth/session");
      const result = await response.json();
      if (result.authenticated) await enterChat(result.user);
      else showAuth();
    } catch {
      showAuth();
    }
  }

  async function consumeSse(response, assistant) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = done ? "" : frames.pop() ?? "";
      for (const frame of frames) {
        let event = "message";
        let data = null;
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data = JSON.parse(line.slice(5).trim());
        }
        if (!data) continue;
        if (event === "delta") {
          assistant.markdown += data.text;
          renderMarkdown(assistant.body, assistant.markdown);
        }
        if (event === "state") applySpec(data);
        if (event === "error") throw new Error(data.message);
      }
      if (done) break;
    }
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = emailForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(authStatus, "확인 메일을 보내는 중입니다…", "busy");
    try {
      state.email = byId("inquiry-email").value.trim();
      const response = await api("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({
          email: state.email,
          requiredService: byId("inquiry-required-consent").checked,
          marketing: byId("inquiry-marketing-consent").checked,
          privacyVersion: PRIVACY_VERSION,
          website: byId("inquiry-website").value,
          formStartedAt: state.formStartedAt,
        }),
      });
      const result = await response.json();
      state.challengeId = result.challengeId;
      byId("inquiry-code-email").textContent = state.email;
      emailForm.hidden = true;
      codeForm.hidden = false;
      byId("inquiry-code").focus();
      setStatus(authStatus, result.message, "success");
    } catch (error) {
      setStatus(authStatus, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = codeForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(authStatus, "코드를 확인하는 중입니다…", "busy");
    try {
      const response = await api("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ challengeId: state.challengeId, code: byId("inquiry-code").value }),
      });
      const result = await response.json();
      byId("inquiry-code").value = "";
      await enterChat(result.user);
    } catch (error) {
      setStatus(authStatus, error.message, "error");
      byId("inquiry-code").select();
    } finally {
      button.disabled = false;
    }
  });

  byId("inquiry-email-back").addEventListener("click", () => {
    state.challengeId = null;
    byId("inquiry-code").value = "";
    codeForm.hidden = true;
    emailForm.hidden = false;
    byId("inquiry-website").value = "";
    state.formStartedAt = Date.now();
    setStatus(authStatus, "");
    byId("inquiry-email").focus();
  });

  byId("inquiry-file").addEventListener("change", async (event) => {
    const selected = [...event.target.files].slice(0, 5 - state.attachmentIds.length);
    event.target.value = "";
    for (const file of selected) {
      setStatus(chatStatus, `${file.name} 파일을 확인하는 중입니다…`, "busy");
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await api(`/api/conversations/${state.conversationId}/attachments`, { method: "POST", body: form });
        const result = await response.json();
        state.attachmentIds.push(result.attachment);
        renderAttachments();
        setStatus(chatStatus, `${file.name} 파일을 추가했습니다.`, "success");
      } catch (error) {
        setStatus(chatStatus, error.message, "error");
      }
    }
  });

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const input = byId("inquiry-message");
    const content = input.value.trim();
    if (!content) return;
    state.busy = true;
    sendButton.disabled = true;
    input.disabled = true;
    const userMessage = messageNode("user", content);
    const assistant = messageNode("assistant", "", true);
    input.value = "";
    choices.replaceChildren();
    completion.hidden = true;
    setStatus(chatStatus, "답변을 정리하고 있습니다…", "busy");
    const clientMessageId = state.retryContent === content && state.retryMessageId ? state.retryMessageId : crypto.randomUUID();
    try {
      const response = await api(`/api/conversations/${state.conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, clientMessageId, attachmentIds: state.attachmentIds.map((item) => item.id) }),
      });
      await consumeSse(response, assistant);
      assistant.article.classList.remove("pending");
      state.attachmentIds = [];
      state.retryMessageId = null;
      state.retryContent = null;
      renderAttachments();
      setStatus(chatStatus, "");
    } catch (error) {
      assistant.article.remove();
      userMessage.article.remove();
      input.value = content;
      state.retryMessageId = clientMessageId;
      state.retryContent = content;
      setStatus(chatStatus, error.message, "error");
    } finally {
      state.busy = false;
      sendButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  byId("inquiry-complete-check").addEventListener("change", (event) => { byId("inquiry-complete").disabled = !event.target.checked; });
  byId("inquiry-complete").addEventListener("click", async () => {
    const button = byId("inquiry-complete");
    button.disabled = true;
    setStatus(chatStatus, "문의 내용을 안전하게 저장하고 있습니다…", "busy");
    try {
      const response = await api(`/api/conversations/${state.conversationId}/complete`, { method: "POST", body: JSON.stringify({ confirmed: true }) });
      const result = await response.json();
      completion.hidden = true;
      messageForm.hidden = true;
      setStatus(chatStatus, result.message ?? "문의가 완료되었습니다.", "success");
    } catch (error) {
      setStatus(chatStatus, error.message, "error");
      button.disabled = false;
    }
  });

  byId("inquiry-delete").addEventListener("click", async () => {
    if (!state.conversationId || !window.confirm("이 문의와 첨부 파일을 삭제할까요? 삭제하면 되돌릴 수 없습니다.")) return;
    try {
      await api(`/api/conversations/${state.conversationId}`, { method: "DELETE" });
      const created = await api("/api/conversations", { method: "POST", body: "{}" });
      state.conversationId = (await created.json()).conversation.id;
      messageForm.hidden = false;
      emptyConversation();
      setStatus(chatStatus, "문의 내용을 삭제했습니다.", "success");
    } catch (error) {
      setStatus(chatStatus, error.message, "error");
    }
  });

  byId("inquiry-logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    state.conversationId = null;
    showAuth();
    emailForm.hidden = false;
    codeForm.hidden = true;
    setStatus(authStatus, "로그아웃했습니다.", "success");
  });

  byId("inquiry-open").addEventListener("click", () => {
    dialogReturnFocus = byId("inquiry-open");
    dialog.showModal();
    state.formStartedAt = Date.now();
    restoreSession();
  });
  byId("inquiry-close").addEventListener("click", closeInquiry);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeInquiry();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeInquiry();
  });
  if (new URLSearchParams(window.location.search).get("inquiry") === "open") {
    dialogReturnFocus = document.querySelector('a[href*="?inquiry=open"]');
    dialog.showModal();
    state.formStartedAt = Date.now();
    restoreSession();
  }
})();
