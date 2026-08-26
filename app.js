const API_BASE = "https://api.zhangxiaolei.top";
const SNAPSHOT_URL = "./data.json";
const TOKEN_KEY = "hh_recruitment_editor_token";
const PUBLIC_CACHE_KEY = "hh_recruitment_recent_public_data";

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
}

function metricCard(kind, label, value, note, accent = "blue") {
  return `<article class="metric-card ripple-card ${accent}" tabindex="0">
    <div class="metric-icon">${iconSvg(kind)}</div>
    <div class="metric-copy"><span>${label}</span><strong>${value}<em>人</em></strong>${note ? `<small>${note}</small>` : ""}</div>
    <i class="metric-tide" aria-hidden="true"></i>
  </article>`;
}

function progressFromCounts(row) {
  if (row.onboardCount > 0) return "已到岗";
  if (row.offerCount > 0) return "已发Offer";
  if (row.salaryCount > 0) return "薪酬谈判";
  if (row.interviewCount > 0) return "已面试/确认";
  if (row.suitableCount > 0) return "已有合适人选";
  return "待更新";
}

function renderOverview() {
  const planned = total("plannedCount");
  const suitable = total("suitableCount");
  const interviewed = total("interviewCount");
  const offers = total("offerCount");
  const socialPlanned = total("plannedCount", state.items.filter((item) => item.recruitmentType === "社会招聘"));
  const partnerPlanned = planned - socialPlanned;
  const socialItems = state.items.filter((item) => item.recruitmentType === "社会招聘");
  const departmentFocus = [...new Set(socialItems.map((item) => item.department))]
    .map((department) => {
      const rows = socialItems.filter((item) => item.department === department);
      const summary = {
        department,
        itemCount: rows.length,
        plannedCount: total("plannedCount", rows),
        suitableCount: total("suitableCount", rows),
        interviewCount: total("interviewCount", rows),
        salaryCount: total("salaryCount", rows),
        offerCount: total("offerCount", rows),
        onboardCount: total("onboardCount", rows),
        remainingCount: total("remainingCount", rows),
      };
      return { ...summary, currentProgress: progressFromCounts(summary) };
    })
    .sort((a, b) => b.plannedCount - a.plannedCount || b.suitableCount - a.suitableCount)
    .slice(0, 6);

  content.innerHTML = `
    <section class="hero-deck">
      <div class="metrics">
          ${metricCard("wind", "计划补充", planned, `社会招聘 ${socialPlanned} · 协力人员 ${partnerPlanned}`, "orange")}
          ${metricCard("rig", "合适人员", suitable, "")}
          ${metricCard("ship", "已面试", interviewed, "")}
          ${metricCard("beacon", "已发Offer", offers, "", "orange")}
      </div>

      <article class="vessel-card ripple-card">
        <div class="vessel-copy"><span>OFFSHORE ENGINEERING</span><strong>梦想号</strong><small>逐浪深蓝 · 向新而行</small></div>
        <div class="vessel-mountains" aria-hidden="true"><i></i><i></i><i></i></div>
        <img src="./assets/meng-xiang-hero-hd.webp?v=20260826" alt="宏华海洋梦想号海工船" />
        <div class="bow-splash" aria-hidden="true"><b></b><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="ship-wake" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="waterline" aria-hidden="true"><i></i><i></i><i></i></div>
      </article>
    </section>

    <section class="flow-panel ripple-card">
      <div class="panel-heading"><div><span>OCEAN FLOW</span><h2>招聘转化链路</h2></div><b>相邻阶段转化率 · 对应人数</b></div>
      <div class="flow-track">
        <div class="flow-ribbon" aria-hidden="true"></div>
        <div class="flow-spark spark-one" aria-hidden="true"></div><div class="flow-spark spark-two" aria-hidden="true"></div>
        ${stages.map(([key, label], index) => {
          const value = total(key);
          const previous = index === 0 ? planned : total(stages[index - 1][0]);
          const conversion = clampPercent(value, previous);
          return `<article class="flow-node ${index === 2 ? "focus" : ""}" tabindex="0" aria-label="${label} ${value} 人，阶段转化率 ${conversion}%">
            <span>0${index + 1}</span><strong>${conversion}%</strong><small>${label}</small><em>${value}人</em>
          </article>`;
        }).join("")}
      </div>
    </section>

    <section class="priority-panel">
      <div class="panel-heading"><div><span>SOCIAL RECRUITMENT</span><h2>岗位进度</h2></div><button id="view-all-positions" type="button">查看全部岗位 →</button></div>
      <div class="priority-grid">
        ${departmentFocus.map((item) => `<button class="overview-position-card ripple-card" data-department="${escapeHtml(item.department)}" type="button">
          <span class="position-emblem">${iconSvg(item.department.includes("安全") ? "beacon" : item.department.includes("技术") ? "wind" : item.department.includes("项目") ? "ship" : "rig")}</span>
          <div class="overview-position-title"><small>社会招聘 · ${item.itemCount}个岗位</small><strong>${escapeHtml(item.department)}</strong></div>
          <mark class="${statusTone(item.currentProgress)}">${escapeHtml(item.currentProgress)}</mark>
          <div class="overview-position-stats"><span>计划 <b>${item.plannedCount}</b></span><span>合适 <b>${item.suitableCount}</b></span><span>缺口 <b>${item.remainingCount}</b></span></div>
          ${stageRail(item)}
        </button>`).join("")}
      </div>
    </section>`;

  document.querySelector("#view-all-positions").addEventListener("click", () => {
    state.tab = "positions";
    state.department = "全部部门";
    state.recruitmentType = "全部方式";
    state.query = "";
    render();
  });
  document.querySelectorAll("[data-department]").forEach((button) => button.addEventListener("click", () => {
    state.tab = "positions";
    state.department = button.dataset.department;
    state.recruitmentType = "社会招聘";
    state.query = "";
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
    <section class="positions-table-panel ripple-card">
      <div class="table-scroll">
        <table class="recruitment-table">
          <thead><tr><th>序号</th><th class="position-column">部门 / 岗位</th><th>补充方式</th><th>计划</th><th>合适人选</th><th>已面试</th><th>薪酬谈判</th><th>已发Offer</th><th>已到岗</th><th>剩余缺口</th><th>当前进度</th><th>最后更新</th>${state.canEdit ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${filtered.length ? filtered.map((item, index) => `<tr>
            <td class="row-number">${String(index + 1).padStart(2, "0")}</td>
            <td class="position-cell"><strong>${escapeHtml(item.position)}</strong><span>${escapeHtml(item.department)} · ${escapeHtml(item.detail)}</span>${state.canEdit ? `<small>人员：${escapeHtml(item.candidateNames || "尚未填写")}</small>` : ""}</td>
            <td><label class="type-chip ${item.recruitmentType === "协力人员" ? "partner" : "social"}">${escapeHtml(item.recruitmentType)}</label></td>
            <td class="number planned">${item.plannedCount}</td>
            <td class="number">${item.suitableCount}</td>
            <td class="number">${item.interviewCount}</td>
            <td class="number">${item.salaryCount}</td>
            <td class="number offer">${item.offerCount}</td>
            <td class="number onboard">${item.onboardCount}</td>
            <td class="number gap-number">${item.remainingCount}</td>
            <td><mark class="${statusTone(item.currentProgress)}">${escapeHtml(item.currentProgress)}</mark></td>
            <td class="time-cell">${formatTime(item.updatedAt)}</td>
            ${state.canEdit ? `<td><button class="edit-button" data-edit-id="${item.id}" type="button">更新</button></td>` : ""}
          </tr>`).join("") : '<tr><td class="empty-cell" colspan="13">没有符合当前筛选条件的岗位</td></tr>'}</tbody>
        </table>
      </div>
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
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      card.style.setProperty("--pointer-x", `${x}px`);
      card.style.setProperty("--pointer-y", `${y}px`);
      card.style.setProperty("--tilt-x", `${((y / box.height) - 0.5) * -2.4}deg`);
      card.style.setProperty("--tilt-y", `${((x / box.width) - 0.5) * 2.4}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    });
  });
}

function initOceanEffects() {
  const canvas = document.querySelector("#ocean-effects");
  const context = canvas?.getContext("2d");
  if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let lastSpawn = 0;
  const particles = [];

  const resize = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const addDrop = (x, y, burst = false) => {
    const count = burst ? 10 : 2;
    for (let index = 0; index < count; index += 1) {
      const angle = burst ? Math.random() * Math.PI * 2 : Math.PI + (Math.random() - 0.5) * 1.1;
      const speed = burst ? 1.2 + Math.random() * 2.8 : 0.35 + Math.random();
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (burst ? 0.8 : 0),
        radius: 1.2 + Math.random() * 2.2,
        alpha: 0.5 + Math.random() * 0.35,
        life: 1,
      });
    }
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    particles.forEach((drop) => {
      drop.x += drop.vx;
      drop.y += drop.vy;
      drop.vy += 0.025;
      drop.life -= 0.018;
      context.beginPath();
      context.arc(drop.x, drop.y, Math.max(0.2, drop.radius * drop.life), 0, Math.PI * 2);
      context.fillStyle = `rgba(45, 192, 229, ${Math.max(0, drop.alpha * drop.life)})`;
      context.fill();
    });
    for (let index = particles.length - 1; index >= 0; index -= 1) if (particles[index].life <= 0) particles.splice(index, 1);
    window.requestAnimationFrame(draw);
  };

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", (event) => {
    if (!event.target.closest("main") || performance.now() - lastSpawn < 48) return;
    lastSpawn = performance.now();
    addDrop(event.clientX, event.clientY);
  }, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, .ripple-card")) addDrop(event.clientX, event.clientY, true);
  }, { passive: true });
  resize();
  draw();
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

overviewTab.addEventListener("click", () => { state.tab = "overview"; state.query = ""; render(); });
positionsTab.addEventListener("click", () => {
  state.tab = "positions";
  state.department = "全部部门";
  state.recruitmentType = "全部方式";
  state.progress = "全部进展";
  state.query = "";
  render();
});
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

initOceanEffects();
void load();
window.setInterval(() => void load(), 60000);
