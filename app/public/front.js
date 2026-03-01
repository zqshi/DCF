const STORAGE_KEY = "front-stage-v3";
const FRONT_LOGIN_PATH = "/front-login.html";
const state = {
  employees: [],
  messages: [],
  tasks: [],
  events: [],
  skills: [],
  subscriptions: [],
  knowledgeAssets: [],
  knowledgeConfig: { enabled: true, entryUrl: "http://127.0.0.1:19080", useSsoBridge: false },
  configuredModels: [],
  threads: {},
  activeEmployeeId: "",
  activeThreadId: "",
  expandedTaskGroups: {},
  expandedTaskCards: {},
  traceGroupOpen: {},
  traceTaskId: "",
  processPanelOpen: false,
  latestEventSeq: 0,
  streamConnected: false,
  runtimeFilterTaskId: "all",
  runtimeFilterType: "all",
  chatRenderKey: "",
  authUser: null,
  mode: "execution",
  accountActionsOpen: false,
  threadMenuOpenId: "",
  settingsModalOpen: false,
  composerAttachments: [],
  subscriptionEditor: {
    mode: "create",
    subscriptionId: "",
  },
  frontApiMissing: false,
  frontApiHintShown: false,
};
const refreshRequestGuard = typeof createRequestGuard === "function"
  ? createRequestGuard()
  : {
      issue() {
        this._latest = (this._latest || 0) + 1;
        return this._latest;
      },
      isCurrent(token) {
        return Number(token) === Number(this._latest || 0);
      }
    };

function isGovernanceMode() {
  return state.mode === "governance";
}

async function api(path, options) {
  const candidates = typeof buildFrontApiCandidates === "function"
    ? buildFrontApiCandidates(path, window.location.pathname, window.location)
    : [path];
  const requestOptions = { credentials: "include", headers: { "Content-Type": "application/json" }, ...options };
  const attemptedPaths = [];
  const networkFailures = [];
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const requestPath = candidates[index];
    attemptedPaths.push(requestPath);
    let response;
    try {
      response = await fetch(requestPath, requestOptions);
    } catch (error) {
      const failed = new Error(`网络请求失败: ${requestPath}`);
      failed.path = requestPath;
      failed.status = 0;
      failed.code = "NETWORK_ERROR";
      failed.cause = error;
      lastError = failed;
      networkFailures.push(requestPath);
      const hasFallback = index < candidates.length - 1;
      if (hasFallback) continue;
      break;
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const unauthorized = new Error(body.error || "未登录或会话已过期");
      unauthorized.code = "UNAUTHENTICATED";
      unauthorized.path = requestPath;
      unauthorized.status = 401;
      throw unauthorized;
    }
    if (response.ok) return body;

    const message = response.status === 404
      ? `接口不存在: ${requestPath}`
      : (body.error || "request failed");
    const failed = new Error(message);
    failed.path = requestPath;
    failed.status = response.status;
    lastError = failed;
    const hasFallback = index < candidates.length - 1;
    if (response.status === 404 && hasFallback) continue;
    throw failed;
  }
  if (lastError && Number(lastError.status || 0) === 404 && attemptedPaths.length > 1) {
    lastError.message = `接口不存在: ${lastError.path}（已尝试: ${attemptedPaths.join(" , ")}）`;
  }
  if (lastError && String(lastError.code || "") === "NETWORK_ERROR") {
    lastError.message = `网络请求失败（已尝试: ${attemptedPaths.join(" , ")}）`;
    if (networkFailures.length > 0) {
      lastError.networkFailures = networkFailures.slice();
    }
  }
  throw lastError || new Error("request failed");
}

function redirectToFrontLogin() {
  const next = encodeURIComponent("/front.html");
  window.location.href = `${FRONT_LOGIN_PATH}?next=${next}`;
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.activeEmployeeId = parsed.activeEmployeeId || "";
    state.activeThreadId = parsed.activeThreadId || "";
    // Front stage is fixed to execution-first for business users.
    state.mode = "execution";
  } catch {
    state.mode = "execution";
  }
}

function saveLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activeEmployeeId: state.activeEmployeeId,
      activeThreadId: state.activeThreadId,
    })
  );
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function composeAttachmentId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const SUPPORTED_ATTACHMENT_MIME_BY_EXT = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
const SUPPORTED_ATTACHMENT_MIME_SET = new Set(Object.values(SUPPORTED_ATTACHMENT_MIME_BY_EXT));

function attachmentExtFromName(name) {
  const raw = String(name || "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return "";
  return raw.slice(idx + 1);
}

function normalizeAttachmentMimeType(mimeType, fileName) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (SUPPORTED_ATTACHMENT_MIME_SET.has(normalized)) return normalized;
  if (normalized === "image/jpg") return "image/jpeg";
  const ext = attachmentExtFromName(fileName);
  return SUPPORTED_ATTACHMENT_MIME_BY_EXT[ext] || "";
}

function inferAttachmentType(mimeType) {
  return String(mimeType || "").startsWith("image/") ? "image" : "file";
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取附件失败"));
    reader.readAsDataURL(blob);
  });
}

async function appendComposerAttachments(files) {
  const next = [];
  for (const file of files) {
    const mimeType = normalizeAttachmentMimeType(file.type, file.name);
    if (!mimeType) continue;
    const dataUrl = await readBlobAsDataUrl(file);
    if (!dataUrl) continue;
    next.push({
      id: composeAttachmentId(),
      name: String(file.name || "附件"),
      type: inferAttachmentType(mimeType),
      mimeType,
      dataUrl
    });
  }
  if (!next.length) return;
  state.composerAttachments = [...state.composerAttachments, ...next];
  renderComposerAttachments();
}

function removeComposerAttachment(id) {
  state.composerAttachments = state.composerAttachments.filter((item) => item.id !== id);
  renderComposerAttachments();
}

function clearComposerAttachments() {
  if (!state.composerAttachments.length) return;
  state.composerAttachments = [];
  renderComposerAttachments();
}

function buildAttachmentPromptSuffix() {
  if (!Array.isArray(state.composerAttachments) || !state.composerAttachments.length) return "";
  const lines = state.composerAttachments.map((item, index) => {
    const name = String(item.name || `附件${index + 1}`);
    const mime = String(item.mimeType || "image");
    return `- 附件${index + 1}: ${name} (${mime})`;
  });
  return `\n\n[用户已上传附件]\n${lines.join("\n")}`;
}

function buildDispatchAttachments() {
  if (!Array.isArray(state.composerAttachments) || !state.composerAttachments.length) return [];
  return state.composerAttachments
    .map((item) => {
      const dataUrl = String(item && item.dataUrl ? item.dataUrl : "");
      const matched = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matched) return null;
      const mimeType = normalizeAttachmentMimeType(item && item.mimeType, item && item.name);
      if (!mimeType) return null;
      return {
        type: inferAttachmentType(mimeType),
        name: String(item && item.name ? item.name : "attachment").slice(0, 120),
        mimeType: mimeType.slice(0, 120),
        content: String(matched[2] || "")
      };
    })
    .filter((item) => item && item.content);
}

function renderComposerAttachments() {
  const node = document.getElementById("composerAttachments");
  if (!node) return;
  if (!state.composerAttachments.length) {
    node.classList.add("hidden");
    node.innerHTML = "";
    return;
  }
  node.classList.remove("hidden");
  node.innerHTML = state.composerAttachments
    .map((item) => {
      if (item.type === "image") {
        return `
        <div class="composer-attachment" title="${escapeAttr(item.name)}">
          <img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(item.name)}" />
          <button type="button" class="composer-attachment-remove" data-attachment-remove="${escapeAttr(item.id)}">×</button>
        </div>
      `;
      }
      const ext = attachmentExtFromName(item.name).toUpperCase() || "FILE";
      return `
        <div class="composer-attachment file" title="${escapeAttr(item.name)}">
          <div class="composer-attachment-file">
            <strong>${escapeHtml(ext)}</strong>
            <span>${escapeHtml(item.name || "附件")}</span>
          </div>
          <button type="button" class="composer-attachment-remove" data-attachment-remove="${escapeAttr(item.id)}">×</button>
        </div>
      `;
    })
    .join("");
  for (const button of node.querySelectorAll("[data-attachment-remove]")) {
    button.onclick = () => removeComposerAttachment(button.getAttribute("data-attachment-remove"));
  }
}

const EVENT_TYPE_ZH = {
  "task.created": "任务已创建",
  "task.validating": "任务校验中",
  "task.approval.required": "等待审批",
  "task.approved": "审批通过",
  "task.running": "任务执行中",
  "task.corrected": "任务已纠偏",
  "task.succeeded": "任务成功",
  "task.failed": "任务失败",
  "task.aborted": "任务中止",
  "task.rollback.triggered": "触发回滚",
  "task.rolled_back": "已回滚",
  "runtime.raw.event": "系统执行事件",
  "runtime.task.synced": "系统执行同步",
  "skill.auto.created": "技能已沉淀",
  "skill.auto.linked": "技能已关联",
  "child.agent.created": "协作分身已创建",
  "oss.research.queued": "开源检索已入队",
  "oss.case.user_confirmation.required": "待你确认开源方案",
  "oss.case.user.confirmed": "你已确认开源方案",
  "oss.case.user.rejected": "你已拒绝开源方案",
  "integration.compensation.queued": "补偿已入队",
  "integration.compensation.running": "补偿执行中",
  "integration.compensation.succeeded": "补偿成功",
  "integration.compensation.retry_scheduled": "补偿待重试",
  "integration.compensation.dead_lettered": "补偿进入死信",
  "integration.compensation.deferred": "补偿延后执行",
  "integration.compensation.retry_requested": "补偿手工重试"
};

function localizeEventType(type) {
  return EVENT_TYPE_ZH[type] || type;
}

function localizeOutputText(text) {
  return String(text || "").trim();
}

function frontApprovalRoles(user) {
  if (!user || !user.role) return [];
  if (user.role === "super_admin") return ["ops_admin", "auditor"];
  if (user.role === "ops_owner" || user.role === "ops_admin") return ["ops_admin"];
  if (user.role === "auditor") return ["auditor"];
  return [];
}

async function createThread(employeeId, title = "新会话") {
  const item = await api("/api/front/conversations", {
    method: "POST",
    body: JSON.stringify({ employeeId, title }),
  });
  if (!state.threads[employeeId]) state.threads[employeeId] = [];
  state.threads[employeeId] = sortThreads([item, ...state.threads[employeeId].filter((x) => x.id !== item.id)]);
  state.activeThreadId = item.id;
  saveLocalState();
  return item;
}

