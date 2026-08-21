/** 掃描頁純邏輯（staff.html 與 node --test 共用）。 */
function parseChkCode(text, actId) {
  var parts = String(text || '').split('|');
  if (parts.length !== 4 || parts[0] !== 'CHK') return { ok: false, reason: 'format' };
  if (parts[1] !== actId) return { ok: false, reason: 'wrongAct' };
  return { ok: true, empNo: parts[2] };
}

/** SHA-256 → 小寫 hex（瀏覽器與 Node 19+ 都有 globalThis.crypto.subtle）。 */
async function sha256Hex(text) {
  var buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

/**
 * 掃描 reducer：快照比對＋本地去重＋佇列。
 * state = { seen: {hash:true}, queue: [{hash, ts}] }；snapshot = {hash: person}
 * person.checked＝快照下載時就已報到（別台機器掃的）→ 一樣視為重複。
 */
function applyScan(state, hash, snapshot, nowMs) {
  var person = snapshot[hash];
  if (!person) return { state: state, verdict: { type: 'unknown' } };
  if (state.seen[hash] || person.checked) {
    return { state: state, verdict: { type: 'dup', person: person } };
  }
  var seen = Object.assign({}, state.seen); seen[hash] = true;
  var queue = state.queue.concat([{ hash: hash, ts: nowMs }]);
  return { state: { seen: seen, queue: queue }, verdict: { type: 'ok', person: person } };
}

/**
 * 已掃名單（hash 集合）的存取。storage 由呼叫端注入——瀏覽器傳 localStorage，
 * 測試傳假的；不注入就只能在真瀏覽器裡驗，而這一段正是 2026-08-21 那個缺陷的修法本體。
 *
 * 缺陷長相：state.seen 原本只活在記憶體，快照的 person.checked 又是下載當下的凍結值。
 * 重新整理後兩者一起失憶 → 同一個人再掃一次被判成 ok → 畫面說「已受理」，
 * 看起來就像他剛剛才報到成功。資料由後端冪等擋住，**壞的只有畫面，而畫面是操作員唯一的依據**。
 */
function seenLoad(storage, key) {
  try {
    var v = JSON.parse(storage.getItem(key) || '{}');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (_) { return {}; }
}
function seenSave(storage, key, seen) {
  try { storage.setItem(key, JSON.stringify(seen || {})); return true; } catch (_) { return false; }
}

/** 後端回的全場已報到員編併入 seen（跨站防重）。empToHash 查不到的略過——沒有 hash 就對不上快照。 */
function seenMerge(seen, allChecked, empToHash) {
  var out = Object.assign({}, seen || {});
  (allChecked || []).forEach(function (emp) {
    var h = empToHash[emp];
    if (h) out[h] = true;
  });
  return out;
}

/**
 * 這一格影格解到的碼要不要送去判定？（2026-08-21 修）
 *
 * 三種情況要略過：
 *  1. 沒解到碼。
 *  2. **停留中且是同一張碼**——人還站在鏡頭前，不該重複觸發。
 *  3. 不在停留中、但同一張碼且距上次不到 2.5 秒——原本就有的防連發。
 *
 * ⚠️ **不同的碼一律放行，即使還在停留中。** 先前寫成「停留期間整個不讀影格」，
 * 後果是下一位的碼被靜默吞掉：操作員把碼對上去、畫面毫無反應，沒盯著螢幕就會
 * 以為掃過了而走人——那個人沒報到，且沒有任何地方留下痕跡。
 * 卡片被下一個人換掉不是問題，那正是要的行為；要擋的只有同一張碼重複觸發。
 *
 * @param {string} data 這格解到的碼（空字串／null＝沒解到）
 * @param {string} lastText 上一次處理過的碼
 * @param {number} lastAt 上一次處理的時刻
 * @param {number} holdUntil 判定卡停留到什麼時候
 * @param {number} now 現在
 */
function shouldHandleCode(data, lastText, lastAt, holdUntil, now) {
  if (!data) return false;
  if (data !== lastText) return true;          // 不同的人＝立刻接手，停留中也一樣
  if (now < holdUntil) return false;           // 同一張碼＋停留中＝人還在鏡頭前
  return now - lastAt > 2500;                  // 同一張碼＋已離開停留期＝原有的防連發
}

/**
 * 掃描節流與解碼解析度（2026-08-21）。
 *
 * 為何存在：原本 loop() 跟著 requestAnimationFrame 跑，每一格都對相機的**全解析度**
 * （getUserMedia 要 ideal 1280 → 實際多為 1280×720）做 getImageData ＋ jsQR。
 * 實測每格 9.1ms（jsQR 佔 8.4ms），乘上 60Hz ＝ **每秒 546ms 的 JS 工作、
 * 一整顆核心的一半，持續不斷**。使用者的回報是「iPhone 像在錄影」——機身發燙、耗電，
 * 那不是 iOS 的指示燈，是真的在燒 CPU。六台跑一整晚會很難看。
 *
 * 掃 QR 不需要每秒 60 次：人把碼遞到鏡頭前至少停留半秒，12 次/秒綽綽有餘。
 * 也不需要 720p：jsQR 在 640 寬只要 2.1ms（快 4.1 倍），而 25 模組的 QR 佔畫面 1/3 時，
 * 640 寬仍有約 8 px/模組，遠高於 jsQR 需要的 2–3 px。
 * 兩者相乘約可省 95% 的 JS 工作量。
 */
var SCAN_INTERVAL_MS = 80;   // ≒ 12.5 次/秒
var SCAN_MAX_W = 640;        // 解碼用的畫布上限寬；相機本身仍以原解析度顯示

/** 這一格要不要真的解碼？（節流；第一次 lastScanAt=0 一定放行） */
function shouldScanNow(now, lastScanAt, intervalMs) {
  return (now - lastScanAt) >= (intervalMs || SCAN_INTERVAL_MS);
}

/**
 * 解碼畫布的尺寸：等比縮到不超過 maxW，**不放大**（相機比 maxW 還小就照原樣，
 * 放大只是多花時間、不會多出任何細節）。維持長寬比，避免 QR 被壓扁而解不出來。
 */
function scanCanvasSize(vw, vh, maxW) {
  var w = Number(vw) || 0, h = Number(vh) || 0;
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  var limit = maxW || SCAN_MAX_W;
  if (w <= limit) return { w: w, h: h };
  var scale = limit / w;
  return { w: limit, h: Math.max(1, Math.round(h * scale)) };
}

function chunkByLen(rows, maxLen) {
  var packs = [], cur = [];
  for (var i = 0; i < rows.length; i++) {
    var trial = cur.concat([rows[i]]);
    if (encodeURIComponent(JSON.stringify(trial)).length > maxLen && cur.length) {
      packs.push(cur); cur = [rows[i]];
    } else cur = trial;
  }
  if (cur.length) packs.push(cur);
  return packs;
}

function searchNames(nameTable, query) {
  var q = String(query || '').replace(/[\s　]+/g, ''); if (!q) return [];
  var out = [];
  for (var k in nameTable) {
    var p = nameTable[k];
    if (p.name && p.name.replace(/[\s　]+/g, '').indexOf(q) !== -1) out.push(p);
    if (out.length >= 20) break;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { parseChkCode, sha256Hex, applyScan, chunkByLen, searchNames, seenLoad, seenSave, seenMerge, shouldHandleCode,
  shouldScanNow, scanCanvasSize, SCAN_INTERVAL_MS, SCAN_MAX_W };
