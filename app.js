const API_BASE = "https://honghua-recruitment-2026.zhangxl9510.chatgpt.site";
const TOKEN_KEY = "hh_recruitment_editor_token";

const stages = [
  ["suitableCount", "合适人选"],
  ["interviewCount", "已面试/确认"],
  ["salaryCount", "薪酬谈判"],
  ["offerCount", "已发Offer"],
  ["onboardCount", "已到岗"],
];

const state = {
  items: [],
  tab: "board",
  canEdit: false,
  department: "全部部门",
  recruitmentType: "全部方式",
  query: "",
  loading: true,
  error: "",
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
const boardTab = document.querySelector("#board-tab");
const tableTab = document.querySelector("#table-tab");
const adminButton = document.querySelector("#admin-button");

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

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = editorToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
}

function showNotice(message, duration = 3000) {
  notice.textContent = message;
  notice.classList.remove("hidden");
  window.setTimeout(() => notice.classList.add("hidden"), duration);
}

function total(key, rows = state.items) {
  return rows.reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function statusTone(status) {
  if (status.includes("完成") || status.includes("到岗")) return "green";
  if (status.includes("Offer") || status.includes("薪酬")) return "purple";
  if (status === "待更新") return "gray";
  return "blue";
}

function syncHeader() {
  const latest = state.items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1);
  latestTime.textContent = formatTime(latest || null);
  boardTab.classList.toggle("active", state.tab === "board");
  tableTab.classList.toggle("active", state.tab === "table");
  adminButton.className = `admin-login${state.canEdit ? " edit-active" : ""}`;
  adminButton.textContent = state.canEdit ? "✓ 编辑模式 · 退出" : "输入密码编辑";
}

function renderBoard() {
  const planned = total("plannedCount");
  const offers = total("offerCount");
  const onboarded = total("onboardCount");
  const remaining = total("remainingCount");
  const socialPlanned = state.items.filter((item) => item.recruitmentType === "社会招聘").reduce((sum, item) => sum + item.plannedCount, 0);
  const partnerPlanned = state.items.filter((item) => item.recruitmentType === "协力人员").reduce((sum, item) => sum + item.plannedCount, 0);
  const departmentRows = [...new Set(state.items.map((item) => item.department))]
    .map((name) => ({
      name,
      planned: total("plannedCount", state.items.filter((item) => item.department === name)),
      offers: total("offerCount", state.items.filter((item) => item.department === name)),
      onboarded: total("onboardCount", state.items.filter((item) => item.department === name)),
    }))
    .sort((a, b) => b.planned - a.planned);
  const maxDepartmentPlan = Math.max(...departmentRows.map((row) => row.planned), 1);

  content.innerHTML = `
    <section class="kpis">
      <article class="dark"><span>计划补充</span><b>${planned}</b><small>社会招聘${socialPlanned} · 协力人员${partnerPlanned}</small></article>
      <article><span>已有合适人选</span><b>${total("suitableCount")}</b><small>人</small></article>
      <article><span>已发Offer</span><b>${offers}</b><small>完成率 ${planned ? Math.round(offers / planned * 100) : 0}%</small></article>
      <article><span>已到岗</span><b>${onboarded}</b><small>人</small></article>
      <article class="warn"><span>剩余缺口</span><b>${remaining}</b><small>按已发Offer计算</small></article>
    </section>
    <section class="panel">
      <div class="panelhead"><h2>招聘进度</h2><span>各阶段累计人数</span></div>
      <div class="funnel">${stages.map(([key, label], index) => {
        const value = total(key);
        const width = planned ? Math.min(100, value / planned * 100) : 0;
        return `<article><small>0${index + 1}</small><span>${label}</span><b>${value}<em>人</em></b><div><i style="width:${width}%"></i></div></article>`;
      }).join("")}</div>
    </section>
    <section class="grid">
      <article class="panel">
        <div class="panelhead"><h2>各部门招聘进度</h2><span>计划 / Offer / 到岗</span></div>
        <div class="bars">${departmentRows.map((row) => `<div><span>${escapeHtml(row.name)}</span><div><i class="p" style="width:${row.planned / maxDepartmentPlan * 100}%"></i><i class="o" style="width:${row.offers / maxDepartmentPlan * 100}%"></i><i class="a" style="width:${row.onboarded / maxDepartmentPlan * 100}%"></i></div><b>${row.planned}</b></div>`).join("")}</div>
      </article>
      <article class="panel">
        <div class="panelhead"><h2>补充方式</h2><span>计划构成</span></div>
        <div class="split">
          <div class="donut" style="background:radial-gradient(circle,#fff 0 53%,transparent 54%),conic-gradient(#75a6d2 0 ${planned ? socialPlanned / planned * 100 : 0}%,#69b9ae 0 100%)"><b>${planned}</b><small>计划人数</small></div>
          <div><p><i class="social"></i><b>社会招聘</b><span>${socialPlanned}人 · ${planned ? Math.round(socialPlanned / planned * 100) : 0}%</span></p><p><i class="partner"></i><b>协力人员</b><span>${partnerPlanned}人 · ${planned ? Math.round(partnerPlanned / planned * 100) : 0}%</span></p></div>
        </div>
      </article>
    </section>`;
}

