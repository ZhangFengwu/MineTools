const NURTURE_TASKS = {
  v2ex: { name: 'V2EX 签到', url: 'https://v2ex.com/mission/daily', script: 'v2ex-checkin.js' },
  seeapi: { name: 'SeeAPI 签到', url: 'https://www.seeapi.com/', script: 'seeapi-checkin.js' }
};

export async function runCheckin(browserAPI, site, onLog) {
  const task = NURTURE_TASKS[site];
  if (!task) throw new Error(`未知任务：${site}`);

  const log = msg => onLog?.(`[${stamp()}] ${msg}`);
  let tabId;
  try {
    log(`打开 ${task.name}…`);
    const tab = await browserAPI.tabs.create({ url: task.url, active: false });
    tabId = tab.id;

    log('等待页面加载…');
    await waitForTab(browserAPI, tabId);

    log('执行签到脚本…');
    const results = await browserAPI.scripting.executeScript({
      target: { tabId },
      files: [task.script]
    });
    const result = results?.[0]?.result;

    if (result?.ok) {
      log(`✅ ${result.message}`);
    } else {
      log(`❌ ${result?.message || '签到失败'}`);
    }

    return result || { ok: false, message: '脚本未返回结果' };
  } finally {
    if (tabId != null) {
      try { await browserAPI.tabs.remove(tabId); } catch {}
    }
  }
}

function stamp() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function waitForTab(browserAPI, tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browserAPI.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        browserAPI.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    browserAPI.tabs.onUpdated.addListener(listener);
  });
}
