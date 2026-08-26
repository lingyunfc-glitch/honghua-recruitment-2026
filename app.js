const API_BASE = "https://api.zhangxiaolei.top";
const SNAPSHOT_URL = "./data.json";
const TOKEN_KEY = "hh_recruitment_editor_token";
const PUBLIC_CACHE_KEY = "hh_recruitment_recent_public_data";
const MOTION_KEY = "hh_recruitment_motion_mode";

const stages = [
  ["suitableCount", "合适人选"],
  ["interviewCount", "已面试"],
  ["salaryCount", "薪酬谈判"],
  ["offerCount", "已发Offer"],
  ["onboardCount", "已到岗"],
];

const state = {
  items: [],
  tab: "overview",
  canEdit: false,
  department: "全部部门",
  recruitmentType: "全部方式",
  progress: "全部进展",
  query: "",
  loading: true,
  error: "",
  motion: window.localStorage.getItem(MOTION_KEY) === "dynamic" ? "dynamic" : "meeting",
};

const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const content = document.querySelector("#content");
const overlayRoot = document.querySelector("#overlay-root");
const notice = document.querySelector("#notice");
const latestTime = document.querySelector("#latest-time");
const overviewTab = document.querySelector("#overview-tab");
const positionsTab = document.querySelector("#positions-tab");
const adminButton = document.querySelector("#admin-button");
const meetingButton = document.querySelector("#meeting-mode");
const dynamicButton = document.querySelector("#dynamic-mode");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  return value ? formatter.format(new Date(value)).replaceAll("/", "-") : "尚未更新";
}

function editorToken() {
  return window.sessionStorage.getItem(TOKEN_KEY) || "";
}

function publicItems(items) {
  return items.map((item) => ({ ...item, candidateNames: null }));
}

