/* catalog.js — 数据源与表目录（点一呈现）
 * 读取 data/catalog.json，按来源文件分组逐表呈现二维网格 + 异常标记 + 溯源定位。
 */
(function () {
  "use strict";
  const API = "data/catalog.json";
  const BATCH = 200;            // 每批渲染卡片数（其余“加载更多”）
  let DATA = null;
  let tables = [];
  let state = { source: null, q: "", agency: new Set(), scope: "", ano: "", year: "", code: "", shown: BATCH };

  // 出版物元数据（整合自原主站“数据来源”视图，此后该视图并入本页）
  const PUB = {
    SPC_HIST_1949_1998: {
      name: "全国人民法院司法统计历史资料汇编（1949～1998）",
      pub: "最高人民法院研究室 编；主编 杨润时 · 人民法院出版社 2000 年",
      scope: "1950—1998 · 民事、经济纠纷、行政、海事海商、交通运输案件；执行、来信来访、综合治理、赔偿、督促与公示催告程序" },
    CHINA_LAW_YEARBOOK_1998: {
      name: "中国法律年鉴（1998 年卷）· 统计资料", pub: "中国法律年鉴社 编 · 1999 年",
      scope: "1998 · 审判机关（该书其余系统数据已按机关分流归档）" },
    CHINA_LAW_YEARBOOK_1999: {
      name: "中国法律年鉴（1999 年卷）· 统计资料", pub: "中国法律年鉴社 编 · 2000 年",
      scope: "1999 · 审判机关" },
  };
  function pubMeta(sid) {
    if (PUB[sid]) return PUB[sid];
    const y = (String(sid).match(/(\d{4})$/) || [])[1];
    if (!y) return { name: sid, pub: "", scope: "" };
    const extra = (y >= 2011 && y <= 2019) ? "（该卷源文件仅含审判机关一章）" : "";
    return { name: `中国法律年鉴（${y} 年卷）· 统计资料`, pub: "中国法律年鉴社 编",
      scope: `${y} · 审判机关${extra}（2000 年起民事含原经济纠纷）` };
  }

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
    buildYearFilter();
    buildAnoPanel();
    bind();
    render();
    jumpToHash();
    window.addEventListener("hashchange", jumpToHash);
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
    $("#f-year").addEventListener("change", (e) => { state.year = e.target.value; resetShown(); render(); });
    const csvBtn = $("#btn-ano-csv");
    if (csvBtn) csvBtn.onclick = exportAnomaliesCSV;
  }

  function buildYearFilter() {
    const yrs = [...new Set(tables.map(t => t.year_from).filter(Boolean))].sort((a, b) => a - b);
    const sel = $("#f-year");
    sel.innerHTML = '<option value="">全部年份</option>' +
      yrs.map(y => `<option value="${y}">${y}</option>`).join("");
  }

  /* 异常总览面板：按异常代码统计，点击筛选定位（每条异常可跳到锚定卡片核对） */
  function buildAnoPanel() {
    const box = $("#ano-codes");
    const counts = {};
    for (const t of tables) for (const a of t.anomalies) counts[a.code] = (counts[a.code] || 0) + 1;
    const ANO_DESC = {
      ORPHAN_COURT: "上下文属法院但未纳入数据集（多为行政一审，按约定预期排除，待核）",
      ORPHAN_NONCOURT: "非法院机关表（检察/公安/司法行政/民政等），按项目范围未纳入",
      QUALITY_FLAG: "原目录质量标志非“完好”（结构存疑/已重建等）",
      ROW_MISMATCH: "inventory 记录的数据行数 ≠ markdown 抽取行数",
      COL_MISMATCH: "inventory 记录的列数 ≠ markdown 抽取列数",
      FLAT_TABLE: "表格被 OCR 压成单行，列对应关系存疑",
      EMPTY_HEADER: "列名全部为空，无法确认指标含义",
      NO_UNIT: "上/下文未检测到单位",
      MULTI_LOGICAL: "同一物理表对应多个逻辑表号（跨页拆分）",
    };
    box.innerHTML = "";
    const codes = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    for (const code of codes) {
      const c = document.createElement("span");
      const warnish = !(code === "ORPHAN_NONCOURT" || code === "NO_UNIT" || code === "MULTI_LOGICAL");
      c.className = "chip" + (warnish ? " warnchip" : "");
      c.title = ANO_DESC[code] || "";
      c.textContent = `${code} ${counts[code]}`;
      c.onclick = () => {
        state.code = state.code === code ? "" : code;
        [...box.children].forEach(x => x.classList.toggle("on", x.textContent.startsWith(state.code + " ") && state.code !== ""));
        resetShown(); render();
      };
      box.appendChild(c);
    }
  }

  function renderSrcInfo() {
    const box = $("#src-info");
    if (!state.source) { box.innerHTML = ""; return; }
    const s = DATA.sources.find(x => x.file === state.source);
    if (!s) { box.innerHTML = ""; return; }
    const m = pubMeta(s.source_id);
    box.innerHTML = `<h3>${esc(m.name)}</h3>
      ${m.pub ? `<p>${esc(m.pub)}</p>` : ""}
      ${m.scope ? `<p>${esc(m.scope)}</p>` : ""}
      <p>源文件 <code>${esc(s.file)}</code> · 抽出 ${s.md_tables} 张表（法院数据集收录 ${s.court_tables} 张 · 未纳入 ${s.orphans} 张${s.orphans_court_heading ? ` · 其中待核 ${s.orphans_court_heading} 张` : ""}）</p>`;
  }

  /* 异常清单 CSV：每行 = 一条异常（表 id/文件/行号/标题/归属/代码/级别/说明），供逐条销号核对 */
  function exportAnomaliesCSV() {
    const head = ["表 id", "是否法院数据集", "机关", "标题", "md 文件", "md 行号", "异常代码", "级别", "说明"];
    const lines = [head.join(",")];
    for (const t of tables) {
      for (const a of t.anomalies) {
        lines.push([t.id, t.in_court_dataset ? "是" : "否", t.agency || "未知",
          t.title, t.md_file, t.md_line, a.code, a.severity, a.msg].map(csv).join(","));
      }
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `异常清单_${lines.length - 1}条_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  function csv(v) {
    v = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function filtered() {
    const q = state.q.toLowerCase();
    return tables.filter(t => {
      if (state.source && t.md_file !== state.source) return false;
      if (state.agency.size && !state.agency.has(t.agency || "未知")) return false;
      if (state.scope === "court" && !t.in_court_dataset) return false;
      if (state.scope === "orphan" && t.in_court_dataset) return false;
      if (state.year && String(t.year_from || "") !== state.year) return false;
      if (state.code && !t.anomalies.some(a => a.code === state.code)) return false;
      const sev = severityMax(t.anomalies);
      if (state.ano === "warn" && sev < 2) return false;
      if (state.ano === "info" && sev !== 1) return false;
      if (state.ano === "none" && sev > 0) return false;
      if (q) {
        const hay = (t.title + " " + (t.agency || "") + " " + (t.category || "") + " " +
          (t.md_file || "") + " " + (t.md_line || "") + " " + t.id + " " +
          (t.inv_table_nos || []).join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const list = filtered();
    renderSrcInfo();
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
    d.id = t.id;            // 供主站“溯源”链接锚定（catalog.html#<id>）
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
    if (court) {
      const nos = (t.inv_table_nos && t.inv_table_nos.length > 1)
        ? t.inv_table_nos.join("、") : String(t.inv_table_no);
      sub.push(`来源编号 ${esc(t.source_id)} · 逻辑表号 ${nos}`);
    } else {
      sub.push(`来源文件 ${esc(t.md_file)} · 行 ${t.md_line}`);
    }
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
        ${court ? `<p style="margin:6px 0 0"><a class="jump-link" href="table.html?t=${encodeURIComponent(t.id)}" target="_blank" rel="noopener">↔ 对照：处理后的长表还原视图（table.html）</a>
          <span class="hint">· 本卡片即 Markdown 直接抽取的原表，两者应一致，不一致请记录</span></p>` : ""}
        <div class="grid-wrap" data-ready="0"></div>
        <ul class="ano-list"></ul>
      </div>`;

    d.querySelector(".grid-wrap").addEventListener("click", () => {
      // 延迟构建网格（展开时按需）
    });
    d.addEventListener("toggle", () => {
      if (d.open) buildBody(d, t);
    });
    d._t = t;
    return d;
  }

  // 支持从主站“溯源”链接直达：catalog.html#<id> 自动展开并滚动到该表
  // 兼容“一个物理表对应多个逻辑表号”：精确 id 未命中时，按 inv_table_nos 兑底
  function jumpToHash() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!id) return;
    let el = document.getElementById(id);
    if (!el && tables.length) {
      const hit = tables.find(t => (t.inv_table_nos || []).some(n => `${t.source_id}__${n}` === id));
      if (hit) el = document.getElementById(hit.id);
    }
    if (!el) return;
    el.open = true;
    buildBody(el, el._t);
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
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
