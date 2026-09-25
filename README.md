# 中国司法统计数据平台（1949—1999）

基于公开出版物 OCR 文本整理的结构化司法统计数据，提供**只读检索、动态图表、表格导出**。

## 站点结构

```
index.html              页面（数据检索 / 数据源 / 口径疑点 / 关于）
assets/style.css        样式
assets/app.js           前端逻辑（原生 JS + Chart.js CDN）
data/dataset.json       主数据（字典编码 + 数组记录，2.7 MB，gzip 后约 350 KB）
data/tables.json        原书统计表目录（534 张）
data/issues.json        统计口径疑点清单
data/manifest.json      数据文件的字节数与 SHA-256（用于验证数据未被修改）
.nojekyll               禁用 Jekyll，保证 GitHub Pages 原样发布
```

## 本地预览

```bash
cd 司法统计数据网站
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> 注意：必须通过 HTTP 访问。直接双击 `index.html`（`file://`）会因浏览器同源策略无法读取 `data/*.json`。

## 部署到 GitHub Pages

```bash
git init && git add . && git commit -m "司法统计数据平台"
git branch -M main
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

随后在仓库 **Settings → Pages → Build and deployment**：
- Source 选 `Deploy from a branch`
- Branch 选 `main` / 根目录 `/`（若站点放在子目录则选 `/docs` 并把文件移入）

保存后即可通过 `https://<用户名>.github.io/<仓库名>/` 访问。

## 数据只读性如何保证

1. 站点为纯静态页面，**不含任何后端或写入接口**，`data/*.json` 只能被读取。
2. `data/manifest.json` 记录每个数据文件的字节数与 SHA-256，页面顶部展示 `dataset.json` 的哈希前缀。
3. 访客可下载数据文件后自行计算哈希与清单比对，验证数据未被改动：

```bash
shasum -a 256 data/dataset.json
```
4. 数据文件随 Git 版本化管理，任何改动都会留下提交记录；如需发布修订版，请重新生成数据并同步更新 `manifest.json`。

## 数据来源

1. 最高人民法院研究室编：《全国人民法院司法统计历史资料汇编（1949～1998）》（第二册：民事、经济纠纷、行政等案件），人民法院出版社 2000 年版。
2. 中国法律年鉴社编：《中国法律年鉴》1998 年卷、1999 年卷，“第十三部分 统计资料”（审判、检察、公安、司法行政、民政五大系统）。

## 重要提醒

- 数据为 OCR 自动抽取，**未经逐格人工复核**，正式引用请以原书为准。
- 1949 年数据空缺；1966—1969 年为 1992 年补报的不完全统计。
- 结案数含上年旧存，不可用「收案 − 结案」推算未结案。
- 2000 年起「经济纠纷」并入「民事」，跨 2000 年比较需先合并口径。
- 完整疑点清单见站点「口径说明与疑点」页，或 `data/issues.json`。
