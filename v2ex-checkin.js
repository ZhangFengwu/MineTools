// V2EX daily check-in: runs on https://v2ex.com/mission/daily
// Looks for the "领取 X 铜币" button, clicks it, waits for completion.
(async () => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  if (!location.href.includes('/mission/daily')) {
    return { ok: false, message: '不在签到页面' };
  }

  function findClaimButton() {
    return Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a'))
      .find(el => /领取.+铜币/.test(el.textContent || el.value || ''));
  }

  const btn = findClaimButton();
  if (!btn) {
    if (document.body.textContent.includes('已领取')) {
      return { ok: true, message: '今日已签到' };
    }
    return { ok: false, message: '未找到领取按钮' };
  }

  btn.click();

  // Wait for button to disappear (page reload or DOM update after check-in).
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (!findClaimButton()) {
      return { ok: true, message: '签到成功' };
    }
  }

  return { ok: true, message: '已点击领取（等待完成超时）' };
})();
