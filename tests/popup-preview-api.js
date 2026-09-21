// Test harness for rendering the packaged popup in an ordinary browser tab.
const previewMode = new URL(location.href).searchParams.get('mode');
window.chrome = {
  tabs: { query: async () => [{ id: 1, url: previewMode === 'unsupported' ? 'https://example.com/' : 'https://www.google.com/search?q=AI+image+upscaler' }] },
  scripting: { executeScript: async () => {
    if (previewMode === 'failure') throw new Error('Test injection failure');
    return [{ frameId: 0, result: { ok: true, resultCount: 6, metricsContainerCount: 4 } }];
  } }
};
window.close = () => {
  document.getElementById('status').textContent = '测试通过：成功注入后关闭扩展弹窗。';
  document.body.dataset.testClosed = 'true';
};
