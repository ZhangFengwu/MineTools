import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isGoogleSearch, getSearchTab, openPanel, runDomainCheck, openBacklinkChecker, runExternalLinkScan } from '../extension.js';

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

test('Domain checker injects its packaged script into the active web page', async () => {
  let received;
  const api = {
    tabs: { query: async () => [{ id: 42, url: 'https://example.com/article' }] },
    scripting: { executeScript: async options => { received = options; return [{ frameId: 0 }]; } }
  };
  await runDomainCheck(api);
  assert.deepEqual(received, { target: { tabId: 42, allFrames: false }, world: 'ISOLATED', files: ['domain-content.js'] });
});

test('Domain checker rejects restricted pages and reports injection failures', async () => {
  let injections = 0;
  for (const tabs of [[], [{ id: 1, url: 'chrome://extensions/' }], [{ id: 2, url: 'file:///tmp/page.html' }]]) {
    const api = { tabs: { query: async () => tabs }, scripting: { executeScript: async () => { injections++; } } };
    await assert.rejects(runDomainCheck(api), /当前/);
  }
  assert.equal(injections, 0);
  const api = {
    tabs: { query: async () => [{ id: 3, url: 'https://example.com' }] },
    scripting: { executeScript: async () => { throw new Error('Permission revoked'); } }
  };
  await assert.rejects(runDomainCheck(api), /无法在当前页执行查域名/);
});

test('Backlink checker opens Ahrefs for the active page hostname', async () => {
  let created;
  const api = {
    tabs: {
      query: async () => [{ id: 5, url: 'https://www.example.com/article?q=1' }],
      create: async options => { created = options; return { id: 9 }; }
    }
  };
  assert.equal(await openBacklinkChecker(api), 'www.example.com');
  assert.deepEqual(created, { url: 'https://ahrefs.com/backlink-checker?input=www.example.com&mode=subdomains' });
});

test('Backlink checker rejects pages without a web hostname', async () => {
  for (const tabs of [[], [{ id: 1, url: 'chrome://extensions/' }], [{ id: 2 }]]) {
    const api = { tabs: { query: async () => tabs, create: () => assert.fail('must not open a tab') } };
    await assert.rejects(openBacklinkChecker(api), /当前页域名/);
  }
});

test('External link scanner injects its packaged script into the active web page', async () => {
  let received;
  const api = {
    tabs: { query: async () => [{ id: 8, url: 'https://example.com/post' }] },
    scripting: { executeScript: async options => { received = options; return [{ frameId: 0, result: { ok: true, count: 3, total: 4 } }]; } }
  };
  assert.deepEqual(await runExternalLinkScan(api), { ok: true, count: 3, total: 4 });
  assert.deepEqual(received, { target: { tabId: 8, allFrames: false }, world: 'ISOLATED', files: ['external-links-content.js'] });
});

test('External link scanner rejects restricted pages and reports injection failures', async () => {
  let injections = 0;
  for (const tabs of [[], [{ id: 1, url: 'chrome://extensions/' }], [{ id: 2, url: 'file:///tmp/page.html' }]]) {
    const api = { tabs: { query: async () => tabs }, scripting: { executeScript: async () => { injections++; } } };
    await assert.rejects(runExternalLinkScan(api), /当前/);
  }
  assert.equal(injections, 0);
  const api = {
    tabs: { query: async () => [{ id: 3, url: 'https://example.com' }] },
    scripting: { executeScript: async () => { throw new Error('Permission revoked'); } }
  };
  await assert.rejects(runExternalLinkScan(api), /无法在当前页执行找外链/);
  api.scripting.executeScript = async () => [{ frameId: 0 }];
  await assert.rejects(runExternalLinkScan(api), /未返回结果/);
});

test('MV3 package has all resources and only the intended permissions', async () => {
  const base = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.name, 'MineTools');
  assert.equal(manifest.manifest_version, 3);
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
  assert.deepEqual(manifest.permissions.toSorted(), ['activeTab','clipboardWrite','scripting','sidePanel']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  assert.equal(manifest.side_panel.default_path, 'popup.html');
  assert.equal(manifest.action.default_popup, undefined);
  for (const asset of [manifest.side_panel.default_path,'popup.js','popup.css','extension.js','background.js','content.js','domain-content.js','external-links-content.js',...Object.values(manifest.icons)]) assert.ok((await stat(new URL(asset, base))).size > 0, asset);
  const background = await readFile(new URL('background.js', base), 'utf8');
  assert.match(background, /chrome\.action\.onClicked\.addListener/);
  assert.match(background, /chrome\.sidePanel\.open\(\{ windowId: tab\.windowId \}\)/);
  const source = await readFile(new URL('content.js', base), 'utf8');
  assert.ok(source.includes("const KEY = '__mineToolsPanel'"));
  assert.ok(source.includes('return { ok: true, resultCount: data.resultCount'));
  assert.ok(!source.includes('return api;'));
  const domain = await readFile(new URL('domain-content.js', base), 'utf8');
  assert.ok(domain.includes("PANEL_ID = 'checkdomain-panel'"));
  assert.ok(domain.includes('whois.freeaiapi.xyz'));
  assert.ok(!domain.trimStart().startsWith('javascript:'));
  const externalLinks = await readFile(new URL('external-links-content.js', base), 'utf8');
  assert.ok(externalLinks.includes("PANEL_ID = 'minetools-external-links-panel'"));
  assert.ok(externalLinks.includes('data-minetools-external-link'));
  const html = await readFile(new URL('popup.html', base), 'utf8');
  assert.match(html, /class="tab active" data-tab="common"/);
  assert.match(html, /id="panel-common" class="panel active"/);
  assert.match(html, /id="domain-run"/);
  assert.match(html, /id="backlink-run"/);
  assert.match(html, /id="links-run"/);
  assert.ok(!/\son\w+=/i.test(html));
  assert.ok(!/<script[^>]*src=["']https?:/i.test(html));
});