function itemTimestamp(item) {
  const timestamp = Date.parse(item?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cachePublicItems(items) {
  try {
    window.localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(publicItems(items)));
  } catch {
    // Local storage is only an immediate-display fallback.
  }
}

function recentPublicItems() {
  try {
    const items = JSON.parse(window.localStorage.getItem(PUBLIC_CACHE_KEY) || "null");
    return Array.isArray(items) ? publicItems(items) : [];
  } catch {
    return [];
  }
}

function mergePublicItems(remoteItems, cachedItems) {
  const cachedById = new Map(cachedItems.map((item) => [item.id, item]));
  let usedCache = false;
  const merged = remoteItems.map((remoteItem) => {
    const cachedItem = cachedById.get(remoteItem.id);
    if (cachedItem && itemTimestamp(cachedItem) > itemTimestamp(remoteItem)) {
      usedCache = true;
      return cachedItem;
    }
    return remoteItem;
  });
  if (!usedCache) window.localStorage.removeItem(PUBLIC_CACHE_KEY);
  return publicItems(merged);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = editorToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
}

function showNotice(message, duration = 3200) {
  notice.textContent = message;
  notice.classList.remove("hidden");
  window.setTimeout(() => notice.classList.add("hidden"), duration);
}

function total(key, rows = state.items) {
  return rows.reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function clampPercent(value, maximum) {
  return maximum ? Math.min(100, Math.max(0, Math.round((value / maximum) * 100))) : 0;
}

function statusTone(status = "") {
  if (status.includes("完成") || status.includes("到岗")) return "green";
  if (status.includes("Offer") || status.includes("薪酬")) return "orange";
  if (status === "待更新") return "gray";
  return "blue";
}

function iconSvg(kind) {
  const icons = {
    wind: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10v42M32 24L16 15M32 24l17-10M32 24l-2 19M21 54h22M14 56h36"/><circle cx="32" cy="24" r="4"/></svg>',
    rig: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 54h28M22 54l7-38h8l7 38M25 38h14M27 27h10M20 46h24M29 16l4-8 4 8"/></svg>',
    ship: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 39h45l-8 13H19zM21 39V25h25v14M27 25v-9h12v9M14 55c6 3 11 3 17 0 6 3 11 3 18 0"/></svg>',
    beacon: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M23 54h18M27 54l3-31h4l3 31M25 38h14M26 30h12M32 13v-5M21 17l-5-4M43 17l5-4"/><path d="M19 48c8 4 18 4 26 0"/></svg>',
  };
  return icons[kind] || icons.ship;
}

function syncHeader() {
  const latest = state.items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1);
  latestTime.textContent = formatTime(latest || null);
  overviewTab.classList.toggle("active", state.tab === "overview");
  positionsTab.classList.toggle("active", state.tab === "positions");
  adminButton.classList.toggle("edit-active", state.canEdit);
  adminButton.textContent = state.canEdit ? "编辑模式 · 退出" : "输入密码编辑";
  document.body.classList.toggle("dynamic-mode", state.motion === "dynamic");
  document.body.classList.toggle("meeting-mode", state.motion !== "dynamic");
  meetingButton.classList.toggle("active", state.motion !== "dynamic");
  dynamicButton.classList.toggle("active", state.motion === "dynamic");
}

function metricCard(kind, label, value, note, accent = "blue") {
  return `<article class="metric-card ripple-card ${accent}" tabindex="0">
    <div class="metric-icon">${iconSvg(kind)}</div>
    <div><span>${label}</span><strong>${value}<em>人</em></strong><small>${note}</small></div>
  </article>`;
}

function renderOverview() {
  const planned = total("plannedCount");
  const suitable = total("suitableCount");
  const interviewed = total("interviewCount");
  const offers = total("offerCount");
  const onboarded = total("onboardCount");
  const socialPlanned = total("plannedCount", state.items.filter((item) => item.recruitmentType === "社会招聘"));
  const partnerPlanned = planned - socialPlanned;
  const focusItems = [...state.items]
    .sort((a, b) => Number(b.remainingCount || 0) - Number(a.remainingCount || 0) || Number(b.plannedCount || 0) - Number(a.plannedCount || 0))
    .slice(0, 6);

  content.innerHTML = `
    <section class="overview-grid">
      <article class="overview-summary">
        <div class="section-kicker">RECRUITMENT OVERVIEW</div>
        <h1>招聘进度总览</h1>
        <p class="overview-lead">会议模式突出核心数字，现场一眼看清计划、储备、面试与Offer转化。</p>
        <div class="metrics">
          ${metricCard("wind", "计划补充", planned, `社会招聘 ${socialPlanned} · 协力人员 ${partnerPlanned}`, "orange")}
          ${metricCard("rig", "合适人员", suitable, `人才储备率 ${clampPercent(suitable, planned)}%`)}
          ${metricCard("ship", "已面试", interviewed, `面试推进率 ${clampPercent(interviewed, planned)}%`)}
          ${metricCard("beacon", "已发Offer", offers, `到岗 ${onboarded} 人`, "orange")}
        </div>
      </article>

      <article class="vessel-card ripple-card">
        <div class="vessel-copy"><span>OFFSHORE ENGINEERING</span><strong>梦想号</strong><small>深海装备 · 向新而行</small></div>
        <img src="./assets/meng-xiang-hero.webp?v=20260826b" alt="宏华海洋梦想号海工船" />
        <div class="waterline" aria-hidden="true"><i></i><i></i><i></i></div>
      </article>
    </section>

    <section class="flow-panel ripple-card">
      <div class="panel-heading"><div><span>FLOW</span><h2>招聘流程进度</h2></div><b>当前重点：推动 Offer 转化到岗</b></div>
      <div class="flow-track">
        <div class="flow-ribbon" aria-hidden="true"></div>
        ${stages.map(([key, label], index) => {
          const value = total(key);
          return `<article class="flow-node ${index === 2 ? "focus" : ""}" tabindex="0" aria-label="${label} ${value} 人">
            <span>0${index + 1}</span><strong>${value}</strong><small>${label}</small><em>${clampPercent(value, planned)}%</em>
          </article>`;
        }).join("")}
      </div>
    </section>

    <section class="priority-panel">
      <div class="panel-heading"><div><span>POSITION FOCUS</span><h2>重点岗位推进</h2></div><button id="view-all-positions" type="button">查看全部岗位 →</button></div>
      <div class="priority-grid">
        ${focusItems.map((item) => `<button class="priority-item ripple-card" data-position-id="${item.id}" type="button">
          <span class="priority-rank">${String(item.id).padStart(2, "0")}</span>
          <div><small>${escapeHtml(item.department)} · ${escapeHtml(item.detail)}</small><strong>${escapeHtml(item.position)}</strong></div>
          <mark class="${statusTone(item.currentProgress)}">${escapeHtml(item.currentProgress)}</mark>
          <b><em>${item.remainingCount}</em> 人缺口</b>
        </button>`).join("")}
      </div>
    </section>`;

  document.querySelector("#view-all-positions").addEventListener("click", () => {
    state.tab = "positions";
    render();
  });
  document.querySelectorAll("[data-position-id]").forEach((button) => button.addEventListener("click", () => {
    const item = state.items.find((row) => row.id === Number(button.dataset.positionId));
    state.tab = "positions";
    state.query = item?.position || "";
    render();
  }));
  bindRippleCards();
}

function filteredItems() {
  return state.items.filter((item) =>
    (state.department === "全部部门" || item.department === state.department)
    && (state.recruitmentType === "全部方式" || item.recruitmentType === state.recruitmentType)
    && (state.progress === "全部进展" || item.currentProgress === state.progress)
    && `${item.department}${item.position}${item.detail}`.toLowerCase().includes(state.query.trim().toLowerCase()),
  );
}

function stageRail(item) {
  const railStages = [["plannedCount", "计划"], ...stages];
  return `<div class="stage-rail">${railStages.map(([key, label], index) => {
    const active = Number(item[key] || 0) > 0;
    return `<div class="stage-step ${active ? "active" : ""}"><span>${item[key] || 0}</span><small>${label}</small>${index < railStages.length - 1 ? "<i></i>" : ""}</div>`;
  }).join("")}</div>`;
}

function renderPositions(focusSearch = false, cursor = null) {
  const departments = ["全部部门", ...new Set(state.items.map((item) => item.department))];
  const progressValues = ["全部进展", ...new Set(state.items.map((item) => item.currentProgress))];
  const filtered = filteredItems();

  content.innerHTML = `
    <section class="positions-head">
      <div><span>POSITION PROGRESS</span><h1>岗位进度</h1><p>按岗位查看招聘链路；${state.canEdit ? "当前已进入编辑模式，可直接更新数据。" : "公开视图隐藏人员姓名，数据只读。"}</p></div>
      <div class="records"><strong>${filtered.length}</strong><span>条岗位记录</span></div>
    </section>
    <section class="filter-bar">
      <label class="search-field"><span aria-hidden="true">⌕</span><input id="search-input" placeholder="搜索岗位、方向或部门" value="${escapeHtml(state.query)}" /></label>
      <select id="department-select" aria-label="筛选部门">${departments.map((name) => `<option${name === state.department ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>
      <select id="type-select" aria-label="筛选补充方式"><option${state.recruitmentType === "全部方式" ? " selected" : ""}>全部方式</option><option${state.recruitmentType === "社会招聘" ? " selected" : ""}>社会招聘</option><option${state.recruitmentType === "协力人员" ? " selected" : ""}>协力人员</option></select>
      <select id="progress-select" aria-label="筛选进展">${progressValues.map((name) => `<option${name === state.progress ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>
      <span class="privacy-badge">${state.canEdit ? "● 可编辑" : "🔒 公开只读"}</span>
    </section>
    <section class="position-grid">
      ${filtered.length ? filtered.map((item) => `<article class="position-card ripple-card" data-card-id="${item.id}">
        <div class="position-card-top">
          <div class="position-symbol">${iconSvg(item.position.includes("船") ? "ship" : item.department.includes("技术") ? "wind" : item.department.includes("安全") ? "beacon" : "rig")}</div>
          <div class="position-title"><span>${escapeHtml(item.department)} · ${escapeHtml(item.recruitmentType)}</span><h2>${escapeHtml(item.position)}</h2><p>${escapeHtml(item.detail)}</p></div>
          <mark class="${statusTone(item.currentProgress)}">${escapeHtml(item.currentProgress)}</mark>
        </div>
        ${stageRail(item)}
        <div class="position-foot">
          <div class="gap-block"><span>剩余缺口</span><strong>${item.remainingCount}<em>人</em></strong></div>
          <div class="position-meta"><span>更新时间 ${formatTime(item.updatedAt)}</span>${state.canEdit ? `<span class="candidate-line">人员：${escapeHtml(item.candidateNames || "尚未填写")}</span>` : ""}</div>
          ${state.canEdit ? `<button class="edit-button" data-edit-id="${item.id}" type="button">更新数据</button>` : ""}
        </div>
      </article>`).join("") : '<div class="empty-state">没有符合当前筛选条件的岗位</div>'}
    </section>`;

  const searchInput = document.querySelector("#search-input");
  searchInput.addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    state.query = event.target.value;
    renderPositions(true, position);
  });
  document.querySelector("#department-select").addEventListener("change", (event) => { state.department = event.target.value; renderPositions(); });
  document.querySelector("#type-select").addEventListener("change", (event) => { state.recruitmentType = event.target.value; renderPositions(); });
  document.querySelector("#progress-select").addEventListener("change", (event) => { state.progress = event.target.value; renderPositions(); });
  document.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => openEditor(Number(button.dataset.editId))));
  bindRippleCards();
  if (focusSearch) {
    searchInput.focus();
    if (cursor !== null) searchInput.setSelectionRange(cursor, cursor);
  }
}

