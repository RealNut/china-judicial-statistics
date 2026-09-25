/* 中国司法统计数据平台 —— 纯前端只读检索与可视化
   数据来自 data/*.json（静态文件），站点不含任何写入接口。 */
const F = { 年份: 0, 机关: 1, 大类: 2, 审级: 3, 表: 4, 项目: 5, 指标: 6, 数值: 7, 单位: 8, 合计: 9, 来源: 10, 表序: 11, 页: 12, 质量: 13 };

let DATA = null, TABLES = null, ISSUES = null;
let filtered = [];
let page = 1, pageSize = 100;
let tPage = 1;
let chart = null;

const $ = id => document.getElementById(id);
const dec = (k, i) => (DATA.dict[k] && DATA.dict[k][i] !== undefined ? DATA.dict[k][i] : "");

/* 质量标志：完整文字 → 徽标短文本与配色 */
function qshort(i) {
  const s = dec("q", i);
  if (!s) return "—";
  if (s.startsWith("完好")) return "完好";
  if (s.startsWith("已重建")) return "已重建";
  if (s.startsWith("结构存疑")) return "存疑";
  return s.slice(0, 4);
}
function qcls(i) {
  const s = dec("q", i);
  if (s.startsWith("完好")) return "qm qm-ok";
  if (s.startsWith("已重建")) return "qm qm-fix";
  if (s.startsWith("结构存疑")) return "qm qm-warn";
  return "qm";
}

async function boot() {
  const [ds, tb, is, mf] = await Promise.all([
    fetch("data/dataset.json").then(r => r.json()),
    fetch("data/tables.json").then(r => r.json()),
    fetch("data/issues.json").then(r => r.json()),
    fetch("data/manifest.json").then(r => r.json()).catch(() => null),
  ]);
  DATA = ds; TABLES = tb; ISSUES = is;
  $("badge-count").textContent = `${ds.rows.length.toLocaleString()} 条记录 · ${ds.dict.cat.length} 个类别 · ${TABLES.length} 张原书统计表`;
  if (mf && mf["文件"] && mf["文件"]["dataset.json"]) {
    $("badge-hash").textContent = "🔒 只读数据 · SHA-256 " + mf["文件"]["dataset.json"].sha256.slice(0, 12) + "…";
    $("badge-hash").title = "dataset.json 的 SHA-256：" + mf["文件"]["dataset.json"].sha256;
  }
  buildFilters();
  buildSources(mf);
  buildNotes();
  buildIssues();
  buildAbout(mf);
  buildTableFilters();
  apply();
  renderTables();
}

/* ---------- 筛选器 ---------- */
function unique(vals) {
  const s = new Set();
  for (const r of DATA.rows) { const v = r[vals]; if (v !== null && v !== undefined && v !== "") s.add(v); }
  return [...s];
}
function chips(elId, dimKey, allIdx) {
  const el = $(elId);
  el.innerHTML = "";
  const items = allIdx.map(i => [i, dec(dimKey, i) || "（无）"])
    .sort((a, b) => (a[1] === "（无）" ? 1 : 0) - (b[1] === "（无）" ? 1 : 0)
      || a[1].localeCompare(b[1], "zh"));
  for (const [i, label] of items) {
    const b = document.createElement("span");
    b.className = "chip on";
    b.textContent = label;
    b.dataset.idx = i;
    b.onclick = () => { b.classList.toggle("on"); };
    el.appendChild(b);
  }
}
function selected(elId) {
  return [...$(elId).querySelectorAll(".chip.on")].map(c => +c.dataset.idx);
}
function filterChips(elId, q) {
  q = q.trim();
  for (const c of $(elId).querySelectorAll(".chip")) {
    c.style.display = !q || c.textContent.includes(q) ? "" : "none";
  }
}

