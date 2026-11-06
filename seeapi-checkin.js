// SeeAPI daily check-in.
// Phase 1 (default): find "Daily rewards" link on homepage, click it,
//   then poll for the check-in button on the next page.
// Phase 2 (data-phase="button"): directly find and click the check-in button.
(() => {
  const phase = document.currentScript?.dataset?.phase || 'full';

  function findClickable(text) {
    const lower = text.toLowerCase();
    const all = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], .btn'));
    for (const el of all) {
      if (el.textContent.toLowerCase().trim() === lower) return el;
    }
    for (const el of all) {
      if (el.textContent.toLowerCase().includes(lower)) return el;
    }
    return null;
  }

  function findCheckinButton() {
    const keywords = ['签到', 'check in', 'check-in', 'claim', '领取', '打卡'];
    const all = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], .btn'));
    for (const kw of keywords) {
      for (const el of all) {
        const t = (el.textContent || '').toLowerCase();
        if (t.includes(kw) && !t.includes('已签') && !t.includes('already')) return el;
      }
    }
    return null;
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function fullPhase() {
    const link = findClickable('daily rewards') || findClickable('Daily Rewards');
    if (!link) return { ok: false, message: '未找到 Daily rewards 入口' };

    link.click();

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const btn = findCheckinButton();
      if (btn) {
        btn.click();
        return { ok: true, message: `已点击签到：${btn.textContent.trim()}` };
      }
    }
    return { ok: false, message: '已点击 Daily rewards，但未找到签到按钮' };
  }

  async function buttonPhase() {
    const btn = findCheckinButton();
    if (btn) {
      btn.click();
      return { ok: true, message: `已点击签到：${btn.textContent.trim()}` };
    }
    return { ok: false, message: '未找到签到按钮' };
  }

  return phase === 'button' ? buttonPhase() : fullPhase();
})();
