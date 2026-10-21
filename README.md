# MineTools

个人使用的 Chrome MV3 扩展：集成 Google 搜索结果采集、Ahrefs 反链、页面外链扫描、域名注册时间查询和关键词趋势分析，以浏览器右侧侧边栏常驻。

运行时只有 HTML、CSS 和 JavaScript，不需要 Node.js、Python、服务端或网络 API。Node.js 只在修改源码、生成扩展脚本和运行本地验证时使用。

## 安装

1. 打开 `chrome://extensions/`，开启开发者模式。
2. 点击“加载已解压的扩展程序”。
3. 选择当前 `MineTools` 文件夹，即这个包含 `manifest.json` 的目录。
4. 点击扩展图标，在浏览器右侧打开 MineTools 侧边栏；切换标签页时保持打开，使用浏览器自带的关闭按钮关闭。

更新源码后，先执行 `npm run build`，然后在 `chrome://extensions/` 点击 MineTools 的刷新按钮，并刷新已打开的 Google 页面。

## 功能

- 常用页集中提供查域名、查外链和找外链三个操作，打开侧边栏即可使用。
- 侧边栏为窗口级面板，切换标签页不会关闭；切换标签页后再点一次扩展图标即可授权当前页，侧边栏保持打开。
- 查域名：扫描当前页文字中的域名，通过 WHOIS/RDAP 查询注册日期，并在页面内生成可拖动、可关闭的结果面板；结果按当前网站缓存。
- 查外链：读取当前网页主机名，在新标签页打开 Ahrefs Backlink Checker。
- 找外链：扫描并高亮当前页的外部链接，在页面浮窗中列出 URL、锚文本、rel、target 和可见性，支持下载 CSV。
- 采集 Google 域名、页脚定位地址及来源、搜索关键词和 `.aitdk-search-result-count-value` 的总结果数；不保存搜索页 URL。
- 对每条普通结果采集 `site`、`page url`、`page title`、`page desc` 及 AITDK 的 `domain created`、`monthly visits`、`avg. visit duration`。
- 还原可解码的 Google 跳转 URL；无法解码时只显示可见地址，不输出 Google 跳转链接，也不猜测目标 URL。
- 图片模块与独立图片结果按页面位置显示一条 `image` 占位；最后三项指标在面板和 Markdown 中显示 `--`，JSON 保持 `null`。
- 面板支持拖动、折叠、刷新、自动观察动态结果和指标、查看 JSON 及复制 Markdown。
- 搜索信息固定为两行，列表单元格最多显示两行，超长内容可在单元格内滚动。

列表和 Markdown 列顺序一致：`#`、`site`、`page url`、`page title`、`page desc`、`domain created`、`monthly visits`、`avg. visit duration`。

## 显示规则

- 最后三个指标列各固定为 `110px`。
- `domain created`：不足一年深蓝色，不足两年浅蓝色，其余黑色。按本地日期周年日计算；2 月 29 日在非闰年按 2 月 28 日计算。
- `monthly visits`：大于 100M 深蓝色；大于 1M 至 100M 浅蓝色；其他黑色。阈值为严格大于，支持 K/M/B、逗号数值和纯数字。
- `page url`：非根路径的内页为蓝色；主页及只带 Query 或 Hash 的根地址为黑色。

## 项目结构

```text
MineTools/
  manifest.json, background.js, popup.*, extension.js, icons/                    # Chrome 直接加载的扩展
  content.js, ahrefs-content.js, domain-content.js, external-links-content.js     # 构建生成的页面脚本
  src/content-script.js, src/ahrefs-content-script.js                             # SERP 采集与 Ahrefs 源码
  src/domain-content-script.js, src/external-links-content-script.js              # 查域名与找外链源码
  scripts/build.mjs                                                               # Node 构建：生成页面脚本，不打 ZIP
  scripts/prepare-preview.mjs, serve-preview.mjs                                  # 本地预览工具
  tests/                                                                          # 包装测试、DOM 测试、布局预览与夹具
  docs/console-script.md                                                          # Console 直接运行源码的说明
  package.json                                                                    # 无第三方依赖的命令入口
```

`content.js` 是受版本控制的生成文件，确保克隆后可直接加载扩展。修改 `src/content-script.js` 后必须执行 `npm run build`，不要手工修改 `content.js`。

## 开发和验证

Node.js 22 或更高版本即可；项目没有依赖，无需 `npm install`。

```powershell
# 从源码生成 Chrome 注入脚本
npm run build

# 语法检查和扩展包装测试
npm run check
npm test

# 一次完成构建、检查和测试
npm run verify

# 本地预览
npm run prepare-preview
npm run preview
```

启动预览后访问 `http://127.0.0.1:8770/tests/layout-preview.html`。`tests/content-script.test.html` 用于验证采集脚本原始 Console 版本；`tests/preview/` 是本地生成的预览输出，不进入 Git。

## 限制

Google 和 AITDK 的 DOM 会变化，地图、购物、AI Overview 等特殊模块没有完整覆盖。真实 Chrome 加载、当前 Google DOM、所有图片布局及系统剪贴板应在实际环境中复核；本地测试不代表这些环境已全部验证。
