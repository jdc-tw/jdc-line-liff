// 員工名冊寬表 pivot（純函式：瀏覽器 board.html 下載用＋node 測試用）
// rosterRows＝getRosterList().rows、optRows＝listOptions().rows、todayStr＝'yyyy/MM/dd'
// 回傳 AOA：header＝序號＋單位欄（選項主檔列序·總公司前工地後）＋右上 metadata；
// 只列在職；名冊有但主檔沒有的單位排最後；首資料列尾帶員工總人數。
function buildRosterWide(rosterRows, optRows, todayStr) {
  var active = (rosterRows || []).filter(function (o) { return o.status !== '離職'; });
  var byUnit = {};
  active.forEach(function (o) {
    var u = String(o.unit || '').trim() || '（未填單位）';
    (byUnit[u] = byUnit[u] || []).push(o.name);
  });
  var unitOpts = (optRows || []).filter(function (o) { return o.type === '單位'; });
  var ordered = unitOpts.filter(function (o) { return o.group === '總公司'; })
    .concat(unitOpts.filter(function (o) { return o.group !== '總公司'; }))
    .map(function (o) { return o.name; });
  var units = ordered.filter(function (u) { return byUnit[u]; });
  Object.keys(byUnit).forEach(function (u) { if (units.indexOf(u) < 0) units.push(u); });
  var depth = units.reduce(function (m, u) { return Math.max(m, byUnit[u].length); }, 0);
  var aoa = [['序號'].concat(units).concat(['', '員工名冊更新日期', todayStr])];
  for (var r = 0; r < depth; r++) {
    var line = [r + 1].concat(units.map(function (u) { return byUnit[u][r] || ''; }));
    if (r === 0) line = line.concat(['', '員工總人數', active.length]);
    aoa.push(line);
  }
  return aoa;
}
// 員工名冊逐人明細（直表）：每人一列 員編/姓名/單位/職稱，單位序同寬表（選項主檔·總公司前工地後）、
// 只列在職、右上 metadata 同寬表。與 buildRosterWide 同一份輸入，各自一種下載格式。
function buildRosterFlat(rosterRows, optRows, todayStr) {
  var active = (rosterRows || []).filter(function (o) { return o.status !== '離職'; });
  var unitOpts = (optRows || []).filter(function (o) { return o.type === '單位'; });
  var ordered = unitOpts.filter(function (o) { return o.group === '總公司'; })
    .concat(unitOpts.filter(function (o) { return o.group !== '總公司'; }))
    .map(function (o) { return o.name; });
  var unitOf = function (o) { return String(o.unit || '').trim() || '（未填單位）'; };
  var rank = function (o) { var i = ordered.indexOf(unitOf(o)); return i < 0 ? ordered.length : i; };
  var sorted = active.map(function (o, i) { return { o: o, i: i }; })
    .sort(function (a, b) { return (rank(a.o) - rank(b.o)) || (a.i - b.i); })
    .map(function (x) { return x.o; });
  var aoa = [['員工編號', '姓名', '單位', '職稱', '', '員工名冊更新日期', todayStr]];
  sorted.forEach(function (o, r) {
    var line = [o.empNo || '', o.name || '', unitOf(o), o.title || ''];
    if (r === 0) line = line.concat(['', '員工總人數', sorted.length]);
    aoa.push(line);
  });
  return aoa;
}
if (typeof module !== 'undefined') module.exports = { buildRosterWide: buildRosterWide, buildRosterFlat: buildRosterFlat };
