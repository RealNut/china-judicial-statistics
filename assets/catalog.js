/* catalog.js — 数据源与表目录（点一呈现）
 * 读取 data/catalog.json，按来源文件分组逐表呈现二维网格 + 异常标记 + 溯源定位。
 */
(function () {
  "use strict";
  const API = "data/catalog.json";
  const BATCH = 200;            // 每批渲染卡片数（其余“加载更多”）
  let DATA = null;
  let tables = [];
  let state = { source: null, q: "", agency: new Set(), scope: "", ano: "", shown: BATCH };

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const AG_LABEL = { "法院": "法院", "检察机关": "检察机关", "公安机关": "公安机关",
    "司法行政机关": "司法行政机关", "民政": "民政", "未知": "未知/其他" };

  function severityMax(anoms) {
    let m = 0;
    for (const a of anoms) {
      if (a.severity === "high") m = Math.max(m, 3);
      else if (a.severity === "warn") m = Math.max(m, 2);
      else if (a.severity === "info") m = Math.max(m, 1);
    }
    return m;
  }
  const SEV_TXT = { 3: "高", 2: "警告", 1: "提示" };

  async function init() {
    const res = await fetch(API, { cache: "no-cache" });
    DATA = await res.json();
    tables = DATA.tables;
    $("#tot-tables").textContent = tables.length;
    buildRail();
    buildAgencyChips();
    bind();
    render();
  }

  function buildRail() {
    const box = $("#rail-items");
    box.innerHTML = "";
    const all = document.createElement("div");
    all.className = "rail-item on";
    all.dataset.src = "";
    all.innerHTML = `<div class="rn">全部来源</div><div class="rc">${tables.length} 张表</div>`;
    all.onclick = () => selectSource(null, all);
    box.appendChild(all);
    for (const s of DATA.sources) {
      const el = document.createElement("div");
      el.className = "rail-item";
      el.dataset.src = s.file;
      const warn = (s.orphans_court_heading || 0);
      el.innerHTML = `<div class="rn">${esc(s.source_id)}</div>
        <div class="rc">${s.md_tables} 张（法院 ${s.court_tables} · 未纳入 ${s.orphans}）${warn ? ` · <b>待核 ${warn}</b>` : ""}</div>`;
      el.onclick = () => selectSource(s.file, el);
      box.appendChild(el);
    }
  }

  function buildAgencyChips() {
    const box = $("#agency-chips");
    const counts = {};
    for (const t of tables) counts[t.agency || "未知"] = (counts[t.agency || "未知"] || 0) + 1;
    box.innerHTML = "<label>机关</label>";
    for (const a of Object.keys(AG_LABEL)) {
      if (!counts[a]) continue;
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = (AG_LABEL[a] || a) + " " + counts[a];
      c.onclick = () => {
        if (state.agency.has(a)) { state.agency.delete(a); c.classList.remove("on"); }
        else { state.agency.add(a); c.classList.add("on"); }
        resetShown(); render();
      };
      box.appendChild(c);
    }
  }

  function selectSource(file, el) {
    state.source = file;
    document.querySelectorAll(".rail-item").forEach(x => x.classList.remove("on"));
    el.classList.add("on");
    resetShown(); render();
  }
  function resetShown() { state.shown = BATCH; }

  function bind() {
    $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); resetShown(); render(); });
    $("#scope").addEventListener("change", (e) => { state.scope = e.target.value; resetShown(); render(); });
    $("#ano").addEventListener("change", (e) => { state.ano = e.target.value; resetShown(); render(); });
  }

  function filtered() {
    const q = state.q.toLowerCase();
    return tables.filter(t => {
      if (state.source && t.md_file !== state.source) return false;
      if (state.agency.size && !state.agency.has(t.agency || "未知")) return false;
      if (state.scope === "court" && !t.in_court_dataset) return false;
      if (state.scope === "orphan" && t.in_court_dataset) return false;
      const sev = severityMax(t.anomalies);
      if (state.ano === "warn" && sev < 2) return false;
      if (state.ano === "info" && sev !== 1) return false;
      if (state.ano === "none" && sev > 0) return false;
      if (q) {
        const hay = (t.title + " " + (t.agency || "") + " " + (t.category || "") + " " +
          (t.md_file || "") + " " + (t.md_line || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const list = filtered();
    $("#pill-total").textContent = `共 ${tables.length} 张 · 法院 ${list.filter(t=>t.in_court_dataset).length} 已纳入 / 未纳入 ${list.filter(t=>!t.in_court_dataset).length}`;
    const box = $("#cards");
    box.innerHTML = "";
    if (!list.length) { $("#empty").style.display = "block"; $("#pill-show").textContent = "显示 0"; return; }
    $("#empty").style.display = "none";
    const slice = list.slice(0, state.shown);
    const frag = document.createDocumentFragment();
    for (const t of slice) frag.appendChild(card(t));
    box.appendChild(frag);
    const more = list.length - slice.length;
    let moreBtn = $("#more-btn");
    if (more > 0) {
      if (!moreBtn) { moreBtn = document.createElement("button"); moreBtn.id = "more-btn";
        moreBtn.className = "primary"; moreBtn.style.margin = "10px auto"; moreBtn.style.display = "block"; }
      moreBtn.textContent = `加载更多（剩余 ${more}）`;
      moreBtn.onclick = () => { state.shown += BATCH; render(); };
      box.appendChild(moreBtn);
    } else if (moreBtn) { moreBtn.remove(); }
    $("#pill-show").textContent = `显示 ${slice.length} / ${list.length}`;
  }

  function card(t) {
    const d = document.createElement("details");
    d.className = "tcard";
    const sev = severityMax(t.anomalies);
    const sevTxt = sev ? SEV_TXT[sev] : "";
    const court = t.in_court_dataset;
    const ag = t.agency || "未知";
    const badges = [];
    badges.push(`<span class="ab ${court ? "ab-court" : "ab-orphan"}">${court ? "法院数据集" : "未纳入"}</span>`);
    badges.push(`<span class="ab ab-ag">${AG_LABEL[ag] || ag}</span>`);
    if (t.quality && t.quality !== "完好") badges.push(`<span class="ab ab-q" title="${esc(t.quality)}">${esc(t.quality)}</span>`);
    if (sev) badges.push(`<span class="ab ab-ano ${sev >= 3 ? "has-high" : ""}">⚠ ${sevTxt}异常 ${t.anomalies.length}</span>`);

    const sub = [];
    if (court) sub.push(`来源编号 ${esc(t.source_id)} · 表号 ${t.inv_table_no}`);
    else sub.push(`来源文件 ${esc(t.md_file)} · 行 ${t.md_line}`);
    if (t.category) sub.push(`类别 ${esc(t.category)}`);
    if (t.trial) sub.push(`审级 ${esc(t.trial)}`);
    if (t.year_from) sub.push(`${t.year_from}${t.year_to && t.year_to !== t.year_from ? "–" + t.year_to : ""} 年`);
    if (t.unit) sub.push(`单位 ${esc(t.unit)}`);

    d.innerHTML = `
      <summary>
        <div class="tt">${esc(t.title || ("（未识别标题 · " + t.md_file + " 行" + t.md_line + "）"))}
          <small>${sub.join(" · ")}</small></div>
        <div class="badges-row">${badges.join("")}</div>
      </summary>
      <div class="body">
        <div class="src-path">${esc(DATA.md_dir)}${esc(t.md_file)} · 第 ${t.md_line} 行（Markdown 行号）</div>
        <div class="grid-wrap" data-ready="0"></div>
        <ul class="ano-list"></ul>
      </div>`;

    d.querySelector(".grid-wrap").addEventListener("click", () => {
      // 延迟构建网格（展开时按需）
    });
    d.addEventListener("toggle", () => {
      if (d.open) buildBody(d, t);
    });
    return d;
  }

  function buildBody(d, t) {
    const gw = d.querySelector(".grid-wrap");
    if (gw.dataset.ready === "1") return;
    gw.dataset.ready = "1";
    if (!t.header_rows || !t.header_rows.length) {
      gw.innerHTML = `<p class="note">该表无可用表头（OCR 可能未识别），原始数据行如下：</p>`;
    }
    const tbl = document.createElement("table");
    tbl.className = "grid";
    if (t.header_rows && t.header_rows.length) {
      const thead = document.createElement("thead");
      for (const row of t.header_rows) {
        const tr = document.createElement("tr");
        for (const c of row) {
          const th = document.createElement("th");
          th.innerHTML = c ? esc(c) : '<span class="empty">—</span>';
          tr.appendChild(th);
        }
        thead.appendChild(tr);
      }
      tbl.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    for (const row of (t.data_rows || [])) {
      const tr = document.createElement("tr");
      for (const c of row) {
        const td = document.createElement("td");
        if (c === "" || c == null) td.innerHTML = '<span class="empty">—</span>';
        else td.textContent = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    gw.appendChild(tbl);
    if (!t.header_rows || !t.header_rows.length) gw.appendChild(tbl);

    const ul = d.querySelector(".ano-list");
    if (!t.anomalies.length) {
      ul.innerHTML = `<li class="sev-info">无异常标记（${(t.in_court_dataset ? "已纳入法院数据集" : "非法院数据，按项目范围未纳入")}）。</li>`;
    } else {
      for (const a of t.anomalies) {
        const li = document.createElement("li");
        li.className = "sev-" + (a.severity || "info");
        li.innerHTML = `<b>[${SEV_TXT[severityMax([a])] || a.severity}] ${esc(a.code)}</b> — ${esc(a.msg)}`;
        ul.appendChild(li);
      }
    }
  }

  init().catch(e => {
    document.getElementById("cards").innerHTML =
      `<div class="empty-state">加载失败：${esc(e.message)}<br>请确认 data/catalog.json 已部署。</div>`;
  });
})();