function buildFilters() {
  const years = unique(F.年份).filter(y => y > 1900).sort((a, b) => a - b);
  $("f-year1").innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  $("f-year2").innerHTML = years.map(y => `<option value="${y}"${y === years[years.length - 1] ? " selected" : ""}>${y}</option>`).join("");
  chips("f-org", "org", unique(F.机关));
  chips("f-cat", "cat", unique(F.大类));
  chips("f-lvl", "lvl", unique(F.审级));
  chips("f-ind", "ind", unique(F.指标));
  chips("f-proj", "proj", unique(F.项目));
  chips("f-q", "q", unique(F.质量));
  // 默认仅勾选"法院"：各机关指标单位不同（人口/案件/火灾损失），
  // 全部勾选会让首屏图表因量级差异失去可读性；用户可自行勾选其他机关。
  for (const c of $("f-org").querySelectorAll(".chip")) {
    if (c.textContent !== "法院") c.classList.remove("on");
  }
  $("f-ind-q").oninput = e => filterChips("f-ind", e.target.value);
  $("f-proj-q").oninput = e => filterChips("f-proj", e.target.value);
  $("btn-apply").onclick = () => { page = 1; apply(); };
  $("btn-reset").onclick = () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.add("on"));
    $("f-year1").selectedIndex = 0;
    $("f-year2").selectedIndex = $("f-year2").options.length - 1;
    $("f-ind-q").value = ""; $("f-proj-q").value = "";
    filterChips("f-ind", ""); filterChips("f-proj", "");
    page = 1; apply();
  };
  ["c-type", "c-group", "c-agg"].forEach(id => $(id).onchange = renderChart);
  $("pg-size").onchange = e => { pageSize = +e.target.value; page = 1; renderTable(); };
  $("pg-prev").onclick = () => { if (page > 1) { page--; renderTable(); } };
  $("pg-next").onclick = () => { if (page * pageSize < filtered.length) { page++; renderTable(); } };
  $("btn-csv").onclick = () => exportCSV(false);
  $("btn-csv-all").onclick = () => exportCSV(true);
}

function apply() {
  const y1 = +$("f-year1").value, y2 = +$("f-year2").value;
  const org = new Set(selected("f-org")), cat = new Set(selected("f-cat"));
  const lvl = new Set(selected("f-lvl")), ind = new Set(selected("f-ind"));
  const proj = new Set(selected("f-proj"));
  const q = new Set(selected("f-q"));
  const excl = $("f-excl-total").checked;
  filtered = DATA.rows.filter(r =>
    r[F.年份] >= y1 && r[F.年份] <= y2 &&
    org.has(r[F.机关]) && cat.has(r[F.大类]) && lvl.has(r[F.审级]) &&
    ind.has(r[F.指标]) && proj.has(r[F.项目]) && q.has(r[F.质量]) &&
    (!excl || r[F.合计] === 0) &&
    r[F.数值] !== null && r[F.数值] !== undefined
  );
  $("result-count").textContent = `命中 ${filtered.length.toLocaleString()} 条记录`;
  renderChart();
  renderTable();
}