function bindRippleCards() {
  document.querySelectorAll(".ripple-card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty("--pointer-x", `${event.clientX - box.left}px`);
      card.style.setProperty("--pointer-y", `${event.clientY - box.top}px`);
    });
  });
}

function render() {
  syncHeader();
  if (state.loading) {
    content.innerHTML = '<div class="loading"><i></i><span>正在读取招聘进度…</span></div>';
    return;
  }
  if (state.error) {
    content.innerHTML = `<div class="state-card"><b>数据暂时无法加载</b><span>${escapeHtml(state.error)}</span><button id="retry-button" type="button">重新加载</button></div>`;
    document.querySelector("#retry-button").addEventListener("click", load);
    return;
  }
  if (state.tab === "overview") renderOverview(); else renderPositions();
}

async function readData() {
  const token = editorToken();
  if (token) {
    try {
      const response = await api("/api/recruitment");
      const data = await response.json();
      if (!response.ok || !data.items) throw new Error(data.error || "读取失败");
      return data;
    } catch {
      window.sessionStorage.removeItem(TOKEN_KEY);
      showNotice("编辑后台暂时无法连接，已切换为公开只读模式", 4500);
    }
  }
  const response = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.items) throw new Error(data.error || "读取失败");
  return { ...data, items: mergePublicItems(data.items, recentPublicItems()), canEdit: false };
}

