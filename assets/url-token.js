/**
 * 網址參數取值：**全站唯一一支**（E2 的準備，2026-09-12）。
 *
 * ══ 為何抽出來 ═══════════════════════════════════════════════════════
 *
 * 拆網址亂碼（階段五）要改 7 頁的「token 從哪裡來」。盤點時實測，這件事在
 * 那 7 頁有**四種不同寫法、沒有任何一支共用函式**：
 *
 *   ① `function q(k){…new RegExp('[?&]'+k+'=([^&]+)')…}`  attend／hr-stats／stats／
 *                                                          checkin／wall／welfare 各抄一份
 *   ② `function getToken(){…/[?&]t=([^&]+)/…}`             board／verify
 *   ③ 直接 `location.search.match(/[?&]t=([^&]+)/)`        admin
 *   ④ `new URLSearchParams(location.search).get('t')`      staff／messages
 *
 * 🔴 **同一個判斷散在四種形狀，改來源時就會漏掉其中幾處**，而漏掉的症狀是
 *    那幾頁**靜靜地繼續走舊路**——畫面正常、測試全綠、沒有任何一行 diff 顯示它。
 *    先抽成一支，之後換來源就只有一個地方要改。
 *
 * ⚠️ **這一輪只抽、只有 `board.html` 在用**（E1a）。其餘 6 頁維持原樣，
 *    那是 E1b 的事。**不要順手改它們**——那會讓一次試跑變成六頁同時上線。
 *
 * ⚠️ 行為要與被取代的那幾支**逐字相同**，包含它們的怪癖：
 *    · 取不到一律回空字串 `''`，不是 null／undefined（呼叫端都直接拿去用）
 *    · 值要 `decodeURIComponent`
 *    · ⚠️ `+` **不還原成空白**——四種舊寫法沒有一種有還原，跟著不還原。
 *      （`URLSearchParams` 會還原，所以 ④ 那兩頁本來就與其他頁行為不同；
 *       這裡取多數、並在這裡寫明，而不是讓它繼續是個沒人知道的差異。）
 */
(function (root) {
  /**
   * @param {string} name 參數名
   * @param {string} [search] 預設 `location.search`（測試才會自己傳）
   * @returns {string} 取不到回空字串
   */
  function urlParam(name, search) {
    var s = search;
    if (s == null) s = (typeof location !== 'undefined' && location.search) || '';
    s = String(s);
    // 參數名逐字比對：名字裡若有正則保留字元，不可以讓它變成樣式。
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var m = s.match(new RegExp('[?&]' + esc + '=([^&]*)'));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  /** 授權用的那一串（`?t=`）。**全站只有這一個名字**。 */
  function urlToken(search) { return urlParam('t', search); }

  var api = { urlParam: urlParam, urlToken: urlToken };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.urlParam = urlParam; root.urlToken = urlToken; }
})(typeof window !== 'undefined' ? window : this);