/* ---------- 图表 ---------- */
function renderChart() {
  const g = +$("c-group").value, agg = $("c-agg").value, type = $("c-type").value;
  const gKey = { 1: "org", 2: "cat", 3: "lvl", 6: "proj", 7: "ind" }[g];
  const years = [...new Set(filtered.map(r => r[F.年份]))].sort((a, b) => a - b);
  const groups = new Map();
  for (const r of filtered) {
    const k = r[g];
    if (!groups.has(k)) groups.set(k, new Map());
    const m = groups.get(k);
    const v = r[F.数值];
    if (agg === "sum") m.set(r[F.年份], (m.get(r[F.年份]) || 0) + v);
    else m.set(r[F.年份], Math.max(m.get(r[F.年份]) ?? -Infinity, v));
  }
  const top = [...groups.entries()]
    .map(([k, m]) => [k, [...m.values()].reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
  const palette = ["#1F4E79", "#c0504d", "#4f81bd", "#9bbb59", "#8064a2",
    "#f09a3c", "#4bacc6", "#e06666", "#6aa84f", "#8e7cc3"];
  const datasets = top.map((k, i) => ({
    label: dec(gKey, k) || "—",
    data: years.map(y => { const v = groups.get(k).get(y); return v === undefined ? null : v; }),
    borderColor: palette[i % palette.length],
    backgroundColor: palette[i % palette.length] + (type === "bar" ? "cc" : "22"),
    tension: .25, spanGaps: true, pointRadius: type === "line" ? 2.2 : 0,
  }));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type, data: { labels: years, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y?.toLocaleString() ?? "—"}` } },
      },
      scales: {
        y: { ticks: { callback: v => v >= 10000 ? (v / 10000).toFixed(0) + "万" : v } },
        x: { ticks: { maxRotation: 60, minRotation: 0 } },
      },
    },
  });
  const unit = [...new Set(filtered.map(r => dec("unit", r[F.单位])))].filter(Boolean).slice(0, 3);
  $("chart-note").textContent =
    `共 ${years.length} 个年份、${top.length} 个系列（按总量取前 10）。单位：${unit.join(" / ") || "—"}。` +
    (agg === "sum" ? " 数值为筛选结果的加总；若同年份存在父子项目，请先用“项目”筛选避免重复计数。" : " 取同年最大值。");
}

/* ---------- 表格 ---------- */
function renderTable() {
  const tb = $("data-table").querySelector("tbody");
  const start = (page - 1) * pageSize, rows = filtered.slice(start, start + pageSize);
  tb.innerHTML = rows.map(r => `<tr>
    <td>${r[F.年份]}</td><td>${dec("org", r[F.机关])}</td><td>${dec("cat", r[F.大类])}</td>
    <td>${dec("lvl", r[F.审级]) || "—"}</td><td>${dec("proj", r[F.项目])}</td>
    <td>${dec("ind", r[F.指标])}</td><td class="num">${Number(r[F.数值]).toLocaleString()}</td>
    <td>${dec("unit", r[F.单位])}</td><td class="${qcls(r[F.质量])}" title="${dec("q", r[F.质量])}">${qshort(r[F.质量])}</td>
    <td title="${dec("tbl", r[F.表]).replace(/"/g, "")}">${dec("tbl", r[F.表]).slice(0, 26)}</td>
    <td>${dec("src", r[F.来源])}</td></tr>`).join("");
  $("pg-info").textContent = `第 ${start + 1}–${Math.min(start + pageSize, filtered.length)} 条 / 共 ${filtered.length.toLocaleString()} 条`;
  $("pg-prev").disabled = page <= 1;
  $("pg-next").disabled = page * pageSize >= filtered.length;
}

function exportCSV(full) {
  const head = full
    ? ["年份", "来源机关", "统计大类", "审级", "项目", "指标", "数值", "单位",
       "是否合计项", "统计表", "来源编号", "表序号", "书页", "质量标志"]
    : ["年份", "来源机关", "统计大类", "审级", "项目", "指标", "数值", "单位", "统计表", "来源编号", "质量标志"];
  const lines = [head.join(",")];
  for (const r of filtered) {
    const base = [r[F.年份], dec("org", r[F.机关]), dec("cat", r[F.大类]),
      dec("lvl", r[F.审级]), dec("proj", r[F.项目]), dec("ind", r[F.指标]),
      r[F.数值], dec("unit", r[F.单位])];
    const tail = full
      ? [r[F.合计] ? "是" : "", dec("tbl", r[F.表]), dec("src", r[F.来源]), r[F.表序], r[F.页] || "", dec("q", r[F.质量])]
      : [dec("tbl", r[F.表]), dec("src", r[F.来源]), dec("q", r[F.质量])];
    lines.push([...base, ...tail].map(csv).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `司法统计数据_${filtered.length}条_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}
