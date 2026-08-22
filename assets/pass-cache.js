/**
 * pass-cache.js — 通行證（?mode=pass）的本機快取判斷。
 *
 * 為何存在（2026-08-18）：getEventCheckinPass 實測 5–7 秒（GAS 冷啟更久），而它回的
 * 東西——報到碼、姓名、桌次、活動名——在桌次發佈之後就不再變動。整包存進 localStorage
 * 之後，從圖文選單進來 **0 次 GAS 呼叫**、QR 秒出。
 *
 * 失效是**推送式**的，手機端不主動去問。每次開頁都背景重抓一次的作法被否決了：
 * 那等於 137 支手機替一件幾乎不會發生的事付錢。改成連結帶 `&v=<桌次>`
 * （後端 passPageUrl 組）——桌次真的改了，承辦人在看板按「重新發佈」再「補發給特定人」，
 * 他收到的新連結 v 不同，這裡才重抓那一次。
 *
 * 判斷邏輯抽成獨立模組是為了測得到：三條分支很容易寫反，而寫反的後果
 * （永遠不失效／每次都重抓）在畫面上都不會報錯。
 */

var PASS_CK = 'jdcPass:';

/** 快取鍵。act 可省略（伺服器挑場次），那種情況統一歸在 'auto'。 */
function passCacheKey(userId, act) { return PASS_CK + userId + ':' + (act || 'auto'); }

/**
 * 快取能不能直接用？
 * - 網址沒帶 v（圖文選單那顆常駐鈕）→ 有快取就用，**永不重抓**。
 * - 帶了 v 且與存下來的相同（同一則通知重複點開）→ 用快取。
 * - 帶了 v 但不同 → 桌次動過了，重抓。
 *
 * 只有 published 的快取算數：未發佈本來就不該有 QR 可秀，存了也不能用。
 *
 * @param {{v:string,res:Object}|null} rec 讀出來的快取
 * @param {string} urlV 網址上的 v（沒有就是空字串）
 */
function passCacheUsable(rec, urlV, todayStr) {
  if (!rec || !rec.res || !rec.res.published) return false;
  if (passCacheExpired(rec, todayStr)) return false;
  if (!urlV) return true;
  return rec.v === urlV;
}

/**
 * 活動已經過去了嗎（2026-08-22 補）。
 *
 * 為何非有不可：上面那條「網址沒帶 v → 永不重抓」對**同一場活動**是對的，
 * 但圖文選單那顆是**常駐**按鈕、跨場次都是同一個網址（`:auto` 鍵），
 * 於是活動結束後它永遠不會失效——8/28 之後按圖文選單的人會一直看到
 * 年中聚餐的桌號與 QR，一路看到尾牙。
 *
 * 這個缺陷本來就在，但 2026-08-22 讓通知連結也寫 `auto` 鍵之後，
 * 從「只有用過圖文選單的人」放大成「點過連結的所有人」，所以必須一起補。
 *
 * 判準用**活動日期**不用寫入時間戳：活動當天仍要能用（`<` 不是 `<=`），
 * 隔天就該重抓。日期格式是後端 `fmtActDate_` 的 `yyyy/MM/dd`，補零後
 * 字串比大小即等於日期比大小。
 *
 * `todayStr` 沒帶就不判——舊呼叫端與既有測試維持原行為；真正的呼叫端只有
 * `startPass` 一處，它一定要帶，故另有接線測試盯著。
 */
function passCacheExpired(rec, todayStr) {
  var ev = rec && rec.res && rec.res.activity && rec.res.activity.eventDate;
  if (!ev || !todayStr) return false;
  return String(ev) < String(todayStr);
}

/** 今天（手機當地時區）的 `yyyy/MM/dd`。刻意不用 padStart——這頁要吃得下舊 iOS。 */
function passToday(d) {
  var t = d || new Date();
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return t.getFullYear() + '/' + p2(t.getMonth() + 1) + '/' + p2(t.getDate());
}

/**
 * 沒命中的**原因**（2026-08-21 補）。字串會寫進飛行紀錄，`?diag=1` 看得到。
 *
 * 為何需要：8/21 實測證明 localStorage 沒被清（飛行紀錄六輪都在），所以「快取不見」
 * 一定是這三個原因之一——但當時的儀器只記到 `③ getProfile OK` 就斷了，看不出是哪個。
 * 三個原因的修法完全不同：沒寫進去 vs 存的是未發佈那份 vs 桌次動過而重抓。
 *
 * 最後那條「（其實可用）」正常永遠不會出現——它只會在本函式與 passCacheUsable
 * 判斷不一致時冒出來，等於一條免費的自我對照。看到它就是這兩支已經分歧了。
 */
function passCacheMissReason(rec, urlV, todayStr) {
  if (!rec) return '無快取';
  if (!rec.res) return '快取殘缺';
  if (!rec.res.published) return '存的是未發佈那份';
  if (passCacheExpired(rec, todayStr)) return '活動已過去';
  if (urlV && rec.v !== urlV) return 'v 不同(桌次動過)';
  return '（其實可用）';
}

if (typeof module !== 'undefined') module.exports = { PASS_CK, passCacheKey, passCacheUsable, passCacheMissReason, passCacheExpired, passToday };
