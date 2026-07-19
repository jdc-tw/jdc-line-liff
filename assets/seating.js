/** 座位相關純邏輯（stats.html 桌次管理與 node --test 共用）。 */
var SEAT_COLS = 22;   // 每桌席位欄數
var TABLE_ROWS = 28;  // 桌數（2026-07-19 使用者定 28 桌）

/** 來賓一席一列 → {負責人: [簡稱, ...]}；席位序號<=0 不佔位。 */
function expandGuests(guests) {
  var byOwner = {};
  (guests || []).forEach(function (g) {
    if (!(Number(g.seatNo) > 0)) return;
    var name = String(g.name || '').replace(/[\t\s　]+/g, ' ').trim();
    if (!name) return;
    var owner = String(g.owner || '').trim() || '其他';
    (byOwner[owner] = byOwner[owner] || []).push(name);
  });
  return byOwner;
}

/**
 * 排位用檔 AOA：上方空白座位格（28 桌×22 席・A 欄純數字）＋右側檢核區＋下方分類名單。
 * expected＝預定人數（出席同仁＋來賓席位），檢核差額＝預定−目前−未排定。
 */
function buildSeatingAoa(unitNames, attendeesByUnit, ownerNames, guestsByOwner, expected) {
  var aoa = [];
  var header = ['桌次'];
  for (var s = 1; s <= SEAT_COLS; s++) header.push(s);
  header.push('檢核', '值');
  aoa.push(header);
  for (var t = 1; t <= TABLE_ROWS; t++) {
    var row = [t];
    for (var c = 0; c < SEAT_COLS; c++) row.push('');
    row.push('', '');
    aoa.push(row);
  }
  var cols = [];
  (unitNames || []).forEach(function (u) { cols.push({ name: u, names: (attendeesByUnit[u] || []).slice() }); });
  (ownerNames || []).forEach(function (o) { cols.push({ name: o, names: (guestsByOwner[o] || []).slice() }); });
  if (guestsByOwner && guestsByOwner['其他'] && (ownerNames || []).indexOf('其他') < 0) {
    cols.push({ name: '其他', names: guestsByOwner['其他'].slice() });
  }
  aoa.push([]);                                   // 空行分隔
  var hdrRow = aoa.length;                        // 0-based index of 分類表頭
  aoa.push(['序號'].concat(cols.map(function (c) { return c.name; })));
  var maxLen = cols.reduce(function (m, c) { return Math.max(m, c.names.length); }, 0);
  for (var r = 0; r < maxLen; r++) {
    var line = [r + 1];
    cols.forEach(function (c) { line.push(c.names[r] || ''); });
    aoa.push(line);
  }
  // 剩餘列：每欄 COUNTA（名字被剪走就減少）
  var firstDataRow = hdrRow + 2;                  // Excel 1-based
  var lastDataRow = hdrRow + 1 + maxLen;
  var remain = ['剩餘'];
  for (var ci = 0; ci < cols.length; ci++) {
    var L = colLetter_(ci + 2);
    remain.push('=COUNTA(' + L + firstDataRow + ':' + L + lastDataRow + ')');
  }
  aoa.push(remain);
  var remRow = lastDataRow + 1;
  var sumRow = ['未排定合計'];
  for (var k = 1; k < cols.length; k++) sumRow.push('');
  sumRow.push('=SUM(B' + remRow + ':' + colLetter_(cols.length + 1) + remRow + ')');
  aoa.push(sumRow);
  var sumCell = colLetter_(cols.length + 1) + (remRow + 1);
  // 檢核區（座位格右側）
  var CK = SEAT_COLS + 1, CV = SEAT_COLS + 2;     // 0-based
  var VL = colLetter_(CV + 1);
  aoa[1][CK] = '目前人數';
  aoa[1][CV] = '=COUNTA(B2:' + colLetter_(SEAT_COLS + 1) + (TABLE_ROWS + 1) + ')';
  aoa[2][CK] = '預定人數';
  aoa[2][CV] = expected;
  aoa[3][CK] = '未排定';
  aoa[3][CV] = '=' + sumCell;
  aoa[4][CK] = '檢核差額（0＝沒漏）';
  aoa[4][CV] = '=' + VL + '3-' + VL + '2-' + VL + '4';
  return aoa;
}

