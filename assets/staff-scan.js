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

if (typeof module !== 'undefined') module.exports = { parseChkCode, sha256Hex, applyScan, chunkByLen, searchNames, seenLoad, seenSave, seenMerge };
