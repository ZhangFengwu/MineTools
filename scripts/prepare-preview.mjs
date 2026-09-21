// Local UI preview only. These mock browser APIs are never included in MineTools.
import { readFile, writeFile } from 'node:fs/promises';
const here = new URL('./', import.meta.url);
let fixture = await readFile(new URL('../tests/content-script.test.html', here), 'utf8');
fixture = fixture.replaceAll('__googleSerpExporter', '__mineToolsPanel')
  .replaceAll('google-serp-exporter-panel', 'minetools-panel')
  .replaceAll('../src/content-script.js', '../../content.js')
  .replaceAll('Google SERP Exporter 验证', 'MineTools 采集脚本验证');
await writeFile(new URL('../tests/preview/content-preview.html', here), fixture);
let popup = await readFile(new URL('../popup.html', here), 'utf8');
popup = popup.replace('href="popup.css"', 'href="../../popup.css"')
  .replace('src="popup.js"', 'src="../../popup.js"')
  .replace('src="icons/', 'src="../../icons/')
  .replace('<script src="../../popup.js"', '<script src="../popup-preview-api.js"></script>\n  <script src="../../popup.js"');
await writeFile(new URL('../tests/preview/popup-preview.html', here), popup);
console.log('Prepared local previews; mock APIs are outside the extension directory.');