async function load() {
  state.loading = state.items.length === 0;
  state.error = "";
  render();
  try {
    const data = await readData();
    state.items = data.items;
    state.canEdit = Boolean(data.canEdit);
    if (editorToken() && !state.canEdit) window.sessionStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "读取失败";
  } finally {
    state.loading = false;
    render();
  }
}

function closeOverlay() {
  overlayRoot.innerHTML = "";
}

function openLogin() {
  overlayRoot.innerHTML = `<div class="backdrop"><form class="login-modal"><button type="button" class="close" aria-label="关闭">×</button><div class="login-icon">⌁</div><small>SECURE EDITING</small><h2>进入编辑模式</h2><p>验证后可更新岗位计划、各阶段人数和人员姓名。</p><label><span>编辑密码</span><input name="password" type="password" autofocus autocomplete="current-password" placeholder="请输入密码" /></label><div id="login-error" class="login-error hidden"></div><button class="login-submit">确认进入</button><em>登录状态保留 8 小时，关闭浏览器后自动退出。</em></form></div>`;
  const backdrop = overlayRoot.querySelector(".backdrop");
  const form = overlayRoot.querySelector("form");
  const input = overlayRoot.querySelector("input");
  overlayRoot.querySelector(".close").addEventListener("click", closeOverlay);
  backdrop.addEventListener("mousedown", (event) => event.target === backdrop && closeOverlay());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector(".login-submit");
    const errorBox = form.querySelector("#login-error");
    button.disabled = true;
    button.textContent = "正在验证…";
    errorBox.classList.add("hidden");
    try {
      const response = await fetch(`${API_BASE}/api/editor-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input.value }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || "登录失败");
      window.sessionStorage.setItem(TOKEN_KEY, data.token);
      closeOverlay();
      await load();
      state.tab = "positions";
      render();
      showNotice("已进入编辑模式，可直接更新岗位数据");
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : "登录失败";
      errorBox.classList.remove("hidden");
      button.disabled = false;
      button.textContent = "确认进入";
    }
  });
  window.setTimeout(() => input.focus(), 0);
}

function openEditor(id) {
  const item = state.items.find((current) => current.id === id);
  if (!item || !state.canEdit) return;
  overlayRoot.innerHTML = `<div class="backdrop"><form class="edit-modal"><button type="button" class="close" aria-label="关闭">×</button><small>${escapeHtml(item.department)} · ${escapeHtml(item.recruitmentType)}</small><h2>${escapeHtml(item.position)}</h2><p>${escapeHtml(item.detail)}｜填写最新招聘进度</p><div class="fields"><label class="planned-field"><span>计划人数</span><input name="plannedCount" type="number" min="0" value="${item.plannedCount}" required /></label>${stages.map(([key, label]) => `<label><span>${label}</span><input name="${key}" type="number" min="0" value="${item[key]}" required /></label>`).join("")}</div><label class="names"><span>具体人员姓名</span><textarea name="candidateNames" rows="3" placeholder="多人可用顿号或逗号分隔">${escapeHtml(item.candidateNames || "")}</textarea></label><div class="hint">剩余缺口和当前进度由系统自动计算，保存后自动生成更新时间。</div><div class="actions"><button class="cancel" type="button">取消</button><button class="save">保存更新</button></div></form></div>`;
  const backdrop = overlayRoot.querySelector(".backdrop");
  const form = overlayRoot.querySelector("form");
  overlayRoot.querySelector(".close").addEventListener("click", closeOverlay);
  form.querySelector(".cancel").addEventListener("click", closeOverlay);
  backdrop.addEventListener("mousedown", (event) => event.target === backdrop && closeOverlay());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector(".save");
    saveButton.disabled = true;
    saveButton.textContent = "正在保存…";
    const values = new FormData(form);
    const body = {
      id: item.id,
      plannedCount: Number(values.get("plannedCount")),
      candidateNames: String(values.get("candidateNames") || ""),
      ...Object.fromEntries(stages.map(([key]) => [key, Number(values.get(key))])),
    };
    try {
      const response = await api("/api/recruitment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.item) throw new Error(data.error || "保存失败");
      state.items = state.items.map((current) => current.id === data.item.id ? data.item : current);
      cachePublicItems(state.items);
      closeOverlay();
      render();
      showNotice("岗位进度已保存；公网数据约 5 分钟内同步", 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      showNotice(message, 4000);
      if (message.includes("会话已失效")) {
        window.sessionStorage.removeItem(TOKEN_KEY);
        state.canEdit = false;
        closeOverlay();
        render();
        openLogin();
      } else {
        saveButton.disabled = false;
        saveButton.textContent = "保存更新";
      }
    }
  });
}

function setMotion(mode) {
  state.motion = mode;
  window.localStorage.setItem(MOTION_KEY, mode);
  syncHeader();
}

overviewTab.addEventListener("click", () => { state.tab = "overview"; state.query = ""; render(); });
positionsTab.addEventListener("click", () => { state.tab = "positions"; render(); });
meetingButton.addEventListener("click", () => setMotion("meeting"));
dynamicButton.addEventListener("click", () => setMotion("dynamic"));
document.querySelector("#refresh-button").addEventListener("click", load);
adminButton.addEventListener("click", async () => {
  if (state.canEdit) {
    window.sessionStorage.removeItem(TOKEN_KEY);
    state.canEdit = false;
    state.items = publicItems(state.items);
    cachePublicItems(state.items);
    render();
    showNotice("已退出编辑模式");
  } else {
    openLogin();
  }
});

void load();
window.setInterval(() => void load(), 60000);
