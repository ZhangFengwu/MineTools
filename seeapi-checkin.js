// SeeAPI daily check-in.
// 1. Click "Get 60 Free Credits" to open the Daily Rewards modal.
// 2. Find and click "Check In" button.
(() => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function findByText(lower) {
    const all = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const el of all) {
      if ((el.textContent || '').toLowerCase().includes(lower)) return el;
    }
    return null;
  }

  async function main() {
    // Step 1: open the Daily Rewards modal.
    const trigger = findByText('get 60 free credits') || findByText('free credits') || findByText('daily reward');
    if (trigger) {
      trigger.click();
    } else {
      return { ok: false, message: '未找到 Get 60 Free Credits 按钮' };
    }

    // Step 2: wait for modal and find Check In button.
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const btn = findByText('check in');
      if (btn) {
        // Distinguish "Check In" from "Login to Start Check-In".
        const t = btn.textContent.trim();
        if (t.toLowerCase() === 'check in' || t.toLowerCase() === 'checkin') {
          btn.click();
          return { ok: true, message: '已点击 Check In' };
        }
        if (t.toLowerCase().includes('login')) {
          return { ok: false, message: '未登录，显示 Login to Start Check-In' };
        }
      }
    }
    return { ok: false, message: '未找到 Check In 按钮' };
  }

  return main();
})();
