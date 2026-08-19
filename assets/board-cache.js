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

// ── I/O 層 ────────────────────────────────────────────────────────────────
// 外部依賴（localStorage / WebCrypto）走這兩個變數，測試才換得掉。
// 沒有 store（隱私模式）或沒有 subtle（非 secure context）時，整個模組
// 退化成「永遠沒有快取」——頁面回到現行行為，不會壞，只是不快。
var _store = (typeof localStorage !== 'undefined') ? localStorage : null;
var _subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
var _mem = {};        // bootstrap 解出來的記憶體副本
var _revoked = false;
var _fpCache = {};    // token → 指紋，避免同一頁重複算 SHA-256

function _hex(buf) {
  var out = '', v = new Uint8Array(buf), i;
  for (i = 0; i < v.length; i++) out += ('0' + v[i].toString(16)).slice(-2);
  return out;
}

/** token 的指紋：SHA-256 前 12 個 hex。用來隔離不同人的快取。 */
function cacheFingerprint(token) {
  if (_fpCache[token]) return Promise.resolve(_fpCache[token]);
  if (!_subtle) return Promise.resolve('');
  var bytes = new TextEncoder().encode(String(token));
  return _subtle.digest('SHA-256', bytes).then(function (d) {
    var fp = _hex(d).slice(0, 12);
    _fpCache[token] = fp;
    return fp;
  });
}

function _keyOf(token) {
  var bytes = new TextEncoder().encode(String(token));
  return _subtle.digest('SHA-256', bytes).then(function (d) {
    return _subtle.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  });
}

function _prefix(fp) { return 'jdcBoard:' + BOARD_CACHE_VERSION + ':' + fp + ':'; }

function _keysWithPrefix(pre) {
  var out = [], i;
  if (!_store) return out;
  for (i = 0; i < _store.length; i++) {
    var k = _store.key(i);
    if (k && k.indexOf(pre) === 0) out.push(k);
  }
  return out;
}

/**
 * 加密後寫入。obj.ok !== true 一律不寫，也不覆蓋既有的成功快取——
 * 存一個 {ok:false} 七天，等於讓下次開頁「秒顯一個錯誤畫面」，比慢還糟。
 * 回 Promise，且必須在加密真正落地之後才 resolve（佇列的「輪到自己時重讀快取」靠它）。
 */
function cacheSave(token, name, obj) {
  if (_revoked || !_store || !_subtle) return Promise.resolve();
  if (!obj || obj.ok !== true) return Promise.resolve();
  var payload = JSON.stringify({ value: obj, savedAt: Date.now() });
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return Promise.all([cacheFingerprint(token), _keyOf(token)]).then(function (r) {
    return _subtle.encrypt({ name: 'AES-GCM', iv: iv }, r[1], new TextEncoder().encode(payload))
      .then(function (ct) {
        var packed = _hex(iv) + '.' + _hex(ct);
        try { _store.setItem(_prefix(r[0]) + name, packed); } catch (e) { /* 滿額或被停用：略過 */ }
      });
  }).catch(function () { /* 加密失敗不影響畫面 */ });
}

/**
 * 開頁時一次把該指紋的全部快取解密成記憶體 map。
 * 解不開／缺時間戳／過期的，邊解邊刪，不留無法使用的殘骸。
 * nowMs 只給測試用（Node 沒辦法把系統時鐘往前撥）。
 */
function cacheBootstrap(token, nowMs) {
  _mem = {};
  if (!_store || !_subtle) return Promise.resolve(_mem);
  var now = (typeof nowMs === 'number') ? nowMs : Date.now();
  return Promise.all([cacheFingerprint(token), _keyOf(token)]).then(function (r) {
    var pre = _prefix(r[0]), key = r[1];
    var jobs = _keysWithPrefix(pre).map(function (k) {
      var name = k.slice(pre.length);
      var packed = String(_store.getItem(k) || '');
      var dot = packed.indexOf('.');
      if (dot < 0) { _store.removeItem(k); return Promise.resolve(); }
      var iv = _unhex(packed.slice(0, dot));
      var ct = _unhex(packed.slice(dot + 1));
      return _subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function (pt) {
        var rec = JSON.parse(new TextDecoder().decode(pt));
        if (cacheExpired(rec && rec.savedAt, now)) { _store.removeItem(k); return; }
        _mem[name] = { value: rec.value, savedAt: rec.savedAt };
      }).catch(function () { _store.removeItem(k); });
    });
    return Promise.all(jobs);
  }).then(function () { return _mem; })
    .catch(function () { return _mem; });
}

