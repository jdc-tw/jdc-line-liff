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

if (typeof module !== 'undefined') module.exports = { parseChkCode, sha256Hex, applyScan };
