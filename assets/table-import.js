/** 桌次貼上匯入純邏輯（stats.html 與 node --test 共用）。 */

/**
 * 解析 Excel 貼上的「姓名／桌次」兩欄文字。
 * tab 或連續空白（含全形空白）分隔；跳過空行與「姓名 桌次」表頭；只有一欄→table 給空字串。
 * @returns {Array<{name:string, table:string}>}
 */
function parseTablePaste(text) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var t = line.trim();
    if (!t) return;
    // Excel 貼上是 tab 分隔→只切 tab（保留名內空白如「王 瑩」）；手打才退回空白切
    var m = t.indexOf('\t') >= 0 ? t.split(/\t+/) : t.split(/[　\s]+/);
    var name = (m[0] || '').trim();
    var table = (m.slice(1).join('') || '').trim();
    if (!name) return;
    if (name === '姓名' && (table === '桌次' || table === '')) return; // 表頭
    out.push({ name: name, table: table });
  });
  return out;
}

/** 姓名正規化：去掉所有空白（半形/全形），比對鍵一致（名冊有「王 瑩」）。 */
function normName_(s) { return String(s || '').replace(/[\s　]+/g, ''); }

/**
 * 依姓名把貼上列比對到參加者。
 * @param {Array<{name,table}>} parsed
 * @param {Array<{userId,name,unit,table}>} people 該活動出席=參加的回覆列
 * @returns {{writes:Array<{userId,table}>, unmatched:Array<{name,table}>, ambiguous:Array<{name,table,candidates}>}}
 */
function matchByName(parsed, people) {
  var byName = {};
  people.forEach(function (p) {
    var k = normName_(p.name);
    (byName[k] = byName[k] || []).push(p);
  });
  var writes = [], unmatched = [], ambiguous = [];
  parsed.forEach(function (row) {
    var hits = byName[normName_(row.name)] || [];
    if (hits.length === 1) writes.push({ userId: hits[0].userId, table: row.table });
    else if (hits.length === 0) unmatched.push(row);
    else ambiguous.push({ name: row.name, table: row.table, candidates: hits });
  });
  return { writes: writes, unmatched: unmatched, ambiguous: ambiguous };
}

/** 只留與現值不同的寫入（currentMap = {userId: 現桌次}）。 */
function diffWrites(writes, currentMap) {
  return writes.filter(function (w) {
    return String(w.table || '') !== String(currentMap[w.userId] == null ? '' : currentMap[w.userId]);
  });
}

if (typeof module !== 'undefined') module.exports = { parseTablePaste, matchByName, diffWrites };
