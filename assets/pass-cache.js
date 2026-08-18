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
function passCacheUsable(rec, urlV) {
  if (!rec || !rec.res || !rec.res.published) return false;
  if (!urlV) return true;
  return rec.v === urlV;
}

if (typeof module !== 'undefined') module.exports = { PASS_CK, passCacheKey, passCacheUsable };
