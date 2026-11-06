// V2EX daily check-in: runs on https://v2ex.com/mission/daily
// Looks for the "领取 X 铜币" button and clicks it.
(() => {
  if (!location.href.includes('/mission/daily')) {
    return { ok: false, message: '不在签到页面' };
  }

  for (const el of document.querySelectorAll('input[type="button"], input[type="submit"], button, a')) {
    const text = el.textContent || el.value || '';
    if (/领取.+铜币/.test(text)) {
      el.click();
      return { ok: true, message: `已点击：${text.trim()}` };
    }
  }

  if (document.body.textContent.includes('已领取')) {
    return { ok: true, message: '今日已签到' };
  }

  return { ok: false, message: '未找到领取按钮' };
})();
