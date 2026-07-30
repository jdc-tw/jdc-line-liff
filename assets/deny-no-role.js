/**
 * deny-no-role.js — 看板角色不符時的統一處置（board / stats / hr-stats 共用）。
 *
 * 後端（roles.js gateAction）對「白名單內但角色不符」回 msg='此連結非您的權限範圍。'，
 * 對「不在白名單」回既有的 msg='無權限或連結已失效。'。前者要讓人一眼看懂是拿錯連結，
 * 不要顯示成普通的「載入失敗」。
 *
 * 掛在各頁 jsonp() 的解析出口 ⇒ 一頁只改一處、涵蓋所有 action 呼叫點
 * （只改首屏那個失敗分支的話，頁內按鈕仍會顯示成一般錯誤）。
 *
 * 刻意用覆蓋層而非改寫 document.body：並行中的其他請求 .then 仍會操作 DOM，
 * 把 body 抽掉會讓它們 getElementById 拿到 null 而拋錯（畫面雖對、console 一片紅）。
 */
function denyNoRole(r) {
  if (r && r.msg && String(r.msg).indexOf('權限範圍') >= 0 && !window.__deniedNoRole) {
    window.__deniedNoRole = 1;
    var ov = document.createElement('div');
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#fff;'
      + 'display:flex;align-items:center;justify-content:center;padding:24px;'
      + "font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif");
    ov.innerHTML = '<div style="max-width:460px;text-align:center">'
      + '<div style="font-size:20px;font-weight:700;margin-bottom:12px;color:#ac1535">此連結非您的權限範圍</div>'
      + '<div style="color:#666;font-size:15px;line-height:1.8">請改用您自己的看板連結。<br>'
      + '若確認需要這個看板的權限，請聯絡系統維護者調整。</div></div>';
    document.body.appendChild(ov);
  }
  return r;
}
