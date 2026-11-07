// SeeAPI daily check-in.
// Click "Get 60 Free Credits" to open the Daily Rewards modal, then click "Check In".
(() => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function findElement(textLower) {
    const all = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, div'));
    for (const el of all) {
      if ((el.textContent || '').toLowerCase().includes(textLower)) return el;
    }
    return null;
  }

  async function main() {
    // Step 1: click "Get 60 Free Credits" to open the Daily Rewards modal.
    const trigger = findElement('get 60 free credits') || findElement('free credits');
    if (trigger) {
      trigger.click();
      await sleep(800);
    } else {
      // Fallback: hover the credits display to open the floating window, then click Daily rewards.
      const creditsEl = Array.from(document.querySelectorAll('div, span, button'))
        .find(el => /^\d[\d,]*$/.test((el.textContent || '').trim()) && (el.textContent || '').trim().length <= 10);
      if (creditsEl) {
        creditsEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(600);
        const dailyBtn = findElement('daily reward');
        if (dailyBtn) dailyBtn.click();
        await sleep(800);
      }
    }

    // Step 2: poll for the "Check In" button.
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const all = Array.from(document.querySelectorAll('button, a, [role="button"], .btn'));
      for (const el of all) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === 'check in' || t === 'checkin' || t.includes('check in')) {
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
            return { ok: true, message: '今日已签到（按钮不可用）' };
          }
          el.click();
          return { ok: true, message: `已点击签到：${el.textContent.trim()}` };
        }
      }
    }

    return { ok: false, message: '未找到 Check In 按钮' };
  }

  return main();
})();
