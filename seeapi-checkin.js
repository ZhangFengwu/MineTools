// SeeAPI daily check-in.
// The Daily Rewards modal auto-opens on page load. Just find and click "Check In".
(() => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function main() {
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const all = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const el of all) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === 'check in' || t === 'checkin') {
          el.click();
          return { ok: true, message: '已点击 Check In' };
        }
      }
    }
    return { ok: false, message: '未找到 Check In 按钮（可能未登录）' };
  }

  return main();
})();
