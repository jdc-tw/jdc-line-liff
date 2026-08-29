/**
 * welfare-client.js — 福委會頁的瀏覽器端純函式。
 *
 * 🔴 **`fnv8` / `isHexSelection` / `encodeSelection` 三支與
 *    `jdc-line-gas/line-platform/welfare.js` 逐字相同**，且刻意不依賴任何環境 API
 *    （沒有 Buffer、沒有 Utilities、沒有 TextEncoder）。
 *    兩個 repo 沒有共用模組的機制，只能各放一份；
 *    `tests/fixtures/selection-vectors.json` 兩邊也是同一份，
 *    任何一邊改了編碼而沒改另一邊，向量測試會在那一邊先紅。
 *
 * 雙環境：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 * （`assets/*.js` 沒有自動 shim，這段 export 是手寫的，形狀照抄 messages-view.js。）
 */

/**
 * FNV-1a 32bit → 8 個十六進位字元。
 *
 * ⚠️ 逐 **UTF-16 code unit** 取值（`charCodeAt`），與 LINE emoji 的 index 單位一致。
 * ⚠️ 這一段程式碼在 `jdc-line-gas/line-platform/welfare.js` **有逐字相同的一份**。
 */
function fnv8(s) {
  var h = 0x811c9dc5;
  var t = String(s == null ? '' : s);
  for (var i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/** 勾選字串的格式檢查。偶數長度的小寫 hex；空字串合法（＝一個都沒勾）。 */
function isHexSelection(s) {
  return typeof s === 'string' && s.length % 2 === 0 && /^[0-9a-f]*$/.test(s);
}

/**
 * 勾選 → hex bitmap。位元順序＝rows 的順序（canonical order）。
 *
 * 🔴 **用 hex 不用 base64**：GAS 的 `Utilities.base64Encode` 收的是 Java 有號 Byte[]，
 *    而全選時大量位元組是 255，會不會被接受在本機證明不了（node 走 Buffer 那條永遠綠）。
 *    而且瀏覽器端也要編碼，Buffer 與 Utilities 兩邊都沒有。
 *    hex 不依賴任何環境 API，三個執行環境逐字同一份程式碼。
 */
function encodeSelection(rows, pickedEmpNos) {
  var want = {};
  (pickedEmpNos || []).forEach(function (e) { want[String(e)] = 1; });
  var bytes = [];
  (rows || []).forEach(function (r, i) {
    var b = i >> 3;
    if (bytes[b] === undefined) bytes[b] = 0;
    if (want[String(r.empNo)]) bytes[b] |= (1 << (i & 7));
  });
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] || 0).toString(16)).slice(-2);
  return out;
}

// 🔴 gasCall 不在本檔——它是**全站的傳輸層**，見 `assets/gas-call.js`。
//    本檔只放「福委會這一頁專屬的純函式」。

/**
 * 每次點擊產生的一次性識別。用途是讓傳輸層重送不會變成第二次發送
 * （`doGet` 對帶 nonce 的呼叫會重播第一次的結果）。
 * `crypto.randomUUID` 在舊 Safari 沒有，退回時間戳＋亂數即可——
 * 這不是安全用途，只要「同一次點擊同一個值、不同點擊不同值」。
 */
function newNonce() {
  try { if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID(); } catch (e) {}
  return 'n' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fnv8, isHexSelection, encodeSelection, newNonce };
}