function colLetter_(n) {   // 1→A
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/**
 * 解析使用者排好的座位表：讀座位格 → [{name, table}]。
 * 只讀 A 欄為數字的列（座位區）、B..(seatCols+1) 欄；去掉 (素) 類括號註記。
 */
function parseSeatingUpload(aoa, seatCols) {
  var cols = seatCols || SEAT_COLS;
  var out = [];
  var rows = aoa || [];
  // 座位區＝首個空行（分隔線）之前；沒有空行就整份掃（容忍使用者刪掉分隔行）
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0 || r.every(function (v) { return v === '' || v == null; })) {
      rows = rows.slice(0, i); break;
    }
  }
  rows.forEach(function (row) {
    if (!row || row.length === 0) return;
    var t = row[0];
    if (t === '' || t == null) return;
    var tn = Number(t);
    if (isNaN(tn) || tn <= 0) return;                 // 非座位列（表頭/剩餘）
    for (var c = 1; c <= cols && c < row.length; c++) {
      var v = String(row[c] == null ? '' : row[c]).replace(/[（(].*?[)）]/g, '').replace(/[\t\s　]+/g, ' ').trim();
      if (v) out.push({ name: v, table: String(tn) });
    }
  });
  return out;
}

/** 座位排序：同仁依職稱順位（小=高）、無順位殿後；來賓恆最後；同順位穩定。 */
function sortSeats(seats, ranks) {
  return (seats || []).map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) {
    var ga = a.s.kind === 'guest' ? 1 : 0, gb = b.s.kind === 'guest' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    if (!ga) {
      var ra = (ranks && ranks[a.s.title]) || 9999, rb = (ranks && ranks[b.s.title]) || 9999;
      if (ra !== rb) return ra - rb;
    }
    return a.i - b.i;
  }).map(function (x) { return x.s; });
}

/** 桌次排序鍵：主桌→數字→其他字串→未排桌（空） */
function tableOrder_(a, b) {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  var na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  if (!isNaN(na)) return -1;
  if (!isNaN(nb)) return 1;
  return a < b ? -1 : 1;
}

/**
 * 正式座位表 AOA：一欄一桌、座位直排；同桌內同仁（順位序）前、來賓後。
 * 回 {aoa, guestCells:[[rowIdx, colIdx], ...]}（0-based，供上紅字）。
 */
function buildFormalAoa(seats, ranks) {
  var byTable = {}, keys = [];
  (seats || []).forEach(function (s) {
    var t = String(s.table || '');
    if (!t) return;                       // 未排桌不列入正式表
    if (!byTable[t]) { byTable[t] = []; keys.push(t); }
    byTable[t].push(s);
  });
  keys.sort(tableOrder_);
  var cols = keys.map(function (t) { return sortSeats(byTable[t], ranks); });
  var maxLen = cols.reduce(function (m, c) { return Math.max(m, c.length); }, 0);
  var aoa = [['席位'].concat(keys)];
  var guestCells = [];
  for (var r = 0; r < maxLen; r++) {
    var line = [r + 1];
    cols.forEach(function (c, ci) {
      var p = c[r];
      line.push(p ? p.name : '');
      if (p && p.kind === 'guest') guestCells.push([r + 1, ci + 1]);
    });
    aoa.push(line);
  }
  aoa.push(['人數'].concat(cols.map(function (c) { return c.length; })));
  return { aoa: aoa, guestCells: guestCells };
}

if (typeof module !== 'undefined') {
  module.exports = { buildSeatingAoa, expandGuests, parseSeatingUpload, sortSeats, buildFormalAoa,
                     SEAT_COLS, TABLE_ROWS };
}
