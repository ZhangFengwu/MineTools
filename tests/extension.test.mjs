import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isGoogleSearch, getSearchTab, openPanel } from '../extension.js';

test('Google search URL gate accepts regional search pages and rejects unrelated or misleading hosts', () => {
  for (const url of ['https://www.google.com/search?q=ai', 'https://google.com.hk/search/?q=中文', 'https://www.google.co.uk/search?q=tools', 'https://www.google.de/search?q=a']) assert.equal(isGoogleSearch(url), true, url);
  for (const url of ['https://www.google.com.evil.example/search?q=a', 'https://evilgoogle.com/search', 'https://docs.google.com/search', 'https://www.google.com/maps', 'https://www.google.com/', 'chrome://extensions/', 'file:///search', 'javascript:alert(1)', undefined]) assert.equal(isGoogleSearch(url), false, String(url));
});

test('Unsupported or missing tab is rejected before any injection', async () => {
  let injections = 0;
  for (const tabs of [[], [{ id: 1, url: 'chrome://extensions/' }], [{ url: 'https://www.google.com/search' }]]) {
    const api = { tabs: { query: async () => tabs }, scripting: { executeScript: async () => { injections++; } } };
    await assert.rejects(openPanel(api), /Google/);
  }
  assert.equal(injections, 0);
});

test('Opening injects packaged script into the current main frame in the isolated world', async () => {
  let received;
  const api = {
    tabs: { query: async options => { assert.deepEqual(options, {active:true,currentWindow:true}); return [{id:73,url:'https://www.google.com/search?q=test'}]; } },
    scripting: { executeScript: async options => { received = options; return [{frameId:0,result:{ok:true,resultCount:9,metricsContainerCount:3}}]; } }
  };
  assert.equal((await openPanel(api)).resultCount, 9);
  assert.deepEqual(received, {target:{tabId:73,allFrames:false},world:'ISOLATED',files:['content.js']});
});

test('Click rechecks the tab if it changed after popup initialization', async () => {
  let calls = 0;
  const api = { tabs: { query: async () => [{id:1,url:++calls === 1 ? 'https://www.google.com/search?q=a' : 'https://example.com/'}] }, scripting: { executeScript: () => assert.fail('must not inject') } };
  await getSearchTab(api);
  await assert.rejects(openPanel(api), /Google/);
});

test('Injection rejection and absent/failed main-frame response are reported without claiming success', async () => {
  const api = {tabs:{query:async()=>[{id:2,url:'https://www.google.com/search?q=a'}]},scripting:{executeScript:async()=>{throw new Error('Permission revoked');}}};
  await assert.rejects(openPanel(api), /未能打开面板/);
  for (const response of [[], [{frameId:2,result:{ok:true}}], [{frameId:0,result:{ok:false}}], [{frameId:0}]]) {
    api.scripting.executeScript = async () => response;
    await assert.rejects(openPanel(api), /页面尚未准备好/);
  }
});

test('MV3 package has all resources and only the intended permissions', async () => {
  const base = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.name, 'MineTools');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.toSorted(), ['activeTab','clipboardWrite','scripting']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background, undefined);
  for (const asset of [manifest.action.default_popup,'popup.js','popup.css','extension.js','content.js',...Object.values(manifest.icons)]) assert.ok((await stat(new URL(asset, base))).size > 0, asset);
  const source = await readFile(new URL('content.js', base), 'utf8');
  assert.ok(source.includes("const KEY = '__mineToolsPanel'"));
  assert.ok(source.includes('return { ok: true, resultCount: data.resultCount'));
  assert.ok(!source.includes('return api;'));
  const html = await readFile(new URL('popup.html', base), 'utf8');
  assert.ok(!/\son\w+=/i.test(html));
  assert.ok(!/<script[^>]*src=["']https?:/i.test(html));
});
