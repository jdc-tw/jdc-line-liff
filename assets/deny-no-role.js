/**
 * deny-no-role.js — 看板角色不符時的統一處置（board / stats / hr-stats 共用）。
 *
 * 後端（roles.js gateAction）對「白名單內但角色不符」回 `reason:'role_mismatch'`。
 * 這一頁要讓人一眼看懂是拿錯連結，不要顯示成普通的「載入失敗」。
 *
 * 🔴 **2026-09-08：改吃 `reason`，不再比對 `msg` 的文字。**
 *
 * 原本的判準是 `String(r.msg).indexOf('權限範圍') >= 0`。實測 11 種後端可能的措辭，
 * **9 種會讓這道處置靜默消失**（改字、插標點、換行、語意搬進 detail、
 * 換成分流後可能的措辭），前端一行都不用改、測試不會紅、零錯誤訊息。
 *
 * 而反方向更糟：任何**別的**訊息只要含那四個字就會蓋整頁。實測
 * 「若需要更多功能，請聯絡管理員擴大權限範圍。」⇒ **蓋整頁**。
 * 一句本來要幫忙的話會把整頁蓋掉，而那正是 2026-07-30 那次事故的形狀，
 * 只是入口從資料分類換成了文案。
 *
 * ⇒ 根因不是「前端不該比對文案」這條原則，是**文案與語意的需求互相衝突**：
 *   文案必須能為了人而改（後端已經把「角色不符」與「算不出角色」分成兩種處置，
 *   那是對的——那兩種今天共用同一句 `msg`，遲早要分開講），
 *   語意必須穩定。**一個字串沒辦法同時滿足兩者。**
 *
 * ⚠️ **跨 repo 的手動對齊**（形式沿用 tests/welfare-page-wiring.test.js 的既有慣例）：
 *   後端 `jdc-line-gas` line-platform/roles.js `gateAction` 共 8 處拒絕，其中
 *   **3 處帶 `reason`**：兩處送 `role_mismatch`（scoped 分支與 board 分支各一），
 *   一處送 `role_unresolved`；其餘 5 處一個 `reason` 都不帶。
 *   （重算 2026-09-08 於 jdc-line-gas `5593e3d`（＝線上 build `g5593e3d`）：
 *     取 `gateAction` 的行號區間之後
 *     `grep -c "ok: false"` → 8、`grep -c "GATE_REJECT\."` → 3。
 *     ⬛ 對照組：整支 roles.js 的 `ok: false` 是 9（多的那一個在 `gateDenial`）
 *        ——兩個數字相同就代表區間沒有取到，這條重算等於沒做。
 *     ⚠️ **行號會漂，所以這裡刻意不寫行號**：拿代號與分支名當判準。）
 *   前端 `jdc-line-liff` 本檔 DENY_REASON_ROLE_MISMATCH
 *     → 必須與 `role_mismatch` 這個字面值相同
 *   **兩邊各有測試釘住自己那半，沒有任何機械的東西逼兩邊相等。**
 *   只改一邊，兩邊的測試都會綠，而整頁遮罩靜靜不再出現。
 *   ⇒ 要改這個代號時，同一次改動要同時動兩個 repo。這段字就是提醒本身。
 *
 * 🔴🔴 **上線順序不可換**：①後端加 `reason`、`msg` 一個字不動（前端看不見新欄位，
 *   零風險）→ ②本檔這一改 → ③後端才可以改 `msg`。
 *   反過來做＝三頁的整頁遮罩靜默失效，而兩邊的測試都會綠。
 *
 * ✅ **第 ① 步已完成**：jdc-line-gas `d1cb688`，已在 main（`5593e3d`）上、線上
 *   build `g5593e3d`。它比原訂**多修一處**——`reason` 原本只在 `gateAction` 的
 *   回傳值上，送進瀏覽器的信封是另一個物件；現在兩個出口（`Code.js` 的 JSONP
 *   出口、`batch.js` 的逐支結果）共用 `gateDenial()`。
 *   ⚠️ 本段上一版寫「出口只有一處」，那是**漏數的**，已更正。
 *
 * ✅ **線上實測過了**（2026-09-08，另一台一手打線上，唯讀、零副作用）：
 *     ⬛ 零點  不帶憑證  getHrPending    鍵 ['msg','ok']           沒有 reason
 *        受測  activity  getHrPending    鍵 ['msg','ok','reason']  role_mismatch
 *     ⬛ 對照  activity  listActivities  ok:true（證明那把憑證是活的）
 *   ⚠️ 對照組原本指定 `getCompareLists`，那是壞的——它註冊為 `admin`，
 *      會與受測項**因同一個無關原因一起被拒**，讀起來卻完全正常。換成
 *      `listActivities` 才有鑑別力。挑對照組要問的是「它會不會因為別的理由陪葬」。
 *
 * ⚠️ **這道處置吃得到的只有「外層信封」，吃不到 batch 的子結果**（2026-09-08 實測）：
 *   三頁的首載走 `jsonp('batch', …)`，而 `denyNoRole` 掛在解析出口、看的是**外層**。
 *   `batch` 這支 action 本身標 `'any'` ⇒ **任何有效的看板身分外層都會過**，
 *   角色不符只會落在 `results.<子action>` 那一層，而那一層不經過本檔。
 *   實測（跑後端真的 `gateAction` ＋ `gateDenial`，含必須 PASS 的對照組）：
 *     activity token → `batch`        ⇒ PASS（外層不擋）
 *     activity token → `getHrPending` ⇒ `role_mismatch`（在子結果裡）
 *     welfare  token → `batch`        ⇒ `role_mismatch`（scoped 分支不吃 `'any'` 通吃）
 *   ⇒ 會蓋整頁的是**外層就被擋**的情形（受限身分、或無效 token 那五個不帶 reason 的點）。
 *     board 身分角色不符時本檔不會動作；子結果被擋之後畫面長什麼樣由各張卡片決定。
 *   🔴 **這不是本次改動造成的**：舊的文案比對讀的是同一個外層信封，涵蓋範圍一樣。
 *      寫在這裡是因為它界定了這道處置**管得到什麼**，不是待辦、也不要順手在這一次改。
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
/** 後端 roles.js 對「白名單內但角色不符」送出的代號。跨 repo 對齊，見檔頭。 */
var DENY_REASON_ROLE_MISMATCH = 'role_mismatch';

function denyNoRole(r) {
  // 任何一支成功＝有權進這一頁
  if (r && r.ok) { window.__pageHasData = 1; return r; }

  if (r && r.reason === DENY_REASON_ROLE_MISMATCH && !window.__deniedNoRole) {
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
