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
 * ⚠️ 為什麼要延遲判定（2026-07-30 線上事故）：
 * 第一版只要看到「權限範圍」就立刻蓋整頁。結果雅慧（hr 角色）開 board.html 時，
 * 頁內附屬的年資里程碑卡呼叫了一支被誤標成 activity 的 action → 那一支被擋 →
 * **整個人事看板被蓋掉**，她主功能其實是有權的。
 * 修法有兩層：①把那支 action 歸類修對（roles.js）②這裡改成「等一下再判斷」——
 * 只要這段時間內有任何一支 action 成功回來，就代表她有權進這一頁，只是某個附屬功能
 * 被擋，不該蓋整頁。分類表再怎麼修，附屬功能被擋也不該讓整頁消失。
 *
 * 刻意用覆蓋層而非改寫 document.body：並行中的其他請求 .then 仍會操作 DOM，
 * 把 body 抽掉會讓它們 getElementById 拿到 null 而拋錯（畫面雖對、console 一片紅）。
 */
function denyNoRole(r) {
  // 任何一支成功＝有權進這一頁
  if (r && r.ok) { window.__pageHasData = 1; return r; }

  if (r && r.msg && String(r.msg).indexOf('權限範圍') >= 0 && !window.__deniedNoRole) {
    window.__deniedNoRole = 1;   // 只排一次，避免多支同時被擋排出多個計時器
    setTimeout(function () {
      if (window.__pageHasData) return;   // 期間有成功回應 → 只是附屬功能被擋，不蓋整頁
      var ov = document.createElement('div');
      ov.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#fff;'
        + 'display:flex;align-items:center;justify-content:center;padding:24px;'
        + "font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif");
      ov.innerHTML = '<div style="max-width:460px;text-align:center">'
        + '<div style="font-size:20px;font-weight:700;margin-bottom:12px;color:#ac1535">此連結非您的權限範圍</div>'
        + '<div style="color:#666;font-size:15px;line-height:1.8">請改用您自己的看板連結。<br>'
        + '若確認需要這個看板的權限，請聯絡系統維護者調整。</div></div>';
      document.body.appendChild(ov);
    }, 2500);   // 涵蓋 GAS 固定 2–4s 往返：主功能那支要來得及回來
  }
  return r;
}
