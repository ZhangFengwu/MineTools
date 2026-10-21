// Test harness for rendering the packaged side panel in an ordinary browser tab.
const previewMode = new URL(location.href).searchParams.get('mode');
window.chrome = {
  runtime: { getURL: path => `../../src/${path}` },
  tabs: {
    query: async () => [{ id: 1, url: previewMode === 'unsupported' ? 'https://example.com/' : 'https://www.google.com/search?q=AI+image+upscaler' }],
    create: async options => { window.__previewCreatedTab = options.url; return { id: 2 }; },
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} }
  },
  scripting: { executeScript: async () => {
    if (previewMode === 'failure') throw new Error('Test injection failure');
    return [{ frameId: 0, result: { ok: true, resultCount: 6, metricsContainerCount: 4, count: 12, total: 15 } }];
  } }
};
