# Console 脚本

`src/content-script.js` 是 MineTools 的原始 Console 脚本。将其完整内容粘贴到 Google 普通网页搜索结果页的开发者工具 Console 中即可运行，不依赖扩展安装。

它直接读取页面中由 AITDK 插入的 DOM，不请求外部 API。重复运行会替换旧面板；同页动态加载的结果或指标会由观察器自动更新。

运行后可在页面上下文使用：

```js
window.__googleSerpExporter.data
window.__googleSerpExporter.refresh()
window.__googleSerpExporter.toMarkdown()
window.__googleSerpExporter.destroy()
```

Chrome 扩展版本由 `npm run build` 从这个源码生成 `content.js`。构建版本运行在 Chrome 隔离世界，API 名称变为 `window.__mineToolsPanel`，并返回可序列化结果给扩展 Popup。
