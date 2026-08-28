const API_BASE = "https://api.zhangxiaolei.top";
const SNAPSHOT_URL = "./data.json";
const TOKEN_KEY = "hh_recruitment_editor_token";
const PUBLIC_CACHE_KEY = "hh_recruitment_recent_public_data";

const INTERNAL_COORDINATION = Object.freeze({
  plannedCount: 20,
  confirmedCount: 11,
  pendingCount: 9,
  onboardCount: 0,
});

const MOTION_PROFILES = {
  full: { fps: 45, dpr: 1.5, currents: 5, motes: 36, tracers: 8, trail: 12, drops: 2, burst: 10 },
  balanced: { fps: 30, dpr: 1.2, currents: 4, motes: 24, tracers: 5, trail: 6, drops: 1, burst: 5 },
  lite: { fps: 24, dpr: 1, currents: 3, motes: 12, tracers: 3, trail: 0, drops: 0, burst: 0 },
};

function detectMotionTier() {
  const cores = Number(navigator.hardwareConcurrency || 4);
  const memory = Number(navigator.deviceMemory || 4);
  const dpr = Number(window.devicePixelRatio || 1);
  const saveData = Boolean(navigator.connection?.saveData);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (saveData || reducedMotion || cores <= 4 || memory <= 4 || dpr > 1.75 || window.innerWidth < 820) return "lite";
  if (cores >= 12 && memory >= 8 && dpr <= 1.5) return "full";
  return "balanced";
}

const motionState = { tier: detectMotionTier() };

function setMotionTier(tier) {
  if (!MOTION_PROFILES[tier]) return;
  document.documentElement.classList.remove("performance-full", "performance-balanced", "performance-lite");
  document.documentElement.classList.add(`performance-${tier}`);
  document.documentElement.dataset.motion = tier;
  motionState.tier = tier;
  window.dispatchEvent(new CustomEvent("motiontierchange", { detail: tier }));
}

setMotionTier(motionState.tier);

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

let lastAnimatedTab = "";

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
    coordination: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="24" cy="23" r="8"/><circle cx="43" cy="26" r="6"/><path d="M10 51c1-11 6-17 14-17s13 6 14 17M36 50c1-8 4-13 10-13 5 0 8 4 9 11M43 10v8M39 14h8"/></svg>',
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

function overviewRecruitmentGroup(rows, recruitmentType) {
  const groupRows = rows.filter((item) => item.recruitmentType === recruitmentType);
  if (!groupRows.length) return "";
  const tone = recruitmentType === "协力人员" ? "partner" : "social";
  return `<section class="overview-recruitment-group ${tone} recruitment-summary-only">
    <div class="overview-group-heading"><b>${escapeHtml(recruitmentType)}</b></div>
    <div class="recruitment-big-numbers">
      <span><small>计划</small><strong>${total("plannedCount", groupRows)}</strong></span>
      <span><small>已面试</small><strong>${total("interviewCount", groupRows)}</strong></span>
      <span><small>已发Offer</small><strong>${total("offerCount", groupRows)}</strong></span>
      <span><small>已到岗</small><strong>${total("onboardCount", groupRows)}</strong></span>
    </div>
  </section>`;
}