function filteredItems() {
  return state.items.filter((item) =>
    (state.department === "全部部门" || item.department === state.department)
    && (state.recruitmentType === "全部方式" || item.recruitmentType === state.recruitmentType)
    && `${item.department}${item.position}${item.detail}`.includes(state.query),
  );
}

function renderTable(focusSearch = false, cursor = null) {
  const departments = ["全部部门", ...new Set(state.items.map((item) => item.department))];
  const filtered = filteredItems();
  content.innerHTML = `
    <section class="panel tablepanel">
      <div class="toolbar"><div><h2>招聘进度表</h2><span>共 ${filtered.length} 条记录</span></div><div>
        <input id="search-input" placeholder="搜索岗位或方向" value="${escapeHtml(state.query)}" />
        <select id="department-select">${departments.map((name) => `<option${name === state.department ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>
        <select id="type-select"><option${state.recruitmentType === "全部方式" ? " selected" : ""}>全部方式</option><option${state.recruitmentType === "社会招聘" ? " selected" : ""}>社会招聘</option><option${state.recruitmentType === "协力人员" ? " selected" : ""}>协力人员</option></select>
      </div></div>
      <div class="privacy">🔒 ${state.canEdit ? "编辑模式：点击每行左侧“更新”按钮填写计划、进度和具体人员姓名" : "公开视图：具体人员姓名已隐藏，数据只读"}</div>
      <div class="scroll"><table><thead><tr><th>序号</th><th>部门/岗位</th><th>细分方向/批次</th><th>补充方式</th>${state.canEdit ? "<th>更新</th>" : ""}<th>计划</th>${stages.map(([, label]) => `<th>${label}</th>`).join("")}<th>剩余缺口</th><th>当前进度</th><th>具体人员姓名</th><th>最后更新时间</th></tr></thead>
      <tbody>${filtered.map((item) => `<tr><td>${String(item.id).padStart(2, "0")}</td><td><b>${escapeHtml(item.position)}</b><small>${escapeHtml(item.department)}</small></td><td>${escapeHtml(item.detail)}</td><td><label class="${item.recruitmentType === "协力人员" ? "partner" : ""}">${escapeHtml(item.recruitmentType)}</label></td>${state.canEdit ? `<td><button class="edit" data-edit-id="${item.id}">更新</button></td>` : ""}<td><b>${item.plannedCount}</b></td>${stages.map(([key]) => `<td>${item[key]}</td>`).join("")}<td class="gap">${item.remainingCount}</td><td><mark class="${statusTone(item.currentProgress)}">${escapeHtml(item.currentProgress)}</mark></td><td>${item.candidateNames === null ? "已隐藏" : escapeHtml(item.candidateNames || "—")}</td><td>${formatTime(item.updatedAt)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;

  const searchInput = document.querySelector("#search-input");
  searchInput.addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    state.query = event.target.value;
    renderTable(true, position);
  });
  document.querySelector("#department-select").addEventListener("change", (event) => {
    state.department = event.target.value;
    renderTable();
  });
  document.querySelector("#type-select").addEventListener("change", (event) => {
    state.recruitmentType = event.target.value;
    renderTable();
  });
  document.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => openEditor(Number(button.dataset.editId))));
  if (focusSearch) {
    searchInput.focus();
    if (cursor !== null) searchInput.setSelectionRange(cursor, cursor);
  }
}

function render() {
  syncHeader();
  if (state.loading) {
    content.innerHTML = '<div class="loading">正在读取招聘进度…</div>';
    return;
  }
  if (state.error) {
    content.innerHTML = `<div class="state-card"><b>数据暂时无法加载</b><span>${escapeHtml(state.error)}</span><button id="retry-button" type="button">重新加载</button></div>`;
    document.querySelector("#retry-button").addEventListener("click", load);
    return;
  }
  if (state.tab === "board") renderBoard(); else renderTable();
}

async function load() {
  state.loading = state.items.length === 0;
  state.error = "";
  render();
  try {
    const response = await api("/api/recruitment");
    const data = await response.json();
    if (!response.ok || !data.items) throw new Error(data.error || "读取失败");
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
  overlayRoot.innerHTML = `<div class="backdrop"><form class="login-modal"><button type="button" class="close">×</button><div class="login-icon">✦</div><h2>进入编辑模式</h2><p>请输入招聘进度表编辑密码</p><label><span>编辑密码</span><input name="password" type="password" inputmode="numeric" autofocus autocomplete="current-password" placeholder="请输入密码" /></label><div id="login-error" class="login-error hidden"></div><button class="login-submit">确认进入</button><small>登录状态保留8小时，关闭浏览器后自动退出。</small></form></div>`;
  const backdrop = overlayRoot.querySelector(".backdrop");
  const form = overlayRoot.querySelector("form");
  const close = overlayRoot.querySelector(".close");
  const input = overlayRoot.querySelector("input");
  close.addEventListener("click", closeOverlay);
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
      showNotice("已进入编辑模式，8小时内无需重复输入密码");
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
  overlayRoot.innerHTML = `<div class="backdrop"><form class="modal"><button type="button" class="close">×</button><small>${escapeHtml(item.department)}</small><h2>${escapeHtml(item.position)} · ${escapeHtml(item.detail)}</h2><p>请填写本岗位最新招聘进度</p><div class="fields"><label class="planned-field"><span>计划人数</span><input name="plannedCount" type="number" min="0" value="${item.plannedCount}" required /></label>${stages.map(([key, label]) => `<label><span>${label}</span><input name="${key}" type="number" min="0" value="${item[key]}" required /></label>`).join("")}</div><label class="names"><span>具体人员姓名</span><textarea name="candidateNames" rows="3" placeholder="多人可用顿号或逗号分隔">${escapeHtml(item.candidateNames || "")}</textarea></label><div class="hint">剩余缺口和当前进度由系统自动计算；保存后自动生成最后更新时间。</div><div class="actions"><button class="cancel" type="button">取消</button><button class="save">保存更新</button></div></form></div>`;
  const backdrop = overlayRoot.querySelector(".backdrop");
  const form = overlayRoot.querySelector("form");
  const close = overlayRoot.querySelector(".close");
  close.addEventListener("click", closeOverlay);
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
      closeOverlay();
      render();
      showNotice("进度已保存，更新时间已自动生成");
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

boardTab.addEventListener("click", () => { state.tab = "board"; render(); });
tableTab.addEventListener("click", () => { state.tab = "table"; render(); });
document.querySelector("#refresh-button").addEventListener("click", load);
adminButton.addEventListener("click", async () => {
  if (state.canEdit) {
    window.sessionStorage.removeItem(TOKEN_KEY);
    state.canEdit = false;
    await load();
    showNotice("已退出编辑模式");
  } else {
    openLogin();
  }
});

void load();
window.setInterval(() => void load(), 60000);
