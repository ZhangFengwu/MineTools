import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isGoogleSearch, getSearchTab, openPanel, runDomainCheck, openBacklinkChecker, runExternalLinkScan, runMediaScan, readCurrentExplore, isValidDomain, normalizeDomain } from '../extension.js';

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

test('Domain input accepts bare domains, full URLs, paths and ports', () => {
  for (const value of ['beforequote.com', 'https://beforequote.com/', '  https://beforequote.com/  ', 'http://www.example.com/path?q=1#top', 'https://beforequote.com:8443/', 'EXAMPLE.COM', 'HTTPS://BeforeQuote.COM/']) {
    assert.equal(isValidDomain(value), true, value);
  }
  for (const value of ['', '   ', 'foo', 'https://', 'javascript:alert(1)', 'not_a_domain.com', '-bad.com', 'example..com']) {
    assert.equal(isValidDomain(value), false, value);
  }
  assert.equal(normalizeDomain('https://beforequote.com/'), 'beforequote.com');
  assert.equal(normalizeDomain('http://www.Example.com/a/b?c=d'), 'www.example.com');
  assert.equal(normalizeDomain('beforequote.com/path'), 'beforequote.com');
  assert.equal(normalizeDomain('https://beforequote.com:8443/'), 'beforequote.com');
  assert.equal(normalizeDomain('example.com.'), 'example.com');
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

test('Media sniffer injects its packaged script into the active web page', async () => {
  let received;
  const api = {
    tabs: { query: async () => [{ id: 11, url: 'https://example.com/gallery' }] },
    scripting: { executeScript: async options => { received = options; return [{ frameId: 0, result: { ok: true, count: 5, images: 4, videos: 1 } }]; } }
  };
  assert.deepEqual(await runMediaScan(api), { ok: true, count: 5, images: 4, videos: 1 });
  assert.deepEqual(received, { target: { tabId: 11, allFrames: false }, world: 'ISOLATED', files: ['media-content.js'] });
});

test('Media sniffer asks the page player for YouTube streams before injecting the scanner', async () => {
  const calls = [];
  const api = {
    tabs: { query: async () => [{ id: 12, url: 'https://www.youtube.com/watch?v=x9yop0nYR9g' }] },
    scripting: {
      executeScript: async options => {
        calls.push(options);
        return options.world === 'MAIN'
          ? [{ frameId: 0, result: { ok: true, progressive: 1, adaptive: 2 } }]
          : [{ frameId: 0, result: { ok: true, count: 2, images: 1, videos: 1, audios: 0 } }];
      }
    }
  };
  assert.deepEqual(await runMediaScan(api), { ok: true, count: 2, images: 1, videos: 1, audios: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].world, 'MAIN');
  assert.equal(typeof calls[0].func, 'function');
  assert.deepEqual(calls[1], { target: { tabId: 12, allFrames: false }, world: 'ISOLATED', files: ['media-content.js'] });
  for (const url of ['https://www.youtube.com/shorts/x9yop0nYR9g', 'https://m.youtube.com/watch?v=x9yop0nYR9g']) {
    calls.length = 0;
    api.tabs.query = async () => [{ id: 12, url }];
    await runMediaScan(api);
    assert.equal(calls[0].world, 'MAIN', url);
  }
  for (const url of ['https://example.com/watch?v=a', 'https://notyoutube.com/watch?v=a', 'https://www.youtube.com/feed/subscriptions']) {
    calls.length = 0;
    api.tabs.query = async () => [{ id: 13, url }];
    await runMediaScan(api);
    assert.equal(calls.length, 1, url);
    assert.equal(calls[0].files?.[0], 'media-content.js', url);
  }
});

test('Media sniffer rejects restricted pages and reports injection failures', async () => {
  let injections = 0;
  for (const tabs of [[], [{ id: 1, url: 'chrome://extensions/' }], [{ id: 2, url: 'file:///tmp/page.html' }]]) {
    const api = { tabs: { query: async () => tabs }, scripting: { executeScript: async () => { injections++; } } };
    await assert.rejects(runMediaScan(api), /当前/);
  }
  assert.equal(injections, 0);
  const api = {
    tabs: { query: async () => [{ id: 3, url: 'https://example.com' }] },
    scripting: { executeScript: async () => { throw new Error('Permission revoked'); } }
  };
  await assert.rejects(runMediaScan(api), /无法在当前页嗅探素材/);
  api.scripting.executeScript = async () => [{ frameId: 0 }];
  await assert.rejects(runMediaScan(api), /未返回结果/);
});

test('Trends explore reader captures the active page parameters', async () => {
  const api = {
    tabs: { query: async () => [{ id: 4, url: 'https://trends.google.com/trends/explore?q=AI%20image&date=today%2012-m&geo=US' }] }
  };
  assert.deepEqual(await readCurrentExplore(api), {
    url: 'https://trends.google.com/trends/explore?q=AI%20image&date=today%2012-m&geo=US',
    query: 'AI image',
    params: { q: 'AI image', date: 'today 12-m', geo: 'US' }
  });
});

test('Trends explore reader rejects other hosts and missing tabs', async () => {
  for (const tabs of [[], [{ id: 1, url: 'https://www.google.com/search?q=a' }], [{ id: 2, url: 'chrome://extensions/' }]]) {
    const api = { tabs: { query: async () => tabs } };
    await assert.rejects(readCurrentExplore(api), /trends\.google\.com/);
  }
});

test('MV3 package has all resources and only the intended permissions', async () => {
  const base = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.name, 'MineTools');
  assert.equal(manifest.manifest_version, 3);
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
  assert.deepEqual(manifest.permissions.toSorted(), ['activeTab','clipboardWrite','downloads','scripting','sidePanel','tabs']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  assert.equal(manifest.side_panel.default_path, 'popup.html');
  assert.equal(manifest.action.default_popup, undefined);
  const captureMain = manifest.content_scripts?.find(entry => entry.world === 'MAIN');
  assert.deepEqual(captureMain?.js, ['youtube-capture-main.js']);
  assert.equal(captureMain?.run_at, 'document_start');
  assert.ok(captureMain.matches.includes('https://www.youtube.com/*'));
  const captureBridge = manifest.content_scripts?.find(entry => entry.js?.includes('youtube-capture-bridge.js'));
  assert.equal(captureBridge?.run_at, 'document_start');
  assert.ok(!captureBridge.matches.some(pattern => pattern.includes('example.com')));
  assert.deepEqual(manifest.web_accessible_resources?.[0]?.resources, ['media-merge.js', 'vendor/*']);
  for (const asset of [manifest.side_panel.default_path,'popup.js','popup.css','extension.js','background.js','content.js','domain-content.js','external-links-content.js','media-content.js','media-merge.js','youtube-capture-main.js','youtube-capture-bridge.js','vendor/mp4box.all.mjs','vendor/mp4-muxer.mjs',...Object.values(manifest.icons)]) assert.ok((await stat(new URL(asset, base))).size > 0, asset);
  const background = await readFile(new URL('background.js', base), 'utf8');
  assert.match(background, /chrome\.action\.onClicked\.addListener/);
  assert.match(background, /chrome\.sidePanel\.open\(\{ windowId: tab\.windowId \}\)/);
  assert.match(background, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(background, /chrome\.downloads\.download/);
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
  const media = await readFile(new URL('media-content.js', base), 'utf8');
  assert.ok(media.includes("PANEL_ID = 'minetools-media-panel'"));
  assert.ok(media.includes('minetools-media-download'));
  assert.ok(media.includes('minetools-youtube-data'));
  assert.ok(media.includes('minetools-capture'));
  assert.ok(media.includes('location.reload()'));
  assert.ok(media.includes("mode: 'capture'"));
  assert.ok(media.includes('variants'));
  const extensionSource = await readFile(new URL('extension.js', base), 'utf8');
  assert.ok(extensionSource.includes("'/youtubei/v1/player"));
  assert.ok(extensionSource.includes("clientName: 'ANDROID'"));
  assert.ok(extensionSource.includes('hasAudio'));
  const merge = await readFile(new URL('media-merge.js', base), 'utf8');
  assert.ok(merge.includes("from './vendor/mp4box.all.mjs'"));
  assert.ok(merge.includes("from './vendor/mp4-muxer.mjs'"));
  assert.ok(merge.includes('addVideoChunkRaw'));
  assert.ok(merge.includes('export async function mergeBuffers'));
  assert.ok(merge.includes('export async function remuxAudio'));
  assert.ok(!merge.includes('fetchBuffer'));
  const captureMainScript = await readFile(new URL('youtube-capture-main.js', base), 'utf8');
  assert.ok(captureMainScript.includes('MediaSource'));
  assert.ok(captureMainScript.includes('appendBuffer'));
  assert.ok(captureMainScript.includes('setPlaybackQualityRange'));
  assert.ok(captureMainScript.includes('isTypeSupported'));
  assert.ok(captureMainScript.includes("source: 'minetools-capture'"));
  assert.ok(captureMainScript.includes('loadVideoById'));
  const captureBridgeScript = await readFile(new URL('youtube-capture-bridge.js', base), 'utf8');
  assert.ok(captureBridgeScript.includes("media-merge.js"));
  assert.ok(captureBridgeScript.includes('mergeBuffers'));
  assert.ok(captureBridgeScript.includes('remuxAudio'));
  assert.ok(captureBridgeScript.includes('minetools-capture'));
  const popup = await readFile(new URL('popup.js', base), 'utf8');
  assert.ok(!popup.includes('mergeYouTubeStreams'));
  assert.ok(!popup.includes('minetools-media-merge'));
  const html = await readFile(new URL('popup.html', base), 'utf8');
  assert.match(html, /class="tab active" data-tab="common"/);
  assert.match(html, /id="panel-common" class="panel active"/);
  assert.match(html, /id="domain-run"/);
  assert.match(html, /id="backlink-run"/);
  assert.match(html, /id="links-run"/);
  assert.match(html, /id="media-run"/);
  assert.match(html, /id="explore-save"/);
  assert.match(html, /id="explore-list"/);
  assert.match(html, /id="explore-clear"/);
  assert.ok(!/\son\w+=/i.test(html));
  assert.ok(!/<script[^>]*src=["']https?:/i.test(html));
});