function _unhex(s) {
  var out = new Uint8Array(s.length / 2), i;
  for (i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** 從 bootstrap 的結果同步取用。已撤銷時一律回 null。 */
function cacheGet(name) {
  if (_revoked) return null;
  return _mem[name] || null;
}

/** 只清當前指紋。撤銷用這支，不用 cacheClearAll——別人的 token 的快取不該被牽連。 */
function cacheClear(token) {
  if (!_store) return Promise.resolve();
  return cacheFingerprint(token).then(function (fp) {
    _keysWithPrefix(_prefix(fp)).forEach(function (k) { _store.removeItem(k); });
    _mem = {};
  });
}

/** 清所有 jdcBoard: 鍵。只給人工清理用，撤銷路徑不要呼叫它。 */
function cacheClearAll() {
  if (!_store) return;
  _keysWithPrefix('jdcBoard:').forEach(function (k) { _store.removeItem(k); });
  _mem = {};
}

/** 標記已撤銷：記憶體清空、之後 cacheGet 恆 null、cacheSave 變空操作。 */
function cacheRevoke() { _revoked = true; _mem = {}; }

/**
 * batch 回應的唯一存檔路徑。
 *
 * 為何不讓呼叫端自己取切片存：cacheSave 的守門只看它拿到的那個物件的 ok，
 * 外層整包丟進去就會過關，裡面的 {ok:false} 被夾帶著存七天。把拆包收在這裡，
 * 呼叫端拿不到犯這個錯的機會。
 *
 * 參數從 requestItems（送出的 list）拿，不從回應——後端 buildBatchResults 只回
 * 「action → 回傳值」，不帶回 actId/year/tpl。
 */
function persistBatchSlices(token, envelope, requestItems, nameOf) {
  if (!envelope || envelope.ok !== true || !envelope.results) return Promise.resolve();
  var byAction = {};
  (requestItems || []).forEach(function (it) { if (it && it.a) byAction[it.a] = it.p || {}; });
  var jobs = [];
  Object.keys(envelope.results).forEach(function (a) {
    var slice = envelope.results[a];
    var name = nameOf(a, slice, byAction[a] || {});
    if (name) jobs.push(cacheSave(token, name, slice));
  });
  return Promise.all(jobs).then(function () { });
}

function __setStoreForTest(s) { _store = s; _mem = {}; _revoked = false; _fpCache = {}; }
function __setCryptoForTest(c) { _subtle = c; _fpCache = {}; }
function __resetForTest() {
  _store = (typeof localStorage !== 'undefined') ? localStorage : null;
  _subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  _mem = {}; _revoked = false; _fpCache = {};
}

if (typeof module !== 'undefined') module.exports = {
  BOARD_CACHE_VERSION: BOARD_CACHE_VERSION,
  CACHE_TTL_MS: CACHE_TTL_MS,
  cacheExpired: cacheExpired,
  cacheVerdict: cacheVerdict,
  N: N,
  nameOfSlice: nameOfSlice,
  cacheFingerprint: cacheFingerprint,
  cacheBootstrap: cacheBootstrap,
  cacheGet: cacheGet,
  cacheSave: cacheSave,
  cacheClear: cacheClear,
  cacheClearAll: cacheClearAll,
  cacheRevoke: cacheRevoke,
  persistBatchSlices: persistBatchSlices,
  __setStoreForTest: __setStoreForTest,
  __setCryptoForTest: __setCryptoForTest,
  __resetForTest: __resetForTest
};
