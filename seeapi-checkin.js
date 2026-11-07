// SeeAPI daily check-in.
// 1. Click "Get 60 Free Credits" to open the Daily Rewards modal.
// 2. Find and click "Check In" button.
// 3. Wait for the check-in API to complete before returning.
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
    let btn = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const found = findByText('check in');
      if (found) {
        const t = found.textContent.trim().toLowerCase();
        if (t === 'check in' || t === 'checkin') {
          btn = found;
          break;
        }
        if (t.includes('login')) {
          return { ok: false, message: '未登录，显示 Login to Start Check-In' };
        }
      }
    }

    if (!btn) {
      return { ok: false, message: '未找到 Check In 按钮' };
    }

    // Step 3: click and wait for completion.
    btn.click();

    // Wait for button to become disabled or text to change (API call completed).
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        return { ok: true, message: '签到成功' };
      }
      const t = btn.textContent.trim().toLowerCase();
      if (t !== 'check in' && t !== 'checkin') {
        return { ok: true, message: `签到完成：${btn.textContent.trim()}` };
      }
    }

    return { ok: true, message: '已点击 Check In（等待接口返回超时）' };
  }

  return main();
})();
