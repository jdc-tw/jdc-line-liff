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

/**
 * 讀取請求的序列佇列——同頁最多一支 /exec 在飛。
 *
 * 為何需要（2026-08-19）：「不並行」原本是一條要人記得的規則，而現況有三處
 * 違反（admin.html 兩支 seed、attend.html 兩支、stats.html 報到分頁的
 * stLoad()+bcPreview()）——每一處都是後來的人不記得規則。改成用了就成立的機制。
 *
 * ⚠️ 呼叫約定：fn 回的 Promise 必須在「網路回應 → 拆包 → 全部加密寫入完成」
 * 之後才 resolve。提早 resolve 的話，下一支排隊任務會讀到還沒落地的舊狀態、
 * 重複發送同一個請求。
 *
 * 只管讀取。寫入（jsonpW）刻意不排隊——那是使用者按了按鈕在等的動作，
 * 排在背景讀取後面會讓他覺得按鈕壞了。
 */
var GAS_TAIL = Promise.resolve();
function queueRead(fn) {
  var p = GAS_TAIL.then(fn, fn);      // 前一支成敗都往下走，不讓失敗卡住整條
  GAS_TAIL = p.catch(function () { });  // 尾巴永遠 resolved，避免 unhandled rejection
  return p;
}

/**
 * 撤銷時蓋上全頁覆蓋層。
 *
 * 放這裡不放 deny-no-role.js：那支只被 board/stats/hr-stats 載入，attend.html 沒有它。
 * 四頁都會載入本模組，放這裡才涵蓋得完整。
 *
 * ⚠️ 不延遲。deny-no-role 的 2.5 秒延遲是為了處理「附屬 action 被擋、主功能其實有權」；
 * 權威驗證請求被拒沒有這個歧義，要立即遮蔽——底下的畫面上有 153 人的姓名與意見。
 * 用覆蓋層不改寫 document.body：並行中的 .then 仍會操作 DOM，抽掉 body 會讓它們拿到 null。
 */
function revokedOverlay() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('jdc-revoked')) return;
  var ov = document.createElement('div');
  ov.id = 'jdc-revoked';
  ov.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#fff;'
    + 'display:flex;align-items:center;justify-content:center;padding:24px;'
    + "font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif");
  ov.innerHTML = '<div style="max-width:460px;text-align:center">'
    + '<div style="font-size:20px;font-weight:700;margin-bottom:12px;color:#ac1535">連結已失效</div>'
    + '<div style="color:#666;font-size:15px;line-height:1.8">這條看板連結已經停用。<br>'
    + '請聯絡系統維護者取得新的連結。</div></div>';
  document.body.appendChild(ov);
}

/**
 * 權威驗證請求回來之後的統一處置。撤銷時做完五件事：
 * 清持久快取 → 清記憶體 → （呼叫端負責丟棄第二發並停送 fallback）→ 蓋覆蓋層 → 停止寫入。
 */
function handleVerdict(token, resp) {
  var v = cacheVerdict(resp);
  if (v !== 'revoked') return Promise.resolve(v);
  return cacheClear(token).then(function () {
    cacheRevoke();
    revokedOverlay();
    return 'revoked';
  });
}

function isRevoked() { return _revoked; }

/**
 * 台北時區的當前西元年。
 * ⚠️ 不可用 new Date().getFullYear()——那跟著裝置時區走，跨年夜會與後端差一年。
 * 後端 getSeniorNotice 對空 year 的預設就是 Asia/Taipei 的當年（Code.js:3782），
 * 前端算出同一個數字送過去，回應完全相同、零行為變更。
 */
function currentTaipeiYear(nowMs) {
  var d = (typeof nowMs === 'number') ? new Date(nowMs) : new Date();
  return Number(new Intl.DateTimeFormat('en-CA',
    { timeZone: 'Asia/Taipei', year: 'numeric' }).format(d));
}

/** 離線時附在 meta 列的一句話。時間取該筆快取的 savedAt。 */
function offlineLabel(savedAt) {
  var d = new Date(savedAt);
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return '離線·資料停在 ' + (d.getMonth() + 1) + '/' + d.getDate()
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/**
 * 報到分頁要不要發請求、發哪幾支。純函式，才測得到——三條分支很容易寫反，
 * 而寫反的後果（多送一支／用到存檔版範本）在畫面上都不會報錯。
 *
 * ⚠️ 第二發還在飛時一律回「等」，不可直接拿它的 preview 切片：那份是用 tpl=''
 * 抓的存檔版，tpl 非空的呼叫者拿去用，畫面算的就跟他眼前輸入框裡的文字不同——
 * 而這一支的下游是「137 則 LINE 要發什麼內容」。
 */
function planCheckinBundle(st) {
  if (st.verdict === 'revoked' || st.verdict === 'offline') return { wait: false, send: [] };
  if (st.secondPending) return { wait: true, send: null };
  var send = [];
  if (!st.stationsCached) send.push('listStaffStations');
  if (!(st.tpl === '' && st.previewUsable)) send.push('previewPassBroadcast');
  return { wait: false, send: send };
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
  queueRead: queueRead,
  revokedOverlay: revokedOverlay,
  handleVerdict: handleVerdict,
  isRevoked: isRevoked,
  offlineLabel: offlineLabel,
  currentTaipeiYear: currentTaipeiYear,
  planCheckinBundle: planCheckinBundle,
  __setStoreForTest: __setStoreForTest,
  __setCryptoForTest: __setCryptoForTest,
  __resetForTest: __resetForTest
};
