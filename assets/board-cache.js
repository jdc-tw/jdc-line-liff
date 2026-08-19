/**
 * board-cache.js — 四個看板頁共用的持久快取、讀取佇列與撤銷遮蔽。
 *
 * 為何存在（2026-08-19）：GAS /exec 往返固定 1.7–2.1 秒且與資料量無關（實測），
 * 所以「只傳異動」省不到時間。唯一有效的是「不發請求就先把畫面畫出來」。
 * 原本四頁都有 SWR，但存在 sessionStorage——關掉分頁就清空，所以每次開頁都白等。
 *
 * 設計文件：yu-agent docs/superpowers/specs/2026-08-19-board-cache-prefetch-design.md
 *
 * 純函式（本段）刻意不碰 localStorage / WebCrypto，才測得到；
 * I/O 層在後段，用 __setStoreForTest / __setCryptoForTest 換掉外部依賴。
 */

var BOARD_CACHE_VERSION = 'v1';
var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 快取過期了嗎。
 * 剛好 7 天不算過期（用 > 不用 >=）；savedAt 不是有限數字一律當過期，
 * 因為那代表資料損毀或格式舊了，讀進來只會在 render 時炸掉。
 */
function cacheExpired(savedAt, now) {
  if (typeof savedAt !== 'number' || !isFinite(savedAt)) return true;
  return (now - savedAt) > CACHE_TTL_MS;
}

/**
 * 權威驗證請求的回應該怎麼處置快取。
 *
 * ⚠️ 用前綴比對，不可用完全相等：全站有四種離線字串變體
 * （hr-stats.html:73 那句沒有「伺服器喚醒中」，board.html 有一句只有「連線失敗」）。
 * 完全相等比對會讓 hr-stats 整頁判不出離線。
 *
 * ⚠️ 回 'ok' 的意思是「不需要對快取做任何事」，不是「請求成功」。
 * 角色不符（此連結非您的權限範圍）刻意歸在這裡——2026-07-30 的線上事故就是
 * 「看到權限訊息就蓋整頁」，害雅慧的人事看板因一支附屬 action 被擋而整頁消失。
 */
function cacheVerdict(resp) {
  if (resp && resp.ok === true) return 'ok';
  var msg = String((resp && resp.msg) || '');
  if (msg.indexOf('連線逾時') === 0 || msg.indexOf('連線失敗') === 0) return 'offline';
  if (msg.indexOf('無權限或連結已失效') === 0) return 'revoked';
  return 'ok';
}

/** 快取名稱建構器。跨檔案的契約集中在這裡，各處引用、不要自己組字串。 */
var N = {
  checkinOptions: 'getCheckinOptions',
  checkinPending: 'getCheckinPending',
  hrPending: 'getHrPending',
  anniversaries: 'getAnniversaries',
  rosterList: 'getRosterList',
  hrNotices: 'listHrNotices',
  options: 'listOptions',
  activities: 'listActivities',
  hrStats: 'getHrStats',
  activityStats: function (act) { return 'getActivityStats:' + (act || ''); },
  seating: function (actId) { return 'getSeatingBoard:' + actId; },
  stations: function (actId) { return 'listStaffStations:' + actId; },
  senior: function (year) { return 'getSeniorNotice:' + year; },
  attend: function (actId) { return 'attend:' + actId; }
};

/**
 * 一支切片該存成什麼名稱；回 null ＝ 這支不存。
 *
 * ⚠️ 名稱一律由 params（送出時實際用的參數）算，**不得從回應反推**——
 * batch 回應只有「action → 回傳值」，不帶回 actId，硬猜會把不同活動存成同一個名稱。
 */
function nameOfSlice(action, slice, params) {
  var p = params || {};
  switch (action) {
    case 'previewPassBroadcast': return null;   // 恆不落地，見設計 3.3.3
    case 'getActivityStats':     return N.activityStats(p.act);
    case 'getSeatingBoard':      return N.seating(p.actId);
    case 'listStaffStations':    return N.stations(p.actId);
    case 'getSeniorNotice':      return N.senior(p.year);
    case 'getCheckinOptions':    return N.checkinOptions;
    case 'getCheckinPending':    return N.checkinPending;
    case 'getHrPending':         return N.hrPending;
    case 'getAnniversaries':     return N.anniversaries;
    case 'getRosterList':        return N.rosterList;
    case 'listHrNotices':        return N.hrNotices;
    case 'listOptions':          return N.options;
    case 'listActivities':       return N.activities;
    case 'getHrStats':           return N.hrStats;
  }
  return null;   // 不認得就不存
}

if (typeof module !== 'undefined') module.exports = {
  BOARD_CACHE_VERSION: BOARD_CACHE_VERSION,
  CACHE_TTL_MS: CACHE_TTL_MS,
  cacheExpired: cacheExpired,
  cacheVerdict: cacheVerdict,
  N: N,
  nameOfSlice: nameOfSlice
};