function csv(v) {
  v = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/* ---------- 数据源 ---------- */
function buildSources(mf) {
  // 固定书目信息；2000—2010 各卷结构相同，按年份动态生成
  const meta = {
    SPC_HIST_1949_1998: ["全国人民法院司法统计历史资料汇编（1949～1998）",
      "最高人民法院研究室 编；主编 杨润时 · 人民法院出版社 2000 年",
      "1950—1998 · 民事、经济纠纷、行政、海事海商、交通运输案件；执行、来信来访、综合治理、赔偿、督促与公示催告程序"],
    CHINA_LAW_YEARBOOK_1998: ["中国法律年鉴（1998 年卷）· 统计资料",
      "中国法律年鉴社 编 · 1999 年", "1998 · 审判、检察、公安、司法行政、民政五大系统"],
    CHINA_LAW_YEARBOOK_1999: ["中国法律年鉴（1999 年卷）· 统计资料",
      "中国法律年鉴社 编 · 2000 年", "1999 · 审判、检察、公安、司法行政、民政五大系统"],
  };
  const cnt = {};
  for (const t of TABLES) cnt[t.s] = (cnt[t.s] || 0) + 1;
  const keys = [...new Set(TABLES.map(t => t.s))].sort((a, b) => {
    const ya = (a.match(/(\d{4})$/) || [])[1] || "0";
    const yb = (b.match(/(\d{4})$/) || [])[1] || "0";
    return (a === "SPC_HIST_1949_1998" ? -1 : b === "SPC_HIST_1949_1998" ? 1 : ya - yb);
  });
  let html = "";
  for (const k of keys) {
    let name, pub, scope;
    if (meta[k]) {
      [name, pub, scope] = meta[k];
    } else {
      const y = (k.match(/(\d{4})$/) || [])[1];
      name = `中国法律年鉴（${y} 年卷）· 统计资料`;
      pub = "中国法律年鉴社 编";
      scope = `${y} · 审判、检察、公安、司法行政、民政等系统（2000 年起民事含原经济纠纷）`;
    }
    html += `<div class="src"><h3>${name}</h3><p>${pub}</p>
      <p>${scope}</p><p>本平台收录：${cnt[k] || 0} 张统计表</p></div>`;
  }
  if (mf) html += `<div class="src"><h3>数据完整性</h3><p>生成时间：${mf["生成时间"]}　记录数：${mf["记录数"]}</p>
    ${Object.entries(mf["文件"]).map(([f, v]) => `<p><code>${f}</code> ${(v.bytes / 1048576).toFixed(2)} MB · SHA-256 <code>${v.sha256}</code></p>`).join("")}
    <p>数据文件为静态只读资源，站点不含任何写入接口；如需更正，须重新生成文件并同步更新校验值。</p></div>`;
  $("src-list").innerHTML = html;
}

function buildTableFilters() {
  $("tbl-count").textContent = TABLES.length;
  const orgs = [...new Set(TABLES.map(t => t.o))].sort();
  const yrs = [...new Set(TABLES.map(t => t.y1))].filter(Boolean).sort((a, b) => a - b);
  $("tbl-org").innerHTML += orgs.map(o => `<option>${o}</option>`).join("");
  $("tbl-year").innerHTML += yrs.map(y => `<option value="${y}">${y}</option>`).join("");
  const qf = [...new Set(TABLES.map(t => t.q).filter(Boolean))];
  $("tbl-q-flag").innerHTML += qf.map(q => `<option value="${q}">${q}</option>`).join("");
  ["tbl-q", "tbl-org", "tbl-year", "tbl-q-flag"].forEach(id => $(id).oninput = () => { tPage = 1; renderTables(); });
  $("tp-prev").onclick = () => { if (tPage > 1) { tPage--; renderTables(); } };
  $("tp-next").onclick = () => { if (tPage * 50 < tblFiltered().length) { tPage++; renderTables(); } };
}
function tblFiltered() {
  const q = $("tbl-q").value.trim(), o = $("tbl-org").value, y = $("tbl-year").value;
  const qflag = $("tbl-q-flag").value;
  return TABLES.filter(t =>
    (!o || t.o === o) && (!y || String(t.y1) === y) && (!qflag || t.q === qflag) &&
    (!q || (t.t || "").includes(q) || (t.c || "").includes(q) || (t.o || "").includes(q))
  ).sort((a, b) => (a.y1 || 0) - (b.y1 || 0) || (a.n || 0) - (b.n || 0));
}
function renderTables() {
  const rows = tblFiltered(), start = (tPage - 1) * 50;
  $("tbl-table").querySelector("tbody").innerHTML = rows.slice(start, start + 50).map(t => `<tr>
    <td>${t.y1 || "—"}${t.y2 && t.y2 !== t.y1 ? "–" + t.y2 : ""}</td><td>${t.o}</td><td>${t.c}</td>
    <td>${t.l || "—"}</td><td title="${(t.t || "").replace(/"/g, "")}">${(t.t || "").slice(0, 40)}</td>
    <td class="num">${t.nr}</td><td class="num">${t.nc}</td>
    <td class="${t.q && t.q.startsWith("完好") ? "qm qm-ok" : t.q && t.q.startsWith("已重建") ? "qm qm-fix" : "qm qm-warn"}"
        title="${t.q || ""}">${t.q ? (t.q.startsWith("完好") ? "完好" : t.q.startsWith("已重建") ? "已重建" : "存疑") : "—"}</td>
    <td>${t.p || "—"}</td>
    <td>${t.s.replace("CHINA_LAW_YEARBOOK_", "年鉴").replace("SPC_HIST_1949_1998", "最高法汇编")}</td></tr>`).join("");
  $("tp-info").textContent = `第 ${start + 1}–${Math.min(start + 50, rows.length)} 张 / 共 ${rows.length} 张`;
}

/* ---------- 说明与疑点 ---------- */
function buildNotes() {
  $("notes-body").innerHTML = `
  <p><strong>数据形态。</strong>本平台数据由出版物的 OCR 文本自动抽取、结构化为“年份 × 机关 × 类别 × 审级 × 项目 × 指标 × 数值”的一维长表。
  同一张原书统计表跨页时会被切成多条，已尽量标记但可能存在遗漏。</p>
  <p><strong>年份。</strong>最高人民法院汇编的起点为 1950 年——1949 年全国大部分地区尚未成立人民法院、统计报表制度亦未建立，故 1949 年数据空缺。
  1999 年数据仅见于《中国法律年鉴》，无第二来源可校验。</p>
  <p><strong>结案口径。</strong>各类收结案表均注明“结案中含上年旧存”，因此结案数可能大于当年收案数，<strong>不可用“收案 − 结案”推算未结案数</strong>。</p>
  <p><strong>类别口径变化。</strong>审判监督案件自 1959 年起单列；经济纠纷案件自 1983 年起单列；行政案件自 1987 年起单列。
  这些年份之前并非数值为 0，而是“未单列统计”。</p>
  <p><strong>单位。</strong>“件 / 人 / 个”不可混用相加；来信来访表以“件（人）”混合计数（来信按件、来访按人）。
  部分表为复合单位（如“万公顷、万人次、亿元”），本平台以单列表示，需按列名判别。</p>
  <p><strong>2000 年前后口径断裂（重要）。</strong>2000 年起最高人民法院将“经济纠纷”并入“民事”（大民事格局），
  因此 2000 年前的“民事”不含经济纠纷，之后的“民事”包含原经济纠纷。
  <strong>跨 2000 年做趋势比较时，2000 年前须取“民事 + 经济纠纷”之和</strong>，否则会出现虚假跃升。
  本平台已收录 2000—2010 年数据，可在同一张图上直接观察该口径切换点。</p>
  <p><strong>2006 年起表式变化。</strong>2006 年以后年鉴改用“指标”作首列、案件类别作行名的表式；
  本平台已按同一长表结构规范化，与早期表式可直接合并。个别年份首列被 OCR 漏读，
  其合计行由“分项加总校验”推断得出，已在表目录中标注为「结构存疑（行名缺失）」。</p>
  <p><strong>2015 年立案登记制。</strong>2015 年 5 月 1 日起全国法院实行立案登记制（由审查立案改为登记立案），
  当年收案量出现<strong>制度性跃升</strong>（民事一审 830 万 → 1009 万，行政一审 14 万 → 22 万）。
  这不是数据错误，但做长时段趋势时应把 2015 年前后视为两个制度阶段。</p>
  <p><strong>2017 起「全审级」表与「一审」表并存。</strong>2017 年起年鉴新增「审理刑事案件情况」等不分审级的汇总表，
  与原有「一审」表并存，两者数值相差很大（如 2017 年刑事：全审级 184 万 / 一审 129 万）。
  <strong>跨年比较务必固定「审级」筛选</strong>——只勾「一审」，或只勾审级为空的全审级表。</p>
  <p><strong>2020 年起「审理」改称「受理」。</strong>2020 年卷起表题与指标由「审理／收案」改为「受理」，
  与 2019 年及以前的「收案」不完全同一口径，并列引用时须注明。</p>
  <p><strong>2011—2019 年仅有法院数据。</strong>这 9 卷源文件的 OCR 文本只有「审判机关」一章，
  缺检察、公安、司法行政、民政各章（2020 年卷恢复）。因此这 9 年本平台只有法院数据，属源文件限制。</p>
  <p><strong>1998 年前的刑事数据。</strong>最高人民法院汇编第二册不含刑事案件，
  1998 年前的刑事数据仅来自《中国法律年鉴》，无第二来源可校验。</p>`;
}
function buildIssues() {
  $("iss-count").textContent = ISSUES.length;
  $("iss-list").innerHTML = ISSUES.map(i => `<div class="iss">
    <h4><span class="lv lv-${i["等级"]}">${i["等级"]}</span>
      <span>${i["疑点类别"]}</span><span class="scope">${i["涉及范围"] || ""}</span></h4>
    <p>${i["疑点描述"]}</p>
    ${i["证据/示例"] ? `<p><strong>证据/示例：</strong>${i["证据/示例"]}</p>` : ""}
    ${i["建议处理"] ? `<p><strong>建议处理：</strong>${i["建议处理"]}</p>` : ""}
  </div>`).join("");
}
function buildAbout(mf) {
  $("about-body").innerHTML = `
  <p><strong>数据只读。</strong><code>data/dataset.json</code>、<code>data/tables.json</code>、<code>data/issues.json</code>
  为静态只读文件，随站点一同版本化管理；<code>data/manifest.json</code> 记录各文件的字节数与 SHA-256，
  访客可自行下载数据与清单比对，确认数据未被改动。站点前端不发送任何写请求。</p>
  <p><strong>使用方式。</strong>在“数据检索与图表”页按年份、机关、类别、审级、指标、项目自由组合筛选，
  图表随筛选实时更新；表格可分页浏览并导出 CSV（含 BOM，Excel 直接打开不乱码）。</p>
  <p><strong>引用建议。</strong>本平台数据为二次整理成果，正式引用请以原始出版物为准：</p>
  <p>① 最高人民法院研究室编：《全国人民法院司法统计历史资料汇编（1949～1998）》，人民法院出版社 2000 年版。<br>
     ② 中国法律年鉴社编：《中国法律年鉴》1998 年卷、1999 年卷，“第十三部分 统计资料”。</p>
  <p><strong>已知局限。</strong>数据未经逐格人工复核；1966—1969 年为补报的不完全统计；
  汇编编者已声明“表中存在的不平衡关系一般未予订正”。详见“口径说明与疑点”。</p>`;
}

/* ---------- 页签 ---------- */
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("tab-" + b.dataset.tab).classList.add("active");
});

boot().catch(e => {
  document.querySelector("main").innerHTML =
    `<div class="card"><p class="loading">数据加载失败：${e.message}<br>若通过 file:// 直接打开，请改用本地 HTTP 服务（如 <code>python3 -m http.server</code>）。</p></div>`;
});
