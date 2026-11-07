// SeeAPI daily check-in.
// The "Daily rewards" button lives inside the Credits modal, which may need to be opened first.
(() => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Find an element whose visible text contains both "daily" and "rewards" (case-insensitive).
  function findDailyRewards() {
    const all = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, div'));
    for (const el of all) {
      const t = (el.textContent || '').toLowerCase();
      if (t.includes('daily') && t.includes('reward')) return el;
    }
    return null;
  }

  // Try to open the Credits modal by clicking the credits display in the top-right.
  async function tryOpenCreditsModal() {
    const candidates = Array.from(document.querySelectorAll('div, span, button, a'))
      .filter(el => {
        const t = (el.textContent || '').trim();
        return /^\d[\d,]*$/.test(t) && t.length <= 10;
      });
    for (const el of candidates) {
      el.click();
      await sleep(800);
      if (findDailyRewards()) return true;
    }
    return false;
  }

  async function main() {
    // Step 1: look for Daily rewards — it may already be visible if the Credits modal auto-opens.
    let btn = findDailyRewards();

    // Step 2: if not found, try opening the Credits modal.
    if (!btn) {
      const opened = await tryOpenCreditsModal();
      if (!opened) {
        btn = findDailyRewards(); // one more try after potential DOM update
      }
    }

    if (!btn) {
      // Debug: report what clickable elements exist on the page.
      const samples = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .slice(0, 5)
        .map(el => `"${(el.textContent || '').trim().substring(0, 40)}"`);
      return { ok: false, message: `未找到 Daily rewards 入口。页面可点击元素: ${samples.join(', ')}` };
    }

    btn.click();
    await sleep(600);

    // Step 3: poll for the "Check In" button inside the Daily Rewards modal.
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const all = Array.from(document.querySelectorAll('button, a, [role="button"], .btn'));
      for (const el of all) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === 'check in' || t === 'checkin' || t.includes('check in')) {
          // Skip if clearly disabled or already claimed.
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
            return { ok: true, message: '今日已签到（按钮不可用）' };
          }
          el.click();
          return { ok: true, message: `已点击签到：${el.textContent.trim()}` };
        }
      }
    }

    return { ok: false, message: '已打开 Daily rewards，但未找到 Check In 按钮' };
  }

  return main();
})();