function renderOverview() {
  const recruitmentPlanned = total("plannedCount");
  const overallPlanned = recruitmentPlanned + INTERNAL_COORDINATION.plannedCount;
  const suitable = total("suitableCount");
  const interviewed = total("interviewCount");
  const offers = total("offerCount");
  const socialRows = state.items.filter((item) => item.recruitmentType === "社会招聘");
  const socialPlanned = total("plannedCount", socialRows);
  const partnerPlanned = recruitmentPlanned - socialPlanned;
  const departmentFocus = [...new Set(state.items.map((item) => item.department))]
    .map((department) => {
      const rows = state.items.filter((item) => item.department === department);
      const summary = {
        department,
        rows,
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
    .sort((a, b) => b.plannedCount - a.plannedCount || b.suitableCount - a.suitableCount);

  const safetyIndex = departmentFocus.findIndex((item) => item.department === "安全保障部");
  const procurementIndex = departmentFocus.findIndex((item) => item.department === "采购储运部");
  if (safetyIndex >= 0 && procurementIndex >= 0) {
    [departmentFocus[safetyIndex], departmentFocus[procurementIndex]] = [departmentFocus[procurementIndex], departmentFocus[safetyIndex]];
  }
  const planningIndex = departmentFocus.findIndex((item) => item.department === "企划部");
  if (planningIndex >= 0) departmentFocus.push(departmentFocus.splice(planningIndex, 1)[0]);

  content.innerHTML = `
    <section class="hero-deck single-vessel">
      <div class="metrics">
          ${metricCard("wind", "计划补充", overallPlanned, `社会招聘 ${socialPlanned} · 内部统筹 ${INTERNAL_COORDINATION.plannedCount} · 协力人员 ${partnerPlanned}`, "orange")}
          ${metricCard("rig", "合适人员", suitable, "")}
          ${metricCard("ship", "已面试", interviewed, "")}
          ${metricCard("beacon", "已发Offer", offers, "", "orange")}
          ${metricCard("coordination", "内部统筹", INTERNAL_COORDINATION.confirmedCount, `计划 ${INTERNAL_COORDINATION.plannedCount} · 待协调 ${INTERNAL_COORDINATION.pendingCount}`, "green")}
      </div>

      <article class="vessel-card vessel-side vessel-right ripple-card">
        <div class="fleet-visual" aria-label="梦想号海工船">
          <figure class="fleet-ship fleet-dream">
            <img src="./assets/dream-ship-cutout-v4.webp?v=20260828" alt="宏华海洋梦想号海工船" fetchpriority="high" decoding="async" />
            <figcaption>梦想号</figcaption>
          </figure>
        </div>
      </article>
    </section>

    <section class="flow-panel ripple-card">
      <div class="panel-heading"><div><span>OCEAN FLOW</span><h2>社会招聘转化链路</h2></div><b>相邻阶段转化率 · 对应人数</b></div>
      <div class="flow-track">
        <div class="flow-ribbon" aria-hidden="true"><i></i><i></i></div>
        <div class="flow-spark spark-one" aria-hidden="true"></div><div class="flow-spark spark-two" aria-hidden="true"></div><div class="flow-spark spark-three" aria-hidden="true"></div>
        ${stages.map(([key, label], index) => {
          const value = total(key, socialRows);
          const previous = index === 0 ? socialPlanned : total(stages[index - 1][0], socialRows);
          const conversion = clampPercent(value, previous);
          return `<article class="flow-node ${index === 2 ? "focus" : ""}" tabindex="0" aria-label="${label} ${value} 人，阶段转化率 ${conversion}%">
            <strong>${conversion}%</strong><small>${label}</small><em>${value}人</em>
          </article>`;
        }).join("")}
      </div>
    </section>

    <section class="priority-panel meeting-progress-panel">
      <div class="panel-heading meeting-progress-heading"><div><span>RECRUITMENT PANORAMA</span><h2>部门招聘进展全景</h2><p>部门汇总看总量｜分类大数看进度</p></div><button id="view-all-positions" type="button">进入数据维护 →</button></div>
      <div class="meeting-department-grid">
        ${departmentFocus.map((item) => `<article class="meeting-department-card">
          <div class="meeting-department-heading">
            <div><small>DEPARTMENT</small><h3>${escapeHtml(item.department)}</h3></div>
            <button class="department-jump" data-department="${escapeHtml(item.department)}" type="button" aria-label="查看${escapeHtml(item.department)}岗位明细">查看明细 →</button>
          </div>
          <div class="meeting-department-summary">
            <span><small>计划</small><b>${item.plannedCount}</b></span>
            <span><small>合适</small><b>${item.suitableCount}</b></span>
            <span><small>面试</small><b>${item.interviewCount}</b></span>
            <span><small>谈薪</small><b>${item.salaryCount}</b></span>
            <span><small>Offer</small><b>${item.offerCount}</b></span>
            <span><small>到岗</small><b>${item.onboardCount}</b></span>
          </div>
          <div class="meeting-recruitment-groups">
            ${overviewRecruitmentGroup(item.rows, "社会招聘")}
            ${overviewRecruitmentGroup(item.rows, "协力人员")}
          </div>
        </article>`).join("")}
        <article class="meeting-department-card internal-coordination-card">
          <div class="meeting-department-heading">
            <div><small>INTERNAL COORDINATION</small><h3>内部统筹</h3></div>
            <span class="internal-plan-badge">计划 ${INTERNAL_COORDINATION.plannedCount} 人</span>
          </div>
          <div class="internal-coordination-numbers">
            <span><small>计划统筹</small><b>${INTERNAL_COORDINATION.plannedCount}</b></span>
            <span><small>已明确</small><b>${INTERNAL_COORDINATION.confirmedCount}</b></span>
            <span><small>待协调</small><b>${INTERNAL_COORDINATION.pendingCount}</b></span>
            <span><small>已到岗</small><b>${INTERNAL_COORDINATION.onboardCount}</b></span>
          </div>
          <div class="internal-progress" aria-label="内部统筹已明确 ${clampPercent(INTERNAL_COORDINATION.confirmedCount, INTERNAL_COORDINATION.plannedCount)}%">
            <div><span>人员明确进度</span><strong>${clampPercent(INTERNAL_COORDINATION.confirmedCount, INTERNAL_COORDINATION.plannedCount)}%</strong></div>
            <i><b style="width:${clampPercent(INTERNAL_COORDINATION.confirmedCount, INTERNAL_COORDINATION.plannedCount)}%"></b></i>
          </div>
          <p class="internal-coordination-note">已明确 ${INTERNAL_COORDINATION.confirmedCount} 人，剩余 ${INTERNAL_COORDINATION.pendingCount} 人持续协调。</p>
        </article>
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
    state.recruitmentType = "全部方式";
    state.query = "";
    render();
  }));
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
  const filteredTotals = {
    plannedCount: total("plannedCount", filtered),
    suitableCount: total("suitableCount", filtered),
    interviewCount: total("interviewCount", filtered),
    salaryCount: total("salaryCount", filtered),
    offerCount: total("offerCount", filtered),
    onboardCount: total("onboardCount", filtered),
    remainingCount: total("remainingCount", filtered),
  };
  const showInternalCoordination = state.department === "全部部门"
    && state.recruitmentType === "全部方式"
    && state.progress === "全部进展"
    && !state.query.trim();

  content.innerHTML = `
    <section class="positions-head">
      <div><span>POSITION PROGRESS</span><h1>岗位进度</h1></div>
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
          <thead><tr><th>序号</th><th class="department-column">部门</th><th class="position-column">岗位</th><th>补充方式</th><th>计划</th><th>合适人选</th><th>已面试</th><th>薪酬谈判</th><th>已发Offer</th><th>已到岗</th><th>剩余缺口</th><th>当前进度</th><th>最后更新</th>${state.canEdit ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${filtered.length ? filtered.map((item, index) => `<tr>
            <td class="row-number">${String(index + 1).padStart(2, "0")}</td>
            <td class="department-cell"><strong>${escapeHtml(item.department)}</strong></td>
            <td class="position-cell"><strong>${escapeHtml(item.position)}</strong><span>${escapeHtml(item.detail)}</span>${state.canEdit ? `<small>人员：${escapeHtml(item.candidateNames || "尚未填写")}</small>` : ""}</td>
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
          </tr>`).join("") : `<tr><td class="empty-cell" colspan="${state.canEdit ? 14 : 13}">没有符合当前筛选条件的岗位</td></tr>`}
          ${showInternalCoordination ? `<tr class="internal-coordination-table-row">
            <td colspan="${state.canEdit ? 14 : 13}">
              <div class="internal-table-summary">
                <div><small>INTERNAL COORDINATION</small><strong>内部统筹</strong><span>单列展示，不纳入岗位筛选合计</span></div>
                <b><small>计划</small><strong>${INTERNAL_COORDINATION.plannedCount}</strong></b>
                <b><small>已明确</small><strong>${INTERNAL_COORDINATION.confirmedCount}</strong></b>
                <b><small>待协调</small><strong>${INTERNAL_COORDINATION.pendingCount}</strong></b>
                <b><small>已到岗</small><strong>${INTERNAL_COORDINATION.onboardCount}</strong></b>
              </div>
            </td>
          </tr>` : ""}
          <tr class="recruitment-total-row">
            <td class="row-number">合计</td>
            <td class="department-cell"><strong>筛选范围</strong></td>
            <td class="position-cell"><strong>当前筛选合计</strong><span>${filtered.length} 条岗位记录</span></td>
            <td><label class="type-chip">—</label></td>
            <td class="number planned">${filteredTotals.plannedCount}</td>
            <td class="number">${filteredTotals.suitableCount}</td>
            <td class="number">${filteredTotals.interviewCount}</td>
            <td class="number">${filteredTotals.salaryCount}</td>
            <td class="number offer">${filteredTotals.offerCount}</td>
            <td class="number onboard">${filteredTotals.onboardCount}</td>
            <td class="number gap-number">${filteredTotals.remainingCount}</td>
            <td>—</td>
            <td class="time-cell">—</td>
            ${state.canEdit ? "<td>—</td>" : ""}
          </tr></tbody>
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
  if (focusSearch) {
    searchInput.focus();
    if (cursor !== null) searchInput.setSelectionRange(cursor, cursor);
  }
}

function bindRippleCards() {
  if (motionState.tier !== "full") return;
  document.querySelectorAll(".ripple-card").forEach((card) => {
    let frame = 0;
    card.addEventListener("pointermove", (event) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        const box = card.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        card.style.setProperty("--pointer-x", `${x}px`);
        card.style.setProperty("--pointer-y", `${y}px`);
        card.style.setProperty("--tilt-x", `${((y / box.height) - 0.5) * -2.4}deg`);
        card.style.setProperty("--tilt-y", `${((x / box.width) - 0.5) * 2.4}deg`);
        frame = 0;
      });
    });
    card.addEventListener("pointerleave", () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    });
  });
}

