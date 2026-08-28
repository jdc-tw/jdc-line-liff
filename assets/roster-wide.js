// 員工名冊寬表 pivot（純函式：瀏覽器 board.html 下載用＋node 測試用）
// rosterRows＝getRosterList().rows、optRows＝listOptions().rows、todayStr＝'yyyy/MM/dd'
// 回傳 AOA：header＝序號＋單位欄（選項主檔列序·總公司前工地後）＋右上 metadata；
// 預設只列在職與留停（留停加「（留停）」標記），opts.includeLeavers=true 連離職一起出（加「（離職）」）；
// 名冊有但主檔沒有的單位排最後；首資料列尾帶員工總人數（恆只數在勤，離職與留停都不算）。
function buildRosterWide(rosterRows, optRows, todayStr, opts) {
  var incl = !!(opts && opts.includeLeavers);
  var sep = function (o) { return o.status === '離職'; };
  var onLeave = function (o) { return o.status === '留職停薪'; };
  var pool = (rosterRows || []).filter(function (o) { return incl || !sep(o); });
  var activeCount = (rosterRows || []).filter(function (o) { return !sep(o) && !onLeave(o); }).length;
  var byUnit = {};
  pool.forEach(function (o) {
    var u = String(o.unit || '').trim() || '（未填單位）';
    var mark = sep(o) ? '（離職）' : (onLeave(o) ? '（留停）' : '');
    (byUnit[u] = byUnit[u] || []).push(o.name + mark);
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
    if (r === 0) line = line.concat(['', '員工總人數', activeCount]);
    aoa.push(line);
  }
  return aoa;
}
if (typeof module !== 'undefined') module.exports = { buildRosterWide: buildRosterWide };
