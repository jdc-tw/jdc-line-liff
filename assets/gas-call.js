/**
 * gas-call.js — **全站**呼叫 GAS 的傳輸層。
 *
 * 🔴 這不是福委會專屬的東西。既有八頁各自 inline 一份（7 種實作），
 *    本檔是它們未來的共同去處；**但本案不動那八頁**（語意差異：空參數過濾／
 *    錯誤加工／重試策略，其中 stats.html 的重試刻意只對讀取生效，
 *    註解寫明「這裡再重試會疊成雙重、有重複送出風險」），
 *    只保證「不再增加第 9 份」。遷移是另一件事，另一筆待辦。
 * ⚠️ 本檔取代的是「在 welfare.html 再 inline 一份」的做法——
 *    welfare 是它的第一個使用者，不是第 9 份拷貝。
 *
 * 🔴 **保留「傳輸失敗」與「伺服器說不行」的區別。**
 *    既有 `jsonp` 的最後一個 `.catch()` 把兩者都 resolve 成 `{ok:false, msg}`，
 *    呼叫端**分不出來**——而對「寄驗證碼」這兩件事的處置完全相反：
 *      伺服器說不行 → 沒寄出，可以重按
 *      傳輸失敗     → **可能已經寄出**，畫面說「失敗」會讓她一直重按
 *    所以本函式失敗時多回一個 `transport:true|false`。
 *
 * ⚠️ **逾時用 `Promise.race` 不用 `AbortController`**（照抄既有 `jsonp` 的理由）：
 *    iOS 12.1 以前沒有 `AbortController`，`new AbortController()` 會直接
 *    `ReferenceError`，讓整段初始化同步當掉 → 畫面永遠停在「載入中」且不顯示錯誤。
 *
 * ⚠️ **第四個參數是毫秒數（number），不是 options 物件。**
 *    既有 `jsonp` 也是這個形狀，傳物件進去會被 `setTimeout` 轉成 `NaN`＝**0ms**
 *    ⇒ 請求立刻逾時。（2026-08-25 第三輪審查抓到本計畫犯過這個。）
 *
 * @returns {Promise} **永遠 resolve，不 reject**——呼叫端一律在 .then() 裡分辨。
 *          成功 `{ok:true, …}`；失敗 `{ok:false, transport:boolean, msg}`。
 */
function gasCall(gasUrl, action, params, timeoutMs) {
  var qs = Object.keys(params || {})
    .filter(function (k) { return params[k] !== ''; })
    .map(function (k) { return '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('');
  var timer;
  var timeout = new Promise(function (_, rej) {
    timer = setTimeout(function () {
      var e = new Error('timeout'); e.name = 'AbortError'; rej(e);
    }, timeoutMs || 30000);
  });
  // 🔴 **POST，參數走 body 不走網址**（2026-09-02）。兩個理由：
  //   ① **網址會進存取紀錄** ⇒ 走 GET 的話，`saveWelfareTemplate` 的 `text`
  //      ——她寫給全公司的公告全文——**逐字進 Google 的 log**。
  //   ② **長度**：實測一則滿長度（1500 字）中文範本的網址是 **14,702 字元**
  //      （中文 URL 編碼後一個字變九個）。body 沒有這個限制。
  //
  // ⚠️ **Content-Type 只能用 CORS 安全清單裡的**（`application/x-www-form-urlencoded`
  //    或 `text/plain`），否則會觸發 preflight，而 GAS 不回應 OPTIONS。
  //    ⚠️ 而且**必須是表單編碼**：用 `text/plain` 的話 GAS 會把內容放進
  //    `e.postData.contents`，`e.parameter` 是空的——而後端只讀 `e.parameter`
  //    ⇒ 症狀是「每一支 action 都說參數缺失」，不是報錯。
  //
  // 🔴 **刻意沒有 GET fallback。** 一條從來沒被走過的退路，跟不存在的退路，
  //    在測試結果上完全相同；而它還讓「同一個呼叫有兩種送法」變成要維護的分歧。
  //    退路是 git：POST 那個 commit 獨立，上線不通就 revert 並重新部署。
  var body = 'action=' + encodeURIComponent(action) + qs + '&callback=cb';
  return Promise.race([timeout,
    fetch(gasUrl,
          { method: 'POST', credentials: 'omit', redirect: 'follow',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var a = t.indexOf('('), b = t.lastIndexOf(')');
        if (a === -1 || b === -1) throw new Error('bad');
        return JSON.parse(t.slice(a + 1, b));
      })])
    .then(function (v) {
      clearTimeout(timer);
      // 🔴 **明確補上 transport:false**，不要留成 undefined。
      //    契約說失敗時回 `transport:boolean`；若伺服器拒絕時它是 undefined，
      //    下一個呼叫端照契約寫 `r.transport === false` 就會落不到那條分支。
      //    （2026-08-25 第四輪審查抓到：原本直接 `return v`。）
      if (v && v.ok !== true) v.transport = false;
      return v;
    })
    .catch(function (e) {
      clearTimeout(timer);
      // 🔴 走到這裡＝**請求送出去了但沒拿到答案**，不是「伺服器說不行」。
      return { ok: false, transport: true,
               msg: (e && e.name === 'AbortError')
                 ? '連線逾時（伺服器可能還在處理）。' : '連線失敗。' };
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gasCall };
}