function initWaterClickRipple() {
  const interactiveWaterAreas = ".hero-deck.single-vessel .metric-card, .flow-panel";

  document.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element?.closest(interactiveWaterAreas)) return;

    const activeEffects = document.querySelectorAll(".water-click-impact");
    if (activeEffects.length >= 5) activeEffects[0].remove();

    const effect = document.createElement("span");
    effect.className = "water-click-impact";
    effect.setAttribute("aria-hidden", "true");
    effect.style.left = `${event.clientX}px`;
    effect.style.top = `${event.clientY}px`;
    effect.innerHTML = '<i class="water-falling-drop"></i><i class="water-impact-glow"></i><i class="water-impact-ring ring-one"></i><i class="water-impact-ring ring-two"></i><i class="water-impact-ring ring-three"></i>';
    document.body.append(effect);
    window.setTimeout(() => effect.remove(), 1050);
  }, { passive: true });
}

function initOceanEffects() {
  const canvas = document.querySelector("#ocean-effects");
  const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
  if (!canvas || !context) return;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let lastSpawn = 0;
  let lastFrame = 0;
  let animationFrame = 0;
  let resizeTimer = 0;
  const particles = [];
  const rings = [];
  const motes = [];
  const tracers = [];
  const pointerTrail = [];
  let currents = [];
  let currentGradients = [];

  const profile = () => MOTION_PROFILES[motionState.tier];

  const resize = () => {
    const settings = profile();
    ratio = Math.min(window.devicePixelRatio || 1, settings.dpr);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    currents = Array.from({ length: settings.currents }, (_, index) => ({
      phase: index * 1.37,
      speed: .00028 + index * .000035,
      amplitude: 8 + index * 2.4,
    }));
    currentGradients = currents.map((_, index) => {
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(35, 171, 216, 0)");
      gradient.addColorStop(.14, `rgba(35, 171, 216, ${.045 + index * .008})`);
      gradient.addColorStop(.48, `rgba(255, 255, 255, ${.07 + index * .008})`);
      gradient.addColorStop(.78, `rgba(33, 185, 220, ${.05 + index * .008})`);
      gradient.addColorStop(1, "rgba(35, 171, 216, 0)");
      return gradient;
    });
    motes.length = 0;
    for (let index = 0; index < settings.motes; index += 1) {
      motes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: .5 + Math.random() * 1.45,
        speed: .08 + Math.random() * .2,
        sway: Math.random() * Math.PI * 2,
        alpha: .08 + Math.random() * .16,
      });
    }
    tracers.length = 0;
    for (let index = 0; index < settings.tracers; index += 1) {
      tracers.push({
        x: Math.random() * width,
        y: height * (.34 + Math.random() * .58),
        length: 54 + Math.random() * 120,
        speed: .32 + Math.random() * .56,
        phase: Math.random() * Math.PI * 2,
        alpha: .07 + Math.random() * .09,
      });
    }
  };

  const addDrop = (x, y, burst = false) => {
    const settings = profile();
    const count = burst ? settings.burst : settings.drops;
    if (!count) return;
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
    const particleLimit = motionState.tier === "full" ? 64 : 30;
    if (particles.length > particleLimit) particles.splice(0, particles.length - particleLimit);
    if (burst) {
      rings.push({ x, y, radius: 8, growth: 1.9, alpha: .5, life: 1 });
      if (motionState.tier === "full") rings.push({ x, y, radius: 15, growth: 2.35, alpha: .2, life: 1 });
    }
    if (rings.length > 10) rings.splice(0, rings.length - 10);
  };

  const draw = (time = 0) => {
    animationFrame = 0;
    if (document.hidden) return;
    animationFrame = window.requestAnimationFrame(draw);
    const interval = 1000 / profile().fps;
    if (time - lastFrame < interval) return;
    lastFrame = time - ((time - lastFrame) % interval);
    context.clearRect(0, 0, width, height);

    currents.forEach((current, index) => {
      const baseY = height * (.38 + index * .125);
      context.beginPath();
      const step = motionState.tier === "full" ? 28 : 42;
      for (let x = -40; x <= width + 40; x += step) {
        const y = baseY
          + Math.sin(x * .008 + time * current.speed + current.phase) * current.amplitude
          + Math.sin(x * .0027 - time * .00019 + index) * 6;
        if (x === -40) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.lineWidth = .75 + index * .16;
      context.strokeStyle = currentGradients[index];
      context.stroke();
    });

    motes.forEach((mote) => {
      mote.y -= mote.speed;
      mote.x += Math.sin(time * .0007 + mote.sway) * .05;
      if (mote.y < -8) {
        mote.y = height + 8;
        mote.x = Math.random() * width;
      }
      context.beginPath();
      context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(37, 178, 220, ${mote.alpha})`;
      context.fill();
    });

    context.save();
    context.globalCompositeOperation = "screen";
    tracers.forEach((tracer) => {
      tracer.x += tracer.speed;
      if (tracer.x - tracer.length > width + 30) {
        tracer.x = -tracer.length - Math.random() * 180;
        tracer.y = height * (.34 + Math.random() * .58);
      }
      const y = tracer.y + Math.sin(time * .0011 + tracer.phase) * 7;
      context.beginPath();
      context.moveTo(tracer.x - tracer.length, y + Math.sin(time * .001 + tracer.phase) * 2);
      context.quadraticCurveTo(tracer.x - tracer.length * .42, y - 8, tracer.x, y);
      context.lineWidth = 1.2;
      context.strokeStyle = `rgba(41, 194, 226, ${tracer.alpha * 1.35})`;
      context.stroke();
      context.beginPath();
      context.arc(tracer.x, y, 1.5, 0, Math.PI * 2);
      context.fillStyle = `rgba(255,255,255,${tracer.alpha * 2.6})`;
      context.fill();
    });

    pointerTrail.forEach((point) => { point.life -= .034; });
    if (pointerTrail.length > 1) {
      for (let index = 1; index < pointerTrail.length; index += 1) {
        const previous = pointerTrail[index - 1];
        const point = pointerTrail[index];
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.quadraticCurveTo((previous.x + point.x) / 2, point.y - 4, point.x, point.y);
        context.lineWidth = Math.max(.4, 3.2 * point.life);
        context.strokeStyle = `rgba(54, 205, 230, ${Math.max(0, .22 * point.life)})`;
        context.stroke();
      }
      while (pointerTrail.length && pointerTrail[0].life <= 0) pointerTrail.shift();
    }
    context.restore();

    rings.forEach((ring) => {
      ring.radius += ring.growth;
      ring.life -= .045;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(.7, 2.1 * ring.life);
      context.strokeStyle = `rgba(28, 166, 218, ${Math.max(0, ring.alpha * ring.life)})`;
      context.stroke();
    });
    for (let index = rings.length - 1; index >= 0; index -= 1) if (rings[index].life <= 0) rings.splice(index, 1);
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
  };

  const scheduleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 140);
  };

  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("motiontierchange", resize);
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("page-inactive", document.hidden);
    if (!document.hidden && !animationFrame) animationFrame = window.requestAnimationFrame(draw);
  });
  window.addEventListener("pointermove", (event) => {
    if (!event.target.closest("main")) return;
    const settings = profile();
    if (settings.trail) {
      pointerTrail.push({ x: event.clientX, y: event.clientY, life: 1 });
      if (pointerTrail.length > settings.trail) pointerTrail.shift();
    }
    const spawnInterval = motionState.tier === "full" ? 72 : 130;
    if (performance.now() - lastSpawn < spawnInterval) return;
    lastSpawn = performance.now();
    addDrop(event.clientX, event.clientY);
  }, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, .ripple-card")) addDrop(event.clientX, event.clientY, true);
  }, { passive: true });
  resize();
  animationFrame = window.requestAnimationFrame(draw);
}

function initSceneParallax() {
  if (motionState.tier !== "full") return;
  const root = document.documentElement;
  let frame = 0;
  window.addEventListener("pointermove", (event) => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      const x = event.clientX / window.innerWidth - .5;
      const y = event.clientY / window.innerHeight - .5;
      root.style.setProperty("--scene-x", `${(x * 16).toFixed(2)}px`);
      root.style.setProperty("--scene-y", `${(y * 11).toFixed(2)}px`);
      root.style.setProperty("--ship-x", `${(x * -10).toFixed(2)}px`);
      root.style.setProperty("--ship-y", `${(y * -6).toFixed(2)}px`);
      frame = 0;
    });
  }, { passive: true });
}

function initPerformanceGuard() {
  if (typeof PerformanceObserver !== "function" || motionState.tier === "lite") return;
  let longTasks = 0;
  let observer;
  const start = () => {
    try {
      observer = new PerformanceObserver((list) => {
        longTasks += list.getEntries().filter((entry) => entry.duration >= 70).length;
        if (longTasks < 4) return;
        setMotionTier(motionState.tier === "full" ? "balanced" : "lite");
        observer.disconnect();
      });
      observer.observe({ entryTypes: ["longtask"] });
      window.setTimeout(() => observer?.disconnect(), 9000);
    } catch {
      // Older browsers simply keep the initial hardware-based profile.
    }
  };
  window.setTimeout(start, 1800);
}

function animateRenderedScene() {
  if (lastAnimatedTab === state.tab) return;
  lastAnimatedTab = state.tab;
  const selector = state.tab === "overview"
    ? ".hero-deck .metric-card, .hero-deck .vessel-card, .flow-panel, .meeting-department-card"
    : ".positions-head, .filter-bar, .positions-table-panel";
  window.requestAnimationFrame(() => {
    document.querySelectorAll(selector).forEach((element, index) => {
      if (typeof element.animate !== "function") return;
      element.animate([
        { opacity: 0, transform: `translate3d(0, ${18 + Math.min(index, 4) * 3}px, 0) scale(.985)` },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ], {
        duration: 560 + Math.min(index, 8) * 65,
        delay: Math.min(index, 8) * 42,
        easing: "cubic-bezier(.2,.78,.2,1)",
        fill: "both",
      });
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
  animateRenderedScene();
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

initWaterClickRipple();
void load();
window.setInterval(() => void load(), 60000);

