/** 座位排列用檔純邏輯（stats.html 桌次管理與 node --test 共用）。 */
var SEAT_COLS = 22;   // 每桌席位欄數（照使用者座位表範本）
var TABLE_ROWS = 25;  // 預留桌數列

/** 來賓展開：參加人數 N → N 格簡稱；0 不出；簡稱去前後空白與 tab。 */
function expandGuests(guests) {
  var byOwner = {};
  (guests || []).forEach(function (g) {
    var n = Number(g.count) || 0;
    if (n <= 0) return;
    var name = String(g.name || '').replace(/[\t\s]+/g, ' ').trim();
    if (!name) return;
    var owner = String(g.owner || '').trim() || '其他';
    var arr = byOwner[owner] = byOwner[owner] || [];
    for (var i = 0; i < n; i++) arr.push(name);
  });
  return byOwner;
}

/**
 * 產出座位排列用檔的二維陣列（AOA）。
 * 上方＝空白座位格（桌次×SEAT_COLS 席位＋目前人數欄）；
 * 下方＝分類名單區（序號｜各單位欄｜各負責人員欄｜其他），供剪下→上方貼上。
 */
function buildSeatingAoa(unitNames, attendeesByUnit, ownerNames, guestsByOwner) {
  var aoa = [];
  var header = ['桌次'];
  for (var s = 1; s <= SEAT_COLS; s++) header.push(s);
  header.push('目前人數');
  aoa.push(header);
  for (var t = 1; t <= TABLE_ROWS; t++) {
    var row = [t];
    for (var c = 0; c < SEAT_COLS + 1; c++) row.push('');
    aoa.push(row);
  }
  aoa.push([]);   // 空行分隔
  var cols = [];  // [{name, names[]}]
  (unitNames || []).forEach(function (u) {
    cols.push({ name: u, names: (attendeesByUnit[u] || []).slice() });
  });
  (ownerNames || []).forEach(function (o) {
    cols.push({ name: o, names: (guestsByOwner[o] || []).slice() });
  });
  cols.push({ name: '其他', names: (guestsByOwner && guestsByOwner['其他'] && ownerNames.indexOf('其他') === -1) ? guestsByOwner['其他'].slice() : [] });
  var hdr2 = ['序號'].concat(cols.map(function (c) { return c.name; }));
  aoa.push(hdr2);
  var maxLen = cols.reduce(function (m, c) { return Math.max(m, c.names.length); }, 0);
  for (var r = 0; r < maxLen; r++) {
    var line = [r + 1];
    cols.forEach(function (c) { line.push(c.names[r] || ''); });
    aoa.push(line);
  }
  return aoa;
}

if (typeof module !== 'undefined') module.exports = { buildSeatingAoa, expandGuests, SEAT_COLS, TABLE_ROWS };
