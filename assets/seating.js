/** 座位相關純邏輯（stats.html 桌次管理與 node --test 共用）。 */
// 2026-08-07 版面改版（使用者拍板）：座位區轉置成「一欄一桌」，與正式座位表方向一致。
// 舊版是 28 列桌次 × 22 欄席位；新版＝ 12 列席次 × 27 欄桌次。
var SEAT_ROWS = 12;   // 每桌席位數（直向）
var TABLE_COLS = 27;  // 桌數（橫向・先預排到 27 桌）

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
 * 計數公式：**不可用 COUNTA**。產檔時為了畫格線，每一格都寫了空字串（此 writer 丟掉真空白格
 * 會連框線一起丟，2026-08-07 實測），COUNTA 把空字串當有內容 → 9 人被算成 17。
 * LEN>0 只認真的有字的格子，數字或文字都算得到。
 */
function countNonEmpty_(range) {
  return '=SUMPRODUCT(--(LEN(' + range + ')>0))';
}

/**
 * 排位用檔 AOA：上方空白座位格（12 席×27 桌・A 欄席次、第一列桌次）＋右側檢核區＋下方分類名單。
 * expected＝預定人數（出席同仁＋來賓席位），檢核差額＝預定−目前−未排定。
 * 回 {aoa, freezeTopLeft, fills}：fills＝[[r,c,rgb]...]（0-based）供分類欄上底色。
 */
function buildSeatingAoa(unitNames, attendeesByUnit, ownerNames, guestsByOwner, expected) {
  var aoa = [];
  var header = ['席次'];
  for (var t = 1; t <= TABLE_COLS; t++) header.push(t);
  header.push('檢核', '值');
  aoa.push(header);
  for (var s = 1; s <= SEAT_ROWS; s++) {
    var row = [s];
    for (var c = 0; c < TABLE_COLS; c++) row.push('');
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
  // 剩餘列：每欄還沒被排走的人數
  var firstDataRow = hdrRow + 2;                  // Excel 1-based
  var lastDataRow = hdrRow + 1 + maxLen;
  var remain = ['剩餘'];
  for (var ci = 0; ci < cols.length; ci++) {
    var L = colLetter_(ci + 2);
    remain.push(countNonEmpty_(L + firstDataRow + ':' + L + lastDataRow));
  }
  aoa.push(remain);
  var remRow = lastDataRow + 1;
  var sumRow = ['未排定合計'];
  for (var k = 1; k < cols.length; k++) sumRow.push('');
  sumRow.push('=SUM(B' + remRow + ':' + colLetter_(cols.length + 1) + remRow + ')');
  aoa.push(sumRow);
  var sumCell = colLetter_(cols.length + 1) + (remRow + 1);
  // 檢核區（座位格右側，跳過最後一桌那一欄）
  var CK = TABLE_COLS + 1, CV = TABLE_COLS + 2;   // 0-based
  var VL = colLetter_(CV + 1);
  aoa[1][CK] = '目前人數';
  aoa[1][CV] = countNonEmpty_('B2:' + colLetter_(TABLE_COLS + 1) + (SEAT_ROWS + 1));
  aoa[2][CK] = '預定人數';
  aoa[2][CV] = expected;
  aoa[3][CK] = '未排定';
  aoa[3][CV] = '=' + sumCell;
  aoa[4][CK] = '檢核差額（0＝沒漏）';
  aoa[4][CV] = '=' + VL + '3-' + VL + '2-' + VL + '4';

  // 分類欄底色：一欄一色（表頭＋該欄有名字的格），方便剪貼時辨認來源欄
  var palette = pastelPalette(cols.length);
  var fills = [];
  cols.forEach(function (c, ci) {
    fills.push([hdrRow, ci + 1, palette[ci]]);
    for (var i = 0; i < c.names.length; i++) fills.push([hdrRow + 1 + i, ci + 1, palette[ci]]);
  });
  return {
    aoa: aoa,
    freezeTopLeft: 'B' + (hdrRow + 2),   // 凍到分類表頭那列（座位區＋表頭恆可見）
    fills: fills,
  };
}

/** n 個彼此分得開的淡色：黃金角跳色相＋兩段明度交錯（相鄰欄不會撞成同一片）。 */
function pastelPalette(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var h = (i * 137.508) % 360;               // 黃金角＝相鄰序號色相差最大
    var l = (i % 2 === 0) ? 0.88 : 0.80;       // 明度交錯，同色相也分得出
    out.push(hslHex_(h, 0.55, l));
  }
  return out;
}

function hslHex_(h, s, l) {
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = l - c / 2;
  var seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return seg.map(function (v) {
    var t = Math.round((v + m) * 255).toString(16).toUpperCase();
    return t.length < 2 ? '0' + t : t;
  }).join('');
}

function colLetter_(n) {   // 1→A
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/**
 * 解析使用者排好的座位表：讀座位格 → [{name, table}]。
 * 新版（A1='席次'）＝一欄一桌，桌號在表頭列；舊版（A1='桌次'）＝一列一桌，桌號在 A 欄。
 * 兩種都收：使用者手上可能還有改版前下載的檔案，上傳舊檔不該靜默排錯桌。
 * 去掉 (素) 類括號註記。
 */
function parseSeatingUpload(aoa, seatColsLegacy) {
  var rows = (aoa || []).slice();
  if (!rows.length) return [];
  var clean = function (v) {
    return String(v == null ? '' : v).replace(/[（(].*?[)）]/g, '').replace(/[\t\s　]+/g, ' ').trim();
  };
  // 座位區＝首個空行（分隔線）之前；沒有空行就整份掃（容忍使用者刪掉分隔行）
  for (var i = 1; i < rows.length; i++) {
    var rr = rows[i];
    if (!rr || rr.length === 0 || rr.every(function (v) { return v === '' || v == null; })) {
      rows = rows.slice(0, i); break;
    }
  }
  var out = [];
  var isLegacy = String((rows[0] || [])[0] || '').trim() === '桌次';
  if (isLegacy) {
    var cols = seatColsLegacy || 22;
    rows.forEach(function (row) {
      if (!row || !row.length) return;
      var tn = Number(row[0]);
      if (row[0] === '' || row[0] == null || isNaN(tn) || tn <= 0) return;
      for (var c = 1; c <= cols && c < row.length; c++) {
        var v = clean(row[c]);
        if (v) out.push({ name: v, table: String(tn) });
      }
    });
    return out;
  }
  // 新版：表頭列即桌號，逐欄收
  var head = rows[0] || [];
  for (var c2 = 1; c2 < head.length; c2++) {
    var tRaw = head[c2];
    var tn2 = Number(tRaw);
    if (tRaw === '' || tRaw == null || isNaN(tn2) || tn2 <= 0) continue;   // 檢核/值等非桌號欄跳過
    for (var r2 = 1; r2 < rows.length; r2++) {
      var v2 = clean((rows[r2] || [])[c2]);
      if (v2) out.push({ name: v2, table: String(tn2) });
    }
  }
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
                     pastelPalette, countNonEmpty_, SEAT_ROWS, TABLE_COLS };
}