function sortThreads(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice()
    .sort((a, b) => {
      const aPinned = a && a.isPinned === true;
      const bPinned = b && b.isPinned === true;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      if (aPinned && bPinned) {
        const pinnedDelta = new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0);
        if (pinnedDelta !== 0) return pinnedDelta;
      }
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
}

async function setThreadPinned(threadId, pinned) {
  if (!state.activeEmployeeId || !threadId) return;
  const updated = await api(`/api/front/conversations/${encodeURIComponent(threadId)}/${pinned ? "pin" : "unpin"}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const current = state.threads[state.activeEmployeeId] || [];
  state.threads[state.activeEmployeeId] = sortThreads(current.map((item) => (item.id === threadId ? updated : item)));
}

async function deleteThread(threadId) {
  if (!state.activeEmployeeId || !threadId) return;
  const encodedId = encodeURIComponent(threadId);
  try {
    await api(`/api/front/conversations/${encodedId}/delete`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    await api(`/api/front/conversations/${encodedId}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  }
  const current = state.threads[state.activeEmployeeId] || [];
  state.threads[state.activeEmployeeId] = current.filter((item) => item.id !== threadId);
  if (state.activeThreadId === threadId) {
    ensureThreadForEmployee();
    await refreshMessagesByActiveThread();
  }
}

function ensureActiveEmployee() {
  if (!state.employees.length) {
    state.activeEmployeeId = "";
    return;
  }
  if (!state.activeEmployeeId || !state.employees.some((e) => e.id === state.activeEmployeeId)) {
    state.activeEmployeeId = state.employees[0].id;
  }
}

function ensureThreadForEmployee() {
  if (!state.activeEmployeeId) return;
  if (!state.threads[state.activeEmployeeId] || state.threads[state.activeEmployeeId].length === 0) {
    state.activeThreadId = "";
  } else if (!state.threads[state.activeEmployeeId].some((t) => t.id === state.activeThreadId)) {
    state.activeThreadId = state.threads[state.activeEmployeeId][0].id;
  }
}

function getThreadTasks() {
  return state.tasks
    .filter((x) => x.employeeId === state.activeEmployeeId && x.conversationId === state.activeThreadId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getThreadMessages() {
  return state.messages
    .filter((x) => x.employeeId === state.activeEmployeeId && x.conversationId === state.activeThreadId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getThreadEvents(taskIds) {
  return state.events.filter((event) => {
    const payload = event.payload || {};
    return taskIds.has(payload.taskId || payload.task_id);
  });
}

function skillName(skillId) {
  const skill = state.skills.find((x) => x.id === skillId);
  if (!skill) return skillId;
  return skill.domain ? `${skill.name} (${skill.domain})` : skill.name;
}

function renderEmployees() {
  const select = document.getElementById("employeeSelect");
  const createBtn = document.getElementById("openCreateEmployee");
  select.innerHTML = state.employees
    .map((employee) => `<option value="${employee.id}">${employee.employeeCode} · ${employee.name}</option>`)
    .join("");
  select.value = state.activeEmployeeId || "";
  select.disabled = state.employees.length === 0;
  if (createBtn) {
    const locked = state.employees.length > 0;
    createBtn.classList.toggle("is-disabled", locked);
    createBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    createBtn.title = locked ? "已创建过员工，不能重复创建" : "";
  }
}

function avatarFromUser(user) {
  const displayName = String((user && user.displayName) || "").trim();
  const username = String((user && user.username) || "").trim();
  const source = displayName || username || "U";
  const chars = Array.from(source).filter((char) => /\S/.test(char));
  if (chars.length === 0) return "U";
  if (chars.length === 1) return chars[0].toUpperCase();
  return `${chars[0]}${chars[1]}`.toUpperCase();
}

function hasAdminConsoleAccess(user) {
  if (!user || !Array.isArray(user.permissions)) return false;
  if (user.permissions.includes("*")) return true;
  return user.permissions.some((item) => String(item || "").trim().startsWith("admin."));
}

function syncAccountActionsVisibility() {
  const logoutBtn = document.getElementById("frontLogoutBtn");
  const settingsBtn = document.getElementById("frontSettingsBtn");
  const toggleBtn = document.getElementById("frontUserToggle");
  if (!logoutBtn || !settingsBtn || !toggleBtn) return;
  logoutBtn.classList.toggle("hidden", !state.accountActionsOpen);
  settingsBtn.classList.toggle("hidden", !state.accountActionsOpen);
  toggleBtn.setAttribute("aria-expanded", state.accountActionsOpen ? "true" : "false");
}

function closeAccountActions() {
  state.accountActionsOpen = false;
  syncAccountActionsVisibility();
}

function renderAuthUserCard() {
  const avatar = document.getElementById("frontUserAvatar");
  const account = document.getElementById("frontUserAccount");
  const name = document.getElementById("frontUserName");
  const adminEntry = document.getElementById("frontAdminEntry");
  const toggleBtn = document.getElementById("frontUserToggle");
  const user = state.authUser && typeof state.authUser === "object" ? state.authUser : null;
  if (!avatar || !account || !name) return;

  if (!user) {
    avatar.textContent = "?";
    account.textContent = "未登录";
    name.textContent = "请先登录";
    state.accountActionsOpen = false;
    if (toggleBtn) toggleBtn.disabled = true;
    if (adminEntry) adminEntry.classList.add("hidden");
    syncAccountActionsVisibility();
    return;
  }

  if (toggleBtn) toggleBtn.disabled = false;
  avatar.textContent = avatarFromUser(user);
  account.textContent = user.username || user.id || "unknown";
  name.textContent = [user.displayName, user.role].filter(Boolean).join(" · ");
  if (adminEntry) {
    adminEntry.classList.toggle("hidden", !hasAdminConsoleAccess(user));
  }
  syncAccountActionsVisibility();
}

function renderThreads() {
  const wrap = document.getElementById("threadList");
  const list = state.threads[state.activeEmployeeId] || [];
  wrap.innerHTML =
    list
      .map(
        (t) => {
          const menuOpen = state.threadMenuOpenId === t.id;
          return `
      <div class="thread-item ${t.id === state.activeThreadId ? "active" : ""}" data-thread-id="${t.id}">
        <button type="button" class="thread-main" data-thread-open-id="${t.id}">
          <span>${t.isPinned ? "📌 " : ""}${escapeHtml(t.title || "新会话")}</span>
        </button>
        <div class="thread-actions">
          <button
            type="button"
            class="ghost thread-more-btn"
            data-thread-menu-toggle-id="${t.id}"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded="${menuOpen ? "true" : "false"}"
          >⋯</button>
          <div class="thread-action-menu ${menuOpen ? "open" : ""}" data-thread-menu-id="${t.id}" role="menu">
            <button type="button" class="ghost thread-action" data-thread-pin-id="${t.id}" data-thread-pinned="${t.isPinned === true ? "1" : "0"}" role="menuitem">${t.isPinned ? "取消置顶" : "置顶"}</button>
            <button type="button" class="ghost thread-action danger" data-thread-delete-id="${t.id}" role="menuitem">删除</button>
          </div>
        </div>
      </div>`;
        }
      )
      .join("") || `<div class="empty-thread">暂无会话，点击“新会话”开始</div>`;

  for (const btn of wrap.querySelectorAll("[data-thread-open-id]")) {
    btn.onclick = () => {
      state.activeThreadId = btn.dataset.threadOpenId;
      refreshMessagesByActiveThread()
        .then(() => {
          saveLocalState();
          state.threadMenuOpenId = "";
          renderAllThreadViews();
        })
        .catch((error) => showMsg(error.message, true));
    };
  }
  for (const btn of wrap.querySelectorAll("[data-thread-menu-toggle-id]")) {
    btn.onclick = () => {
      const id = btn.dataset.threadMenuToggleId || "";
      if (!id) return;
      state.threadMenuOpenId = state.threadMenuOpenId === id ? "" : id;
      renderThreads();
    };
  }
  for (const btn of wrap.querySelectorAll("[data-thread-pin-id]")) {
    btn.onclick = () => {
      const id = btn.dataset.threadPinId || "";
      if (!id) return;
      const pinned = btn.dataset.threadPinned === "1";
      setThreadPinned(id, !pinned)
        .then(() => {
          state.threadMenuOpenId = "";
          showMsg(!pinned ? "会话已置顶" : "会话已取消置顶");
          renderAllThreadViews();
        })
        .catch((error) => showMsg(error.message, true));
    };
  }
  for (const btn of wrap.querySelectorAll("[data-thread-delete-id]")) {
    btn.onclick = () => {
      const id = btn.dataset.threadDeleteId || "";
      if (!id) return;
      const ok = window.confirm("确认删除该会话？删除后不可恢复。");
      if (!ok) return;
      deleteThread(id)
        .then(() => {
          state.threadMenuOpenId = "";
          showMsg("会话已删除");
          saveLocalState();
          renderAllThreadViews();
        })
        .catch((error) => showMsg(error.message, true));
    };
  }
}

function statusText(task) {
  if (task.status === "pending") return "任务待校验";
  if (task.status === "validating") return "任务校验中（可能等待审批）";
  if (task.status === "approved") return "任务已审批，等待执行";
  if (task.status === "running") return "任务执行中";
  if (task.status === "rolled_back") return `任务已回滚：${task.rollback?.reason || "策略触发回滚"}`;
  if (task.status === "aborted") return "任务已中止";
  if (task.status === "succeeded") return "任务已完成";
  if (task.status === "failed") return `${task.lastError?.severity || "P2"}: ${localizeOutputText(task.lastError?.message || "任务失败")}`;
  return `任务${task.status}，迭代 ${task.iteration}`;
}

function isActiveStatus(status) {
  return ["pending", "validating", "approved", "running"].includes(status);
}

function taskEvents(taskId) {
  return state.events
    .filter((e) => {
      const payload = e.payload || {};
      return (payload.taskId || payload.task_id) === taskId;
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function taskRuntimeTranscript(taskId, maxLines = 8) {
  const lines = taskEvents(taskId)
    .filter((event) => event.type === "runtime.raw.event")
    .map((event) => event.payload || {})
    .filter((payload) => payload.runtimeMessage)
    .map((payload) => {
      const message = localizeOutputText(payload.runtimeMessage);
      if (payload.runtimeToolName) return `[${payload.runtimeToolName}] ${message}`;
      return message;
    })
    .slice(-Math.max(1, maxLines));
  return lines;
}

function taskRuntimeDeltaText(taskId) {
  const parts = taskEvents(taskId)
    .filter((event) => event.type === "runtime.raw.event")
    .map((event) => event.payload || {})
    .filter((payload) => payload.runtimeAction === "delta" && payload.runtimeMessage)
    .sort((a, b) => (Number(a.runtimeChunkIndex || 0) - Number(b.runtimeChunkIndex || 0)))
    .map((payload) => payload.runtimeMessage);
  return parts.join("");
}

function taskRuntimeRevision(taskId) {
  const runtimeEvents = taskEvents(taskId).filter((event) => event.type === "runtime.raw.event");
  const last = runtimeEvents[runtimeEvents.length - 1];
  return `${runtimeEvents.length}:${last ? last.id : ""}`;
}

function renderLiveOutput(task) {
  const deltaText = taskRuntimeDeltaText(task.id);
  const lines = taskRuntimeTranscript(task.id, 6);
  const active = isActiveStatus(task.status);
  if (!lines.length && !deltaText && !active) return "";
  const body = deltaText || (lines.length ? lines.join("\n") : "等待运行中输出...");
  return `
    <div class="live-stream">
      <div class="live-stream-head">实时输出 ${active ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : ""}</div>
      <pre class="mono">${escapeHtml(body)}</pre>
    </div>
  `;
}

function renderAgentOutput(task) {
  const deltaText = taskRuntimeDeltaText(task.id);
  const active = isActiveStatus(task.status);
  let content = "";
  if (deltaText) {
    content = localizeOutputText(deltaText);
  } else if (task.status === "succeeded" && task.result) {
    content = localizeOutputText(task.result);
  } else if (task.status === "failed" && task.lastError?.message) {
    content = `执行失败：${localizeOutputText(task.lastError.message)}`;
  } else if (active) {
    content = "正在分析并执行，请稍候...";
  } else {
    return "";
  }
  const settled = !active && ["succeeded", "failed", "rolled_back", "aborted"].includes(task.status);
  return `
    <div class="agent-output ${settled ? "settled" : ""}">
      <div class="agent-output-head">员工输出 ${active ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : ""}</div>
      <div class="agent-output-body">${escapeHtml(content)}${active ? '<span class="live-caret"></span>' : ""}</div>
    </div>
  `;
}

function userBubbleToneClass(task) {
  if (task.riskLevel === "L1") return "tone-user-l1";
  if (task.riskLevel === "L2") return "tone-user-l2";
  if (task.riskLevel === "L3") return "tone-user-l3";
  return "tone-user-l4";
}

function agentBubbleToneClass(task) {
  if (task.status === "succeeded") return "tone-agent-succeeded";
  if (task.status === "failed") return "tone-agent-failed";
  if (task.status === "rolled_back" || task.status === "aborted") return "tone-agent-rollback";
  if (task.status === "validating") return "tone-agent-validating";
  return "tone-agent-running";
}

function agentBubbleToneClassByStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "succeeded") return "tone-agent-succeeded";
  if (value === "failed") return "tone-agent-failed";
  if (value === "rolled_back" || value === "aborted") return "tone-agent-rollback";
  if (value === "validating") return "tone-agent-validating";
  if (value) return "tone-agent-running";
  return "tone-agent-succeeded";
}

function renderGovernanceOutput(task) {
  const events = taskEvents(task.id);
  const waiting = events.find((event) => event.type === "task.approval.required");
  const approved = events.find((event) => event.type === "task.approved");
  const rollback = events.find((event) => event.type === "task.rolled_back");
  const rollbackTriggered = events.find((event) => event.type === "task.rollback.triggered");
  const aborted = events.find((event) => event.type === "task.aborted");
  const ossConfirmRequired = events
    .filter((event) => event.type === "oss.case.user_confirmation.required")
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  const ossConfirmed = events.find((event) => event.type === "oss.case.user.confirmed");
  const ossRejected = events.find((event) => event.type === "oss.case.user.rejected");
  const lines = [];

  if (task.requiresApproval) {
    const approvedCount = (task.approval?.approvals || []).length;
    const requiredCount = task.approval?.requiredApprovals || 0;
    const approvalsText = (task.approval?.approvals || [])
      .map((item) => `${item.approverRole || "role?"}@${item.approverId || "unknown"}`)
      .join("，");
    const roles = new Set((task.approval?.approvals || []).map((x) => x.approverRole).filter(Boolean));
    const canApprove = task.status === "validating";
    const myRoles = frontApprovalRoles(state.authUser);
    if (task.status === "validating" || waiting) {
      lines.push(`审批中：${approvedCount}/${requiredCount}，等待治理角色确认。`);
      if (approvalsText) lines.push(`已审批责任人：${approvalsText}`);
      lines.push(
        canApprove
          ? `ACTION:approve:${task.id}:${roles.has("ops_admin") ? "done" : "ops_admin"}:${roles.has("auditor") ? "done" : "auditor"}:${myRoles.join(",")}`
          : ""
      );
    }
    if (approved && (task.status === "approved" || task.status === "running" || task.status === "succeeded")) {
      lines.push(`审批通过：${approvedCount}/${requiredCount}。`);
      if (approvalsText) lines.push(`审批责任链：${approvalsText}`);
    }
  }
  if (rollback || task.status === "rolled_back") {
    const reason = task.rollback?.reason || rollbackTriggered?.payload?.reason || "策略触发回滚";
    lines.push(`已回滚：${reason}`);
    if (task.rollback?.by?.userId || task.rollback?.by?.role) {
      lines.push(`回滚责任人：${task.rollback.by.role || "role?"}@${task.rollback.by.userId || "unknown"}`);
    }
  }
  if (aborted || task.status === "aborted") {
    lines.push("已中止：任务被人工接管或紧急停机。");
  }
  if (ossConfirmRequired && !ossConfirmed && !ossRejected) {
    const payload = ossConfirmRequired.payload || {};
    const recommendation = payload.recommendation === "introduce_oss"
      ? "引入开源方案"
      : (payload.recommendation === "build_in_house" ? "内部自建" : "暂缓");
    const reason = localizeOutputText(payload.rationale || payload.gapSummary || "员工已完成检索评估");
    lines.push(`员工建议：${recommendation}。`);
    lines.push(`请确认是否继续：${reason}`);
    lines.push(`ACTION:oss_confirm:${payload.caseId || ""}:${payload.recommendation || ""}`);
  }
  if (ossConfirmed) {
    lines.push("你已确认，系统将按建议推进。");
  }
  if (ossRejected) {
    lines.push("你已拒绝，系统将保持暂缓并等待你的下一步操作。");
  }

  if (!lines.length) return "";
  const controls = lines.find((line) => line.startsWith("ACTION:approve:"));
  const ossControls = lines.find((line) => line.startsWith("ACTION:oss_confirm:"));
  const cleanLines = lines.filter((line) => !line.startsWith("ACTION:"));
  let controlsHtml = "";
  if (controls) {
    const parts = controls.split(":");
    const taskId = parts[2];
    const opsState = parts[3];
    const auditorState = parts[4];
    const myRoles = (parts[5] || "").split(",").filter(Boolean);
    const canOps = myRoles.includes("ops_admin");
    const canAuditor = myRoles.includes("auditor");
    const canReject = canOps;
    const noAuthHint = !myRoles.length
      ? `<div class="gov-auth-hint">审批操作需要先登录后台账号（ops_owner / auditor / super_admin）。</div>`
      : "";
    controlsHtml = `
      <div class="gov-actions">
        <button type="button" class="approval-action" data-task-id="${taskId}" data-role="ops_admin" ${(opsState === "done" || !canOps) ? "disabled" : ""}>
          ${opsState === "done" ? "ops_admin 已审批" : "以 ops_admin 审批"}
        </button>
        <button type="button" class="approval-action" data-task-id="${taskId}" data-role="auditor" ${(auditorState === "done" || !canAuditor) ? "disabled" : ""}>
          ${auditorState === "done" ? "auditor 已审批" : "以 auditor 审批"}
        </button>
        <button type="button" class="approval-reject" data-task-id="${taskId}" ${canReject ? "" : "disabled"}>驳回并回滚</button>
      </div>
      ${noAuthHint}
    `;
  }
  if (ossControls) {
    const parts = ossControls.split(":");
    const caseId = parts[2];
    const recommendation = parts[3] || "";
    const label = recommendation === "build_in_house" ? "确认按内部自建推进" : "确认按开源引入推进";
    controlsHtml += `
      <div class="gov-actions" style="margin-top:8px;">
        <button type="button" class="oss-confirm-action" data-case-id="${caseId}" data-confirm="yes">${label}</button>
        <button type="button" class="oss-confirm-action ghost" data-case-id="${caseId}" data-confirm="no">拒绝该建议</button>
      </div>
    `;
  }
  return `
    <div class="gov-output">
      <div class="gov-output-head">治理反馈</div>
      <div class="gov-output-body">${escapeHtml(cleanLines.join("\n"))}</div>
      ${controlsHtml}
    </div>
  `;
}

function renderInlineProgress(task) {
  const types = new Set(taskEvents(task.id).map((x) => x.type));
  const stages = [
    { key: "task.created", label: "创建" },
    { key: "task.validating", label: "校验" },
    { key: "task.approval.required", label: "审批中" },
    { key: "task.approved", label: "已审批" },
    { key: "task.running", label: "执行" },
    { key: "task.corrected", label: "纠偏" },
    { key: "task.succeeded", label: "完成" },
    { key: "task.failed", label: "失败" },
    { key: "task.rolled_back", label: "回滚" },
  ];
  return `
    <div class="inline-progress">
      ${stages
        .map((stage) => `<span class="stage-dot ${types.has(stage.key) ? "done" : "pending"}">${stage.label}</span>`)
        .join("")}
      ${isActiveStatus(task.status) ? `<span class="typing-dots"><i></i><i></i><i></i></span>` : ""}
    </div>
  `;
}

function renderChat(messages) {
  const box = document.getElementById("chat");
  const thread = (state.threads[state.activeEmployeeId] || []).find((t) => t.id === state.activeThreadId);
  document.getElementById("conversationTitle").textContent = thread ? thread.title : "新会话";

  if (!messages.length) {
    state.chatRenderKey = "empty";
    box.innerHTML = `<div class="empty-chat">开始对话并下发你的第一个任务</div>`;
    return;
  }

  const chatRenderKey = JSON.stringify({
    employeeId: state.activeEmployeeId,
    threadId: state.activeThreadId,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content || "",
      status: (message.meta || {}).status || "",
      taskId: message.taskId || "",
      at: message.createdAt || ""
    }))
  });
  if (state.chatRenderKey === chatRenderKey) return;
  state.chatRenderKey = chatRenderKey;

  const shouldStickBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 48;

  const chunks = messages.map((message) => {
    const role = String(message.role || "").toLowerCase();
    const isUser = role === "user";
    const time = new Date(message.createdAt || Date.now()).toLocaleString();
    const status = (message.meta && message.meta.status) ? String(message.meta.status) : "";
    const taskIdText = message.taskId ? ` · 事项 ${String(message.taskId).slice(0, 8)}` : "";
    if (isUser) {
      return `
        <div class="msg user">
          <div class="msg-body tone-user-l2">
            <div class="msg-role">你</div>
            <div class="msg-meta">${time}${escapeHtml(taskIdText)}</div>
            <div class="msg-content">${escapeHtml(message.content || "")}</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="msg agent">
        <div class="msg-body ${agentBubbleToneClassByStatus(status)}">
          <div class="msg-role">员工</div>
          <div class="msg-meta">${time}${escapeHtml(taskIdText)}</div>
          <div class="msg-content">${escapeHtml(message.content || "")}</div>
        </div>
      </div>
    `;
  });
  box.innerHTML = chunks.join("");
  if (shouldStickBottom) box.scrollTop = box.scrollHeight;
}

function renderTaskDetail(task) {
  const relatedEvents = taskEvents(task.id);
  const childAgents = new Set();
  const skillIds = new Set();
  for (const event of relatedEvents) {
    if (event.type === "task.created" && event.payload?.childAgentId) childAgents.add(event.payload.childAgentId);
    if (event.type === "child.agent.created" && event.payload?.childAgentId) childAgents.add(event.payload.childAgentId);
    if (event.type === "skill.auto.linked" && event.payload?.skillId) skillIds.add(event.payload.skillId);
    if (event.type === "skill.auto.created" && event.payload?.skillId) skillIds.add(event.payload.skillId);
  }
  const childrenText = [...childAgents].slice(0, 8).join("、") || "暂无";
  const createdEvent = relatedEvents.find((event) => event.type === "task.created");
  const createdPayload = createdEvent ? (createdEvent.payload || {}) : {};
  const childPlan = task.childAgentPlan || {};
  const childAgentPlanned = Boolean(
    typeof childPlan.planned === "boolean"
      ? childPlan.planned
      : createdPayload.childAgentPlanned
  );
  const childReasonRaw = Array.isArray(childPlan.reasons) && childPlan.reasons.length
    ? childPlan.reasons
    : (Array.isArray(createdPayload.childAgentReasons) ? createdPayload.childAgentReasons : []);
  const childReasonMap = {
    high_risk_l4: "高风险任务(L4)",
    long_goal: "目标较长",
    complexity_keyword: "命中复杂任务关键词",
    broad_tool_scope: "工具范围较广"
  };
  const childReasonText = childReasonRaw.length
    ? childReasonRaw.map((x) => childReasonMap[x] || x).join("、")
    : "未触发";
  const skillsText = [...skillIds].slice(0, 8).map(skillName).join("、") || "暂无";
  const llm = task.llmConfig || {};
  const thinkingMap = { minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "最高" };
  const policyMap = { balanced: "平衡", conservative: "稳健", aggressive: "积极" };
  const llmText = `${llm.model || "default"} / 思考深度:${thinkingMap[llm.thinkingLevel] || llm.thinkingLevel || "中"} / 执行方式:${policyMap[llm.toolPolicy] || llm.toolPolicy || "平衡"}`;
  const runtimeEvents = (task.runtime && Array.isArray(task.runtime.events)) ? task.runtime.events : [];
  const runtimeMessages = relatedEvents
    .filter((event) => event.type === "runtime.raw.event" && (event.payload || {}).runtimeMessage)
    .slice()
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((event) => localizeOutputText((event.payload || {}).runtimeMessage))
    .filter(Boolean)
    .slice(-8);
  const liveTranscript = runtimeMessages.length ? runtimeMessages.join("\n") : "暂无增量输出";
  const runtimeText = runtimeEvents.length
    ? runtimeEvents
        .map((ev) => `${localizeEventType(ev.type || "unknown")}${ev.id ? ` (${ev.id})` : ""}`)
        .slice(0, 20)
        .join("\n")
    : "暂无系统执行记录";
  return `
    <div class="detail-row"><span>协作分工</span><strong>${escapeHtml(childrenText)}</strong></div>
    <div class="detail-row"><span>经验沉淀</span><strong>${escapeHtml(skillsText)}</strong></div>
    <details style="margin-top:8px;" open>
      <summary>最近执行记录</summary>
      <pre class="mono">${escapeHtml(liveTranscript)}</pre>
    </details>
    <details style="margin-top:8px;">
      <summary>自动协作策略</summary>
      <div class="detail-row" style="margin-top:6px;"><span>协作策略状态</span><strong>${childAgentPlanned ? "已触发创建" : "未触发创建"}（${escapeHtml(childReasonText)}）</strong></div>
    </details>
    <details style="margin-top:8px;">
      <summary>技术信息（高级）</summary>
      <div class="detail-row" style="margin-top:6px;"><span>处理策略（模型）</span><strong>${escapeHtml(llmText)}</strong></div>
      <div class="detail-row"><span>系统执行来源</span><strong>${escapeHtml((task.runtime && task.runtime.source) || "openclaw")}</strong></div>
      <div class="detail-row"><span>系统执行记录 (${runtimeEvents.length})</span></div>
      <pre class="mono">${escapeHtml(runtimeText)}</pre>
    </details>
    <button type="button" class="trace-open" data-task-id="${task.id}">查看处理过程</button>
  `;
}

function renderSummary(tasks, events) {
  const card = document.getElementById("summaryCard");
  if (!tasks.length) {
    card.innerHTML = `
      <h4>会话复盘</h4>
      <p>当前会话暂无任务。</p>
    `;
    return;
  }
  const succeeded = tasks.filter((t) => t.status === "succeeded").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const corrected = events.filter((e) => e.type === "task.corrected").length;
  const skillCreated = events.filter((e) => e.type === "skill.auto.created").length;
  const researchQueued = events.filter((e) => e.type === "oss.research.queued").length;
  const streamStatus = state.streamConnected ? "实时流已连接" : "实时流重连中（增量回补）";
  card.innerHTML = `
    <h4>会话复盘</h4>
    <p>${escapeHtml(streamStatus)}</p>
    <div class="summary-grid">
      <div><span>任务数</span><strong>${tasks.length}</strong></div>
      <div><span>成功</span><strong>${succeeded}</strong></div>
      <div><span>失败</span><strong>${failed}</strong></div>
      <div><span>纠偏</span><strong>${corrected}</strong></div>
      <div><span>新技能</span><strong>${skillCreated}</strong></div>
      <div><span>OSS检索</span><strong>${researchQueued}</strong></div>
    </div>
  `;
}

function renderKnowledgeCard() {
  const listNode = document.getElementById("knowledgeList");
  if (!listNode) return;
  const employeeId = String(state.activeEmployeeId || "").trim();
  const rows = (state.knowledgeAssets || [])
    .filter((item) => !employeeId || String(item.employeeId || "") === employeeId)
    .slice(0, 20);
  if (!rows.length) {
    listNode.innerHTML = `<div class="empty-thread">当前员工暂无沉淀记录</div>`;
    return;
  }
  listNode.innerHTML = rows
    .map((item) => {
      const reviewStatus = String(item.reviewStatus || "pending");
      const score = Number.isFinite(Number(item.qualityScore)) ? Number(item.qualityScore) : null;
      const scoreText = score === null ? "质量分待评估" : `质量分 ${score}`;
      const subtitle = [
        item.assetType === "knowledge_base" ? "知识库" : "知识条目",
        reviewStatus,
        scoreText
      ].join(" · ");
      return `
        <div class="activity-item">
          <strong>${escapeHtml(String(item.title || item.externalId || "unnamed"))}</strong>
          <p>${escapeHtml(subtitle)}</p>
          <small>${new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString()}</small>
        </div>
      `;
    })
    .join("");
}

function renderKnowledgeHubEntry() {
  const btn = document.getElementById("openKnowledgeHub");
  if (!btn) return;
  const entryUrl = String((state.knowledgeConfig && state.knowledgeConfig.entryUrl) || "").trim();
  const enabled = entryUrl.length > 0;
  btn.classList.toggle("is-disabled", !enabled);
  if (enabled) {
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
  } else {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
  }
  btn.title = enabled ? "打开外部知识库" : "外部知识库地址未配置";
}

function renderActivity(events) {
  const wrap = document.getElementById("activityList");
  const grouped = {};
  for (const event of events.slice(0, 90)) {
    const payload = event.payload || {};
    const key = payload.taskId || payload.task_id || "unbound";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(event);
  }
  const groups = Object.entries(grouped).sort((a, b) => new Date(b[1][0].at) - new Date(a[1][0].at));
  if (!groups.length) {
    wrap.innerHTML = `<div class="empty-thread">暂无活动</div>`;
    return;
  }
  wrap.innerHTML = groups
      .map(([taskId, list]) => {
        const first = list[0];
        const expanded = Boolean(state.expandedTaskGroups[taskId]);
        const progress = buildTaskProgress(list);
        return `
      <article class="activity-group ${expanded ? "expanded" : ""}">
        <button type="button" class="activity-group-head" data-task-id="${taskId}">
          <div class="activity-group-title">
            <strong>${escapeHtml(taskId === "unbound" ? "系统记录" : `事项 ${taskId.slice(0, 8)}`)}</strong>
            <small>${list.length} 条 · ${new Date(first.at).toLocaleTimeString()}</small>
          </div>
          <div class="activity-progress">${progress}</div>
        </button>
        <div class="activity-group-body ${expanded ? "" : "hidden"}">
          ${list
            .map((event) => {
              const p = event.payload || {};
              const detail = p.runtimeType
                ? `${localizeEventType(p.runtimeType)}${p.runtimeEventId ? ` (${p.runtimeEventId})` : ""}${p.runtimeToolName ? ` · ${p.runtimeToolName}` : ""}${p.runtimeMessage ? ` · ${localizeOutputText(p.runtimeMessage)}` : ""}`
                : (
                    p.goal
                    || p.query
                    || p.severity
                    || (p.approverRole && p.approverId ? `approver:${p.approverRole}@${p.approverId}` : "")
                    || (p.rollbackByRole && p.rollbackByUserId ? `rollback:${p.rollbackByRole}@${p.rollbackByUserId}` : "")
                    || p.employeeCode
                    || "事件记录"
                  );
              return `
              <div class="activity-item">
                <strong>${escapeHtml(localizeEventType(event.type))}</strong>
                <p>${escapeHtml(localizeOutputText(detail))}</p>
                <small>${new Date(event.at).toLocaleString()}</small>
              </div>
            `;
            })
            .join("")}
        </div>
      </article>`;
    })
    .join("");

  for (const btn of wrap.querySelectorAll(".activity-group-head")) {
    btn.onclick = () => {
      const taskId = btn.dataset.taskId;
      state.expandedTaskGroups[taskId] = !state.expandedTaskGroups[taskId];
      renderActivity(events);
    };
  }
}

function buildTaskProgress(list) {
  const types = new Set(list.map((x) => x.type));
  const stages = [
    { key: "task.created", label: "创建" },
    { key: "task.validating", label: "校验" },
    { key: "task.approval.required", label: "审批中" },
    { key: "task.approved", label: "已审批" },
    { key: "task.running", label: "执行" },
    { key: "task.corrected", label: "纠偏" },
    { key: "task.succeeded", label: "完成" },
    { key: "task.failed", label: "失败" },
    { key: "task.rolled_back", label: "回滚" },
  ];
  return stages
    .map((stage) => {
      const active = types.has(stage.key);
      return `<span class="stage-dot ${active ? "done" : "pending"}">${stage.label}</span>`;
    })
    .join("");
}

function classifyTraceGroup(event) {
  const type = event.type || "";
  if (type.startsWith("runtime.")) return "runtime";
  if (type.includes("approve") || type.includes("approval")) return "approval";
  if (type.includes("rollback") || type.includes("rolled_back")) return "rollback";
  return "other";
}

function traceGroupTitle(key, list) {
  if (key === "approval") return `审批记录 (${list.length})`;
  if (key === "rollback") return `回滚记录 (${list.length})`;
  if (key === "runtime") return `系统执行记录（高级） (${list.length})`;
  return `补充记录 (${list.length})`;
}

function traceEventDetail(event) {
  const p = event.payload || {};
  if (p.runtimeType) {
    return `${localizeEventType(p.runtimeType)}${p.runtimeEventId ? ` (${p.runtimeEventId})` : ""}${p.runtimeToolName ? ` / 系统能力:${p.runtimeToolName}` : ""}${p.runtimeMessage ? ` / ${localizeOutputText(p.runtimeMessage)}` : ""}`;
  }
  const raw = (
    p.goal
    || p.query
    || p.severity
    || (p.approverRole && p.approverId ? `审批人：${p.approverRole}@${p.approverId}` : "")
    || (p.rollbackByRole && p.rollbackByUserId ? `回滚操作：${p.rollbackByRole}@${p.rollbackByUserId}` : "")
    || p.childAgentName
    || p.name
    || "事件记录"
  );
  return localizeOutputText(raw);
}

function traceEventDomId(event) {
  const raw = event && event.id ? String(event.id) : `${event.type}-${event.at}`;
  return `trace-${raw.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function traceGroupStateKey(taskId, group) {
  return `${String(taskId || "")}:${String(group || "")}`;
}

function keyTraceEventTypes() {
  return new Set([
    "task.approval.required",
    "task.approved",
    "task.rollback.triggered",
    "task.rolled_back",
    "task.aborted",
    "task.failed",
    "task.succeeded",
  ]);
}

function renderTraceGroupItems(events, keyTypes) {
  return events
    .map((event) => {
      const detail = traceEventDetail(event);
      const isKey = keyTypes.has(event.type);
      const domId = traceEventDomId(event);
      return `
      <div id="${domId}" class="trace-item ${isKey ? "key" : ""}">
        <strong>${escapeHtml(localizeEventType(event.type))}</strong>
        <p>${escapeHtml(detail)}</p>
        <small>${new Date(event.at).toLocaleString()}</small>
      </div>`;
    })
    .join("");
}

function renderTraceDrawer() {
  const body = document.getElementById("activityList");
  const titleNode = document.getElementById("processPanelTitle");
  if (!body || !state.traceTaskId) return;
  const task = state.tasks.find((x) => x.id === state.traceTaskId);
  const events = taskEvents(state.traceTaskId);
  const title = task ? `处理过程 · ${task.id.slice(0, 8)}` : "任务处理过程";
  if (titleNode) titleNode.textContent = title;
  if (!events.length) {
    body.innerHTML = `<div class="empty-thread">暂无记录</div>`;
  } else {
    const keyTypes = keyTraceEventTypes();
    const keyEvents = events.filter((event) => keyTypes.has(event.type));
    const grouped = { approval: [], rollback: [], runtime: [], other: [] };
    for (const event of events) {
      const key = classifyTraceGroup(event);
      grouped[key].push(event);
    }
    const order = ["approval", "rollback", "runtime", "other"];
    const keySection = keyEvents.length
      ? `
        <div class="trace-key-nodes">
          <h4>处理里程碑</h4>
          <p class="trace-hint">用于快速查看关键状态变化，可点击跳转到对应记录。</p>
          <div class="trace-key-list">
            ${keyEvents
              .slice(-8)
              .map((event) => `
                <button type="button" class="trace-key-item trace-jump" data-target="${traceEventDomId(event)}">
                  <strong>${escapeHtml(localizeEventType(event.type))}</strong>
                  <p>${escapeHtml(traceEventDetail(event))}</p>
                  <small>${new Date(event.at).toLocaleString()}</small>
                </button>
              `)
              .join("")}
          </div>
        </div>
      `
      : "";
    body.innerHTML = keySection + order
      .filter((key) => grouped[key].length > 0)
      .map((key) => `
        <details class="trace-group" data-trace-group="${key}" ${
          Object.prototype.hasOwnProperty.call(state.traceGroupOpen, traceGroupStateKey(state.traceTaskId, key))
            ? (state.traceGroupOpen[traceGroupStateKey(state.traceTaskId, key)] ? "open" : "")
            : (key === "runtime" ? "open" : "")
        }>
          <summary>${traceGroupTitle(key, grouped[key])}</summary>
          <div class="trace-group-body">
            ${renderTraceGroupItems(grouped[key], keyTypes)}
          </div>
        </details>
      `)
      .join("");

    for (const btn of body.querySelectorAll(".trace-jump")) {
      btn.onclick = () => {
        const targetId = btn.getAttribute("data-target");
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        const group = target.closest(".trace-group");
        if (group && !group.hasAttribute("open")) {
          group.setAttribute("open", "open");
          const groupName = group.getAttribute("data-trace-group") || "";
          state.traceGroupOpen[traceGroupStateKey(state.traceTaskId, groupName)] = true;
        }
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.add("focus");
        setTimeout(() => target.classList.remove("focus"), 900);
      };
    }

    for (const detailsNode of body.querySelectorAll(".trace-group")) {
      detailsNode.addEventListener("toggle", () => {
        const groupName = detailsNode.getAttribute("data-trace-group") || "";
        state.traceGroupOpen[traceGroupStateKey(state.traceTaskId, groupName)] = detailsNode.hasAttribute("open");
      });
    }
  }
}

function renderRuntimePanel(tasks) {
  const taskFilterNode = document.getElementById("runtimeTaskFilter");
  const typeFilterNode = document.getElementById("runtimeTypeFilter");
  const metaNode = document.getElementById("runtimeEventMeta");
  const listNode = document.getElementById("runtimeEventList");
  if (!taskFilterNode || !typeFilterNode || !metaNode || !listNode) return;

  const taskOptions = tasks
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((task) => `<option value="${task.id}">事项 ${escapeHtml(task.id.slice(0, 8))} · ${escapeHtml(task.goal.slice(0, 18))}</option>`)
    .join("");
  taskFilterNode.innerHTML = `<option value="all">事项：全部</option>${taskOptions}`;
  if (state.runtimeFilterTaskId !== "all" && !tasks.some((task) => task.id === state.runtimeFilterTaskId)) {
    state.runtimeFilterTaskId = "all";
  }
  taskFilterNode.value = state.runtimeFilterTaskId;
  const taskIds = new Set(tasks.map((task) => task.id));
  let runtimeEvents = state.events.filter((event) => {
    const payload = event.payload || {};
    const taskId = payload.taskId || payload.task_id;
    return taskIds.has(taskId) && (event.type === "runtime.raw.event" || event.type === "runtime.task.synced");
  });

  const runtimeTypes = new Set(
    runtimeEvents
      .map((event) => {
        const payload = event.payload || {};
        return payload.runtimeType || event.type;
      })
      .filter(Boolean)
  );
  const typeOptions = ["all", ...Array.from(runtimeTypes).sort()];
  typeFilterNode.innerHTML = typeOptions
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type === "all" ? "记录类型：全部" : localizeEventType(type))}</option>`)
    .join("");
  if (!typeOptions.includes(state.runtimeFilterType)) state.runtimeFilterType = "all";
  typeFilterNode.value = state.runtimeFilterType;

  if (state.runtimeFilterTaskId !== "all") {
    runtimeEvents = runtimeEvents.filter((event) => {
      const payload = event.payload || {};
      return (payload.taskId || payload.task_id) === state.runtimeFilterTaskId;
    });
  }
  if (state.runtimeFilterType !== "all") {
    runtimeEvents = runtimeEvents.filter((event) => {
      const payload = event.payload || {};
      return (payload.runtimeType || event.type) === state.runtimeFilterType;
    });
  }
  runtimeEvents = runtimeEvents
    .slice()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 100);

  metaNode.textContent = runtimeEvents.length
    ? `系统记录 ${runtimeEvents.length} 条`
    : "当前筛选条件下暂无系统记录";

  if (!runtimeEvents.length) {
    listNode.innerHTML = `<div class="empty-thread">暂无系统记录</div>`;
  } else {
    listNode.innerHTML = runtimeEvents
      .map((event) => {
        const payload = event.payload || {};
        const taskId = payload.taskId || payload.task_id || "";
        const runtimeType = payload.runtimeType || event.type;
        const runtimeTaskId = payload.runtimeTaskId || "";
        const detail = payload.runtimeMessage
          || localizeOutputText(payload.runtimeToolName)
          || payload.runtimeAction
          || (payload.approverRole && payload.approverId ? `approver:${payload.approverRole}@${payload.approverId}` : "")
          || (payload.rollbackByRole && payload.rollbackByUserId ? `rollback:${payload.rollbackByRole}@${payload.rollbackByUserId}` : "")
          || `${localizeEventType(runtimeType)}${payload.runtimeEventId ? ` (${payload.runtimeEventId})` : ""}`;
        const tool = payload.runtimeToolName ? ` · 系统能力:${payload.runtimeToolName}` : "";
        return `
          <div class="activity-item">
            <strong>${escapeHtml(localizeEventType(runtimeType))}</strong>
            <p>${escapeHtml(`事项:${taskId.slice(0, 8)} · 执行批次:${runtimeTaskId.slice(0, 8) || "-"}${tool}`)}</p>
            <p>${escapeHtml(localizeOutputText(detail))}</p>
            <small>${new Date(event.at).toLocaleString()}</small>
          </div>
        `;
      })
      .join("");
  }

  taskFilterNode.onchange = () => {
    state.runtimeFilterTaskId = taskFilterNode.value || "all";
    renderRuntimePanel(tasks);
  };
  typeFilterNode.onchange = () => {
    state.runtimeFilterType = typeFilterNode.value || "all";
    renderRuntimePanel(tasks);
  };
}

function renderAllThreadViews() {
  const tasks = getThreadTasks();
  const messages = getThreadMessages();
  const taskIds = new Set(tasks.map((item) => item.id));
  const events = getThreadEvents(taskIds).sort((a, b) => new Date(b.at) - new Date(a.at));
  renderThreads();
  renderChat(messages);
  renderSummary(tasks, events);
  renderKnowledgeHubEntry();
  renderKnowledgeCard();
  renderComposerAttachments();
  renderRuntimePanel(tasks);
  renderActivity(events);
  const workbench = document.querySelector(".workbench");
  const rail = document.querySelector(".right-rail");
  const modeBadge = document.querySelector(".mode-badge");
  if (workbench) {
    workbench.classList.toggle("panel-open", state.processPanelOpen);
  }
  if (rail) {
    rail.classList.toggle("open", state.processPanelOpen);
    rail.classList.toggle("trace-only", state.processPanelOpen && Boolean(state.traceTaskId));
  }
  if (modeBadge) {
    modeBadge.textContent = "执行优先模式";
    modeBadge.classList.remove("governance");
  }
  if (state.processPanelOpen && state.traceTaskId) {
    renderTraceDrawer();
  }
}

function showMsg(msg, isErr = false) {
  const el = document.getElementById("flash");
  if (!el) return;
  showMsg.seq = Number(showMsg.seq || 0) + 1;
  const seq = showMsg.seq;
  el.textContent = msg;
  el.className = `flash-msg show ${isErr ? "error" : "ok"}`;
  if (!msg) return;
  window.clearTimeout(showMsg.timer);
  showMsg.timer = window.setTimeout(() => {
    if (seq !== showMsg.seq) return;
    el.textContent = "";
    el.className = "flash-msg";
  }, 2500);
}

function showSubscriptionModalMsg(msg, isErr = false) {
  const el = document.getElementById("subscriptionModalFlash");
  if (!el) return;
  el.textContent = String(msg || "");
  el.className = `modal-inline-flash ${isErr ? "error" : "ok"}`;
  if (!msg) return;
  window.clearTimeout(showSubscriptionModalMsg.timer);
  showSubscriptionModalMsg.timer = window.setTimeout(() => {
    const latest = document.getElementById("subscriptionModalFlash");
    if (!latest) return;
    latest.textContent = "";
    latest.className = "modal-inline-flash";
  }, 3000);
}

function looksLikeFrontApiMissing(error) {
  if (!error) return false;
  const path = String(error.path || "");
  const code = String(error.code || "");
  const status = Number(error.status || 0);
  if (path.includes("/api/front/knowledge/")) return false;
  if (path.includes("/api/front/") && status === 404) return true;
  if (code === "NETWORK_ERROR" && String(error.message || "").includes("/api/front/")) return true;
  return false;
}

function markFrontApiMissing(error) {
  state.frontApiMissing = true;
  if (state.frontApiHintShown) return;
  state.frontApiHintShown = true;
  const path = String((error && error.path) || "/api/front/*");
  showMsg(
    `当前服务缺少用户端接口（${path}）。请切到 DCF 服务地址：http://127.0.0.1:8092/front.html`,
    true
  );
}

function openModal() {
  syncCreateEmployeeFormDefaults();
  const modal = document.getElementById("employeeModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const modal = document.getElementById("employeeModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openAccountSettingsModal() {
  const modal = document.getElementById("accountSettingsModal");
  if (!modal) return;
  state.settingsModalOpen = true;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  showSubscriptionModalMsg("");
  renderSubscriptionEditorState();
  loadSubscriptions().catch((error) => showSubscriptionModalMsg(error.message || "加载订阅失败", true));
}

function closeAccountSettingsModal() {
  const modal = document.getElementById("accountSettingsModal");
  if (!modal) return;
  state.settingsModalOpen = false;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  state.subscriptionEditor = { mode: "create", subscriptionId: "" };
  showSubscriptionModalMsg("");
}

function renderSubscriptionEditorState() {
  const submitBtn = document.querySelector("#subscriptionNlForm button[type='submit']");
  const cancelBtn = document.getElementById("subscriptionEditorCancel");
  const textInput = document.getElementById("subscriptionNlText");
  if (!submitBtn || !textInput || !cancelBtn) return;
  if (state.subscriptionEditor && state.subscriptionEditor.mode === "edit") {
    submitBtn.textContent = "保存修改";
    textInput.placeholder = "修改后的规则描述，例如：改为每3小时推送，主题改为AI安全";
    cancelBtn.classList.remove("hidden");
  } else {
    submitBtn.textContent = "新增订阅";
    textInput.placeholder = "例如：帮我订阅 https://tisi.org/ 最新 AI 消息，每2小时推送一次简报";
    cancelBtn.classList.add("hidden");
  }
}

function openSubscriptionEditor(subscription) {
  const textInput = document.getElementById("subscriptionNlText");
  if (!textInput || !subscription) return;
  state.subscriptionEditor = {
    mode: "edit",
    subscriptionId: subscription.id
  };
  const template = [
    `请把订阅 ${subscription.sourceUrl || ""}`,
    `主题改为 ${subscription.topic || "AI"}`,
    `频率改为每 ${Number(subscription.intervalMinutes || 60)} 分钟`,
  ].join("，");
  textInput.value = template;
  textInput.focus();
  renderSubscriptionEditorState();
}

function resetSubscriptionEditor() {
  state.subscriptionEditor = { mode: "create", subscriptionId: "" };
  const textInput = document.getElementById("subscriptionNlText");
  if (textInput) textInput.value = "";
  renderSubscriptionEditorState();
}

function resolveCreatorDepartment() {
  const user = state.authUser && typeof state.authUser === "object" ? state.authUser : {};
  const explicit = String(user.department || "").trim();
  if (explicit) return explicit;
  const role = String(user.role || "").trim();
  const roleDept = {
    super_admin: "Management",
    ops_admin: "Ops",
    ops_owner: "Ops",
    auditor: "Audit",
    skill_admin: "Skill",
  };
  return roleDept[role] || "Ops";
}

function resolveCreatorPosition() {
  const user = state.authUser && typeof state.authUser === "object" ? state.authUser : {};
  const candidates = [
    user.position,
    user.post,
    user.jobTitle,
    user.title,
    user.roleName,
    user.profile && typeof user.profile === "object" ? user.profile.position : "",
  ];
  for (const item of candidates) {
    const normalized = String(item || "").trim();
    if (normalized) {
      return normalized.endsWith("实习生") ? normalized : `${normalized}实习生`;
    }
  }
  return "";
}

function resolveCreatorIdentity() {
  const user = state.authUser && typeof state.authUser === "object" ? state.authUser : {};
  const byUsername = String(user.username || "").trim();
  if (byUsername) return byUsername;
  const byUserId = String(user.id || "").trim();
  if (byUserId) return byUserId;

  const cacheKey = `${STORAGE_KEY}:creator-id`;
  const existing = String(localStorage.getItem(cacheKey) || "").trim();
  if (existing) return existing;
  const generated = `front-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(cacheKey, generated);
  return generated;
}

function syncCreateEmployeeFormDefaults() {
  const departmentInput = document.getElementById("employeeDepartmentInput");
  const roleInput = document.getElementById("employeeRoleInput");
  const defaultPosition = resolveCreatorPosition();
  if (departmentInput) {
    departmentInput.value = resolveCreatorDepartment();
    departmentInput.disabled = true;
    departmentInput.setAttribute("aria-disabled", "true");
  }
  if (roleInput) {
    const current = String(roleInput.value || "").trim();
    const shouldOverwrite = !current || roleInput.dataset.autoFilled === "true";
    if (shouldOverwrite) {
      roleInput.value = defaultPosition;
      roleInput.dataset.autoFilled = "true";
    }
  }
}

function parseCommandInput(raw) {
  const text = String(raw || "");
  const mention = text.match(/@([A-Za-z0-9_-]+)/);
  const level = text.match(/#(L[1-4])/i);
  const clean = text.replace(/@[A-Za-z0-9_-]+/g, "").replace(/#L[1-4]/gi, "");
  return {
    goal: clean.trim() ? clean : text,
    employeeCode: mention ? mention[1] : null,
    riskLevel: level ? level[1].toUpperCase() : "L2",
  };
}

function currentLlmConfig() {
  const modelInput = document.getElementById("modelInput");
  const thinkingLevelSelect = document.getElementById("thinkingLevelSelect");
  const toolPolicySelect = document.getElementById("toolPolicySelect");
  return {
    model: (modelInput && modelInput.value ? String(modelInput.value).trim() : "") || null,
    thinkingLevel: (thinkingLevelSelect && thinkingLevelSelect.value) || "medium",
    toolPolicy: (toolPolicySelect && toolPolicySelect.value) || "balanced",
    requireRealLlm: true,
  };
}

function employeeIdByCode(code) {
  if (!code) return state.activeEmployeeId;
  const found = state.employees.find((e) => e.employeeCode.toLowerCase() === code.toLowerCase());
  return found ? found.id : state.activeEmployeeId;
}

async function refreshConversationsByActiveEmployee() {
  if (state.frontApiMissing) return;
  if (!state.activeEmployeeId) {
    state.activeThreadId = "";
    state.messages = [];
    return;
  }
  const list = await api(`/api/front/conversations?employeeId=${encodeURIComponent(state.activeEmployeeId)}`);
  state.threads[state.activeEmployeeId] = sortThreads(Array.isArray(list) ? list : []);
}

async function refreshMessagesByActiveThread() {
  if (state.frontApiMissing) return;
  if (!state.activeEmployeeId || !state.activeThreadId) {
    state.messages = [];
    return;
  }
  const list = await api(
    `/api/front/messages?employeeId=${encodeURIComponent(state.activeEmployeeId)}&conversationId=${encodeURIComponent(state.activeThreadId)}`
  );
  state.messages = Array.isArray(list) ? list : [];
}

async function refreshKnowledgeAssetsByActiveEmployee() {
  if (state.frontApiMissing) return;
  if (!state.activeEmployeeId) {
    state.knowledgeAssets = [];
    return;
  }
  try {
    const list = await api(`/api/front/knowledge/assets?employeeId=${encodeURIComponent(state.activeEmployeeId)}`);
    state.knowledgeAssets = Array.isArray(list) ? list : [];
  } catch (error) {
    if (Number(error.status || 0) === 404 || Number(error.status || 0) === 400 || Number(error.status || 0) === 403) {
      state.knowledgeAssets = [];
      return;
    }
    throw error;
  }
}

function renderSubscriptionSettingsList() {
  const wrap = document.getElementById("subscriptionSettingsList");
  if (!wrap) return;
  if (!Array.isArray(state.subscriptions) || state.subscriptions.length === 0) {
    wrap.innerHTML = `<div class="empty-thread">暂无订阅。可在上方输入自然语言创建。</div>`;
    return;
  }
  wrap.innerHTML = state.subscriptions
    .map((item) => {
      const statusBadge = item.status === "active"
        ? `<span class="badge succeeded">active</span>`
        : `<span class="badge queued">paused</span>`;
      const summary = escapeHtml(item.ruleSummary || "无规则摘要");
      const sourceUrl = escapeHtml(item.sourceUrl || "");
      return `
        <div class="subscription-row" data-subscription-id="${item.id}">
          <div class="subscription-row-head">
            <strong>${escapeHtml(item.topic || "未命名主题")}</strong>
            ${statusBadge}
          </div>
          <p>${summary}</p>
          <small>${sourceUrl}</small>
          <p>频率：每 ${Number(item.intervalMinutes || 60)} 分钟</p>
          <div class="subscription-actions">
            <button type="button" class="secondary" data-action="edit">编辑</button>
            <button type="button" data-action="run">立即执行</button>
            ${item.status === "active"
              ? `<button type="button" class="secondary" data-action="pause">暂停</button>`
              : `<button type="button" class="secondary" data-action="resume">恢复</button>`}
          </div>
        </div>
      `;
    })
    .join("");

  for (const button of wrap.querySelectorAll("[data-action]")) {
    button.onclick = async () => {
      const row = button.closest("[data-subscription-id]");
      if (!row) return;
      const subscriptionId = row.getAttribute("data-subscription-id");
      const action = button.getAttribute("data-action");
      const targetSubscription = (state.subscriptions || []).find((item) => item.id === subscriptionId);
      try {
        if (action === "edit") {
          openSubscriptionEditor(targetSubscription);
          showSubscriptionModalMsg("已进入编辑模式，可直接修改并保存。");
          return;
        }
        if (action === "pause") {
          await api(`/api/front/subscriptions/${encodeURIComponent(subscriptionId)}/pause`, {
            method: "POST",
            body: JSON.stringify({ reason: "user paused in settings" })
          });
          showSubscriptionModalMsg("订阅已暂停");
        } else if (action === "resume") {
          await api(`/api/front/subscriptions/${encodeURIComponent(subscriptionId)}/resume`, {
            method: "POST",
            body: JSON.stringify({})
          });
          showSubscriptionModalMsg("订阅已恢复");
        } else if (action === "run") {
          await api(`/api/front/subscriptions/${encodeURIComponent(subscriptionId)}/run`, {
            method: "POST",
            body: JSON.stringify({})
          });
          showSubscriptionModalMsg("已触发订阅执行");
        }
        await loadSubscriptions();
        await refresh();
      } catch (error) {
        showSubscriptionModalMsg(error.message || "订阅操作失败", true);
      }
    };
  }
}

async function loadSubscriptions() {
  if (state.frontApiMissing) return;
  try {
    const rows = await api("/api/front/subscriptions");
    state.subscriptions = Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (Number(error.status || 0) === 404) {
      state.subscriptions = [];
      return;
    }
    throw error;
  }
  if (state.settingsModalOpen) renderSubscriptionSettingsList();
  if (
    state.subscriptionEditor
    && state.subscriptionEditor.mode === "edit"
    && !state.subscriptions.some((item) => item.id === state.subscriptionEditor.subscriptionId)
  ) {
    resetSubscriptionEditor();
  }
}

function setupCommandAssist() {
  const input = document.getElementById("goalInput");
  const assist = document.getElementById("commandAssist");

  function hideAssist() {
    assist.classList.add("hidden");
    assist.innerHTML = "";
  }

  function drawMentionOptions(prefix) {
    const q = prefix.toLowerCase();
    const options = state.employees
      .filter((e) => e.employeeCode.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .slice(0, 6);
    if (!options.length) return hideAssist();
    assist.classList.remove("hidden");
    assist.innerHTML = options
      .map(
        (e) => `<button type="button" class="assist-item" data-code="${e.employeeCode}">@${e.employeeCode} · ${escapeHtml(e.name)}</button>`
      )
      .join("");
    for (const btn of assist.querySelectorAll(".assist-item")) {
      btn.onclick = () => {
        const raw = input.value;
        input.value = raw.replace(/@([A-Za-z0-9_-]*)$/, `@${btn.dataset.code} `);
        input.focus();
        hideAssist();
      };
    }
  }

  input.addEventListener("input", () => {
    const text = input.value;
    const mention = text.match(/@([A-Za-z0-9_-]*)$/);
    if (mention) return drawMentionOptions(mention[1] || "");
    hideAssist();
  });

  input.addEventListener("blur", () => {
    setTimeout(hideAssist, 150);
  });
}

function setupComposerPanels() {
  const advancedConfig = document.getElementById("advancedConfig");
  const toggleAdvancedConfig = document.getElementById("toggleAdvancedConfig");
  if (toggleAdvancedConfig && advancedConfig) {
    toggleAdvancedConfig.onclick = () => {
      advancedConfig.classList.toggle("hidden");
    };
  }
}

function setupComposerInputBehavior() {
  const input = document.getElementById("goalInput");
  if (!input) return;
  const platform = typeof navigator !== "undefined" ? String(navigator.platform || "") : "";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    const newlineModifierPressed = isMac ? event.metaKey : event.ctrlKey;
    if (newlineModifierPressed) {
      event.preventDefault();
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      input.setRangeText("\n", start, end, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    event.preventDefault();
    const form = document.getElementById("chatForm");
    if (!form) return;
    form.requestSubmit();
  });
  input.addEventListener("paste", (event) => {
    const items = event.clipboardData && event.clipboardData.items
      ? Array.from(event.clipboardData.items)
      : [];
    const imageFiles = [];
    for (const item of items) {
      if (!String(item.type || "").startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
    if (!imageFiles.length) return;
    event.preventDefault();
    appendComposerAttachments(imageFiles).catch(() => {
      showMsg("粘贴图片失败，请重试", true);
    });
  });
}

function setupComposerAttachmentTools() {
  const uploadBtn = document.getElementById("uploadAttachmentBtn");
  const attachmentInput = document.getElementById("attachmentInput");

  if (uploadBtn && attachmentInput) {
    uploadBtn.onclick = () => attachmentInput.click();
    attachmentInput.onchange = () => {
      const files = attachmentInput.files ? Array.from(attachmentInput.files) : [];
      if (!files.length) return;
      appendComposerAttachments(files)
        .catch(() => showMsg("上传附件失败，请重试", true))
        .finally(() => {
          attachmentInput.value = "";
        });
    };
  }

}

function normalizeModelList(list) {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(
    list
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
}

function renderModelSelectOptions(models) {
  const modelSelect = document.getElementById("modelInput");
  if (!modelSelect) return;
  const currentValue = String(modelSelect.value || "").trim();
  const items = normalizeModelList(models);
  modelSelect.innerHTML = [
    `<option value="">处理引擎：默认</option>`,
    ...items.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
  ].join("");
  modelSelect.value = items.includes(currentValue) ? currentValue : "";
}

function mergeEvents(incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  const map = new Map(state.events.map((event) => [event.id, event]));
  for (const event of incoming) map.set(event.id, event);
  state.events = [...map.values()].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 800);
  state.latestEventSeq = state.events.reduce((max, ev) => Math.max(max, Number(ev.seq || 0)), state.latestEventSeq || 0);
}

function connectEventStream() {
  if (typeof window.EventSource !== "function") return;
  const stream = new EventSource(`/api/events/stream?since=${state.latestEventSeq || 0}`);

  stream.onopen = () => {
    state.streamConnected = true;
  };

  stream.onmessage = (event) => {
    if (!event || !event.data) return;
    try {
      const parsed = JSON.parse(event.data);
      mergeEvents([parsed]);
      renderAllThreadViews();
    } catch {
      // ignore malformed stream payload
    }
  };

  stream.onerror = () => {
    state.streamConnected = false;
    stream.close();
    setTimeout(connectEventStream, 2500);
  };
}

async function refresh() {
  const refreshToken = refreshRequestGuard.issue();
  let me = { authenticated: false };
  try {
    me = await api("/api/auth/me");
  } catch {
    me = { authenticated: false };
  }
  if (!me || me.authenticated !== true) {
    redirectToFrontLogin();
    return;
  }
  const [employees, tasks, eventsDelta, skills, models, subscriptions] = await Promise.all([
    state.frontApiMissing ? Promise.resolve([]) : api("/api/front/employees"),
    state.frontApiMissing ? Promise.resolve([]) : api("/api/front/tasks").catch(() => []),
    api(`/api/events?since=${state.latestEventSeq || 0}&limit=300`).catch(() => []),
    api("/api/skills").catch(() => []),
    state.frontApiMissing ? Promise.resolve([]) : api("/api/front/models").catch(() => []),
    state.frontApiMissing ? Promise.resolve([]) : api("/api/front/subscriptions").catch(() => []),
  ]);
  if (!refreshRequestGuard.isCurrent(refreshToken)) return;
  state.employees = employees;
  state.tasks = tasks;
  mergeEvents(eventsDelta);
  state.skills = skills;
  state.configuredModels = normalizeModelList(models);
  state.subscriptions = Array.isArray(subscriptions) ? subscriptions : [];
  if (!state.frontApiMissing) {
    const config = await api("/api/front/knowledge/config").catch(() => null);
    if (config && typeof config === "object") {
      state.knowledgeConfig = {
        enabled: config.enabled !== false,
        entryUrl: String(config.entryUrl || state.knowledgeConfig.entryUrl || "http://127.0.0.1:19080").trim() || "http://127.0.0.1:19080",
        useSsoBridge: config.useSsoBridge === true
      };
    }
  }
  state.authUser = me.user;
  renderAuthUserCard();
  syncCreateEmployeeFormDefaults();
  if (state.settingsModalOpen) {
    renderSubscriptionSettingsList();
  }

  ensureActiveEmployee();
  renderEmployees();
  renderModelSelectOptions(state.configuredModels);
  try {
    await refreshConversationsByActiveEmployee();
    if (!refreshRequestGuard.isCurrent(refreshToken)) return;
    ensureThreadForEmployee();
    await refreshMessagesByActiveThread();
    if (!refreshRequestGuard.isCurrent(refreshToken)) return;
    await refreshKnowledgeAssetsByActiveEmployee();
    if (!refreshRequestGuard.isCurrent(refreshToken)) return;
  } catch (error) {
    if (looksLikeFrontApiMissing(error)) {
      markFrontApiMissing(error);
    }
    // Keep employee list and create-lock state visible even if thread/message sync fails.
  }
  saveLocalState();
  renderAllThreadViews();
}

async function safeRefresh() {
  try {
    await refresh();
  } catch (error) {
    if (error && error.code === "UNAUTHENTICATED") {
      redirectToFrontLogin();
      return;
    }
    if (looksLikeFrontApiMissing(error)) {
      markFrontApiMissing(error);
      return;
    }
    if (error && Number(error.status || 0) === 404) {
      const path = String(error.path || "");
      if (path.includes("/api/front/employees")) {
        showMsg("用户端接口暂不可用，请稍后重试", true);
      }
      return;
    }
    showMsg(error.message || "刷新失败", true);
  }
}

document.getElementById("employeeSelect").onchange = (event) => {
  state.activeEmployeeId = event.target.value;
  refreshConversationsByActiveEmployee()
    .then(() => {
      ensureThreadForEmployee();
      return refreshMessagesByActiveThread();
    })
    .then(() => refreshKnowledgeAssetsByActiveEmployee())
    .then(() => {
      saveLocalState();
      renderAllThreadViews();
    })
    .catch((error) => showMsg(error.message, true));
};

document.getElementById("newThreadBtn").onclick = () => {
  if (!state.activeEmployeeId) return showMsg("请先创建员工", true);
  createThread(state.activeEmployeeId)
    .then(() => refreshMessagesByActiveThread())
    .then(() => refresh())
    .catch((error) => showMsg(error.message, true));
};

document.getElementById("openCreateEmployee").onclick = () => {
  if (state.employees.length > 0) {
    showMsg("当前账号已创建员工，如左侧未显示请稍候自动刷新");
    safeRefresh();
    return;
  }
  openModal();
};

const employeeRoleInput = document.getElementById("employeeRoleInput");
if (employeeRoleInput) {
  employeeRoleInput.addEventListener("input", () => {
    employeeRoleInput.dataset.autoFilled = "false";
  });
}

document.getElementById("openKnowledgeHub").onclick = async () => {
  let probe = null;
  try {
    probe = await api("/api/front/knowledge/probe");
  } catch (error) {
    const message = String(error && error.message ? error.message : "知识库服务未启动，请先启动 WeKnora");
    showMsg(message, true);
    return;
  }
  const entry = String(((probe && probe.entryUrl) || (state.knowledgeConfig && state.knowledgeConfig.entryUrl) || "")).trim();
  if (!entry) {
    showMsg("外部知识库地址未配置", true);
    return;
  }
  const useSsoBridge = Boolean(
    (probe && probe.useSsoBridge === true)
    || (state.knowledgeConfig && state.knowledgeConfig.useSsoBridge === true)
  );
  if (useSsoBridge) {
    const bridgePath = `/api/auth/sso/knowledge-bridge-login?redirect=${encodeURIComponent("/platform/knowledge-bases")}`;
    const popup = window.open("", "_blank");
    if (!popup) {
      showMsg("浏览器拦截了新标签页，请允许弹窗后重试", true);
      return;
    }
    popup.document.title = "正在打开知识库...";
    try {
      const candidates = typeof buildFrontApiCandidates === "function"
        ? buildFrontApiCandidates(bridgePath, window.location.pathname, window.location)
        : [bridgePath];
      let bridgeUrl = "";
      for (let index = 0; index < candidates.length; index += 1) {
        const requestPath = candidates[index];
        let response;
        try {
          response = await fetch(requestPath, {
            method: "GET",
            credentials: "include",
            redirect: "manual",
          });
        } catch {
          continue;
        }
        if (response.status === 401) {
          throw new Error("未登录或会话已过期");
        }
        const location = String(response.headers.get("location") || "").trim();
        if ((response.status === 302 || response.status === 301 || response.status === 303 || response.status === 307 || response.status === 308) && location) {
          bridgeUrl = new URL(location, requestPath.startsWith("http") ? requestPath : window.location.origin).toString();
          break;
        }
      }
      if (!bridgeUrl) {
        const payload = await api(
          `/api/auth/sso/knowledge-bridge-url?redirect=${encodeURIComponent("/platform/knowledge-bases")}`
        );
        bridgeUrl = String((payload && payload.url) || "").trim();
      }
      if (!bridgeUrl) {
        throw new Error("知识库桥接登录失败");
      }
      if (!popup.closed) {
        popup.location.href = bridgeUrl;
      }
    } catch (error) {
      if (!popup.closed) popup.close();
      showMsg(error.message || "知识库桥接登录失败", true);
    }
    return;
  }
  const target = new URL(entry, window.location.origin);
  if (target.pathname === '/' || target.pathname === '') {
    target.pathname = '/platform/knowledge-bases';
  }
  window.open(target.toString(), "_blank", "noopener,noreferrer");
};
document.getElementById("closeEmployeeModal").onclick = closeModal;
document.getElementById("employeeModal").onclick = (event) => {
  if (event.target.id === "employeeModal") closeModal();
};

document.getElementById("employeeForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const raw = Object.fromEntries(new FormData(event.target).entries());
    const creatorDepartment = resolveCreatorDepartment();
    const payload = {
      creator: resolveCreatorIdentity(),
      name: String(raw.name || "").trim(),
      department: creatorDepartment || String(raw.department || "").trim(),
      role: String(raw.role || resolveCreatorPosition() || "").trim()
    };
    await api("/api/front/employees", { method: "POST", body: JSON.stringify(payload) });
    event.target.reset();
    closeModal();
    showMsg("员工创建成功");
    await refresh();
  } catch (error) {
    const message = String((error && error.message) || "");
    if (message.includes("only create one parent digital employee")) {
      closeModal();
      await refresh();
      return;
    }
    if (/not found/i.test(message)) {
      await refresh().catch(() => {});
      if (Array.isArray(state.employees) && state.employees.length > 0) {
        closeModal();
        return;
      }
      showMsg("创建接口不可用，请稍后重试", true);
      return;
    }
    showMsg(message || "创建失败", true);
  }
};

document.getElementById("chatForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    if (!state.employees.length) {
      showMsg("请先创建员工", true);
      openModal();
      return;
    }
    await refreshConversationsByActiveEmployee();
    ensureThreadForEmployee();
    if (!state.activeThreadId) {
      await createThread(state.activeEmployeeId, "新会话");
    }
    await refreshMessagesByActiveThread();
    const form = new FormData(event.target);
    const raw = String(form.get("goal") || "");
    const parsed = parseCommandInput(raw);
    const employeeId = employeeIdByCode(parsed.employeeCode);
    if (!String(parsed.goal || "").trim()) return showMsg("请输入任务目标", true);
    const textWithAttachments = `${parsed.goal}${buildAttachmentPromptSuffix()}`;

    const dispatchResult = await api("/api/front/dispatch", {
      method: "POST",
      body: JSON.stringify({
        employeeId,
        text: textWithAttachments,
        attachments: buildDispatchAttachments(),
        riskLevel: parsed.riskLevel,
        conversationId: state.activeThreadId,
        llmConfig: currentLlmConfig(),
      }),
    });
    event.target.reset();
    clearComposerAttachments();
    if (dispatchResult && dispatchResult.mode === "action") showMsg("已发送");
    else showMsg("已回复");
    await refresh();
  } catch (error) {
    showMsg(error.message, true);
  }
};

loadLocalState();
setupCommandAssist();
setupComposerPanels();
setupComposerInputBehavior();
setupComposerAttachmentTools();
safeRefresh();
connectEventStream();
setInterval(safeRefresh, 2500);

document.getElementById("frontLogoutBtn").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {}
  redirectToFrontLogin();
};

document.getElementById("frontSettingsBtn").onclick = () => {
  if (!state.authUser) return;
  closeAccountActions();
  openAccountSettingsModal();
};

document.getElementById("frontUserToggle").onclick = () => {
  if (!state.authUser) return;
  state.accountActionsOpen = !state.accountActionsOpen;
  syncAccountActionsVisibility();
};

document.getElementById("closeAccountSettingsModal").onclick = () => {
  closeAccountSettingsModal();
};

document.getElementById("accountSettingsModal").onclick = (event) => {
  if (event.target && event.target.id === "accountSettingsModal") closeAccountSettingsModal();
};

document.getElementById("subscriptionNlForm").onsubmit = async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const text = String(formData.get("text") || "").trim();
  if (!text) {
    showSubscriptionModalMsg("请输入完整订阅描述", true);
    return;
  }
  try {
    const editing = state.subscriptionEditor && state.subscriptionEditor.mode === "edit";
    const managed = await api("/api/front/subscriptions/nl/manage", {
      method: "POST",
      body: JSON.stringify({
        subscriptionId: editing ? state.subscriptionEditor.subscriptionId : "",
        text,
        deliverConfirmation: false
      })
    });
    if (managed && managed.status === "needs_clarification") {
      showSubscriptionModalMsg(managed.message || "请补充信息后再修改", true);
      return;
    }
    const summary = managed && managed.inferred
      ? managed.inferred.ruleSummary
      : (managed && managed.subscription && managed.subscription.ruleSummary) || "";
    if (editing) showSubscriptionModalMsg(summary || "订阅修改成功");
    else showSubscriptionModalMsg(summary || "订阅创建成功");
    resetSubscriptionEditor();
    await loadSubscriptions();
    await refresh();
  } catch (error) {
    showSubscriptionModalMsg(error.message || "创建订阅失败", true);
  }
};

document.getElementById("subscriptionEditorCancel").onclick = () => {
  resetSubscriptionEditor();
  showSubscriptionModalMsg("已取消编辑。");
};

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest(".rail-account")) {
    closeAccountActions();
  }
  if (state.threadMenuOpenId && !target.closest(".thread-actions")) {
    state.threadMenuOpenId = "";
    renderThreads();
  }
  if (target.id === "closeProcessPanel") {
    state.processPanelOpen = false;
    state.traceTaskId = "";
    renderAllThreadViews();
    return;
  }
  if (target.classList.contains("trace-open")) {
    state.traceTaskId = target.dataset.taskId || "";
    state.processPanelOpen = true;
    renderAllThreadViews();
    return;
  }
  if (target.classList.contains("task-abort")) {
    const taskId = target.dataset.taskId || "";
    if (!taskId) return;
    api(`/api/tasks/${taskId}/abort`, { method: "POST", body: JSON.stringify({}) })
      .then(() => refresh())
      .catch((error) => showMsg(error.message, true));
  }
  if (target.classList.contains("approval-action")) {
    const taskId = target.dataset.taskId || "";
    const role = target.dataset.role || "";
    if (!taskId || !role) return;
    const approverId = `front-${role}`;
    api(`/api/front/tasks/${taskId}/approve`, {
      method: "POST",
      body: JSON.stringify({
        approverId,
        approverRole: role,
        note: `approved in front by ${role}`,
      }),
    })
      .then(() => {
        showMsg(`已完成 ${role} 审批`);
        return refresh();
      })
      .catch((error) => showMsg(error.message, true));
  }
  if (target.classList.contains("approval-reject")) {
    const taskId = target.dataset.taskId || "";
    if (!taskId) return;
    api(`/api/front/tasks/${taskId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "approval rejected by front governance action" }),
    })
      .then(() => {
        showMsg("任务已驳回并回滚");
        return refresh();
      })
      .catch((error) => showMsg(error.message, true));
  }
  if (target.classList.contains("oss-confirm-action")) {
    const caseId = target.dataset.caseId || "";
    const confirmed = String(target.dataset.confirm || "").toLowerCase() !== "no";
    if (!caseId) return;
    api(`/api/front/oss-cases/${caseId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        confirm: confirmed,
        note: confirmed ? "confirmed from front IM" : "rejected from front IM",
      }),
    })
      .then(() => {
        showMsg(confirmed ? "已确认建议" : "已拒绝建议");
        return refresh();
      })
      .catch((error) => showMsg(error.message, true));
  }
});

window.addEventListener("resize", () => {
  renderAllThreadViews();
});
