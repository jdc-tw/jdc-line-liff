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
 * 來賓上傳檔一列（＝一家廠商）→ 席位陣列。
 * 上傳檔是一列一廠商（參加人數 n），來賓表是一席一列，所以要在這裡展開。
 * 素食人數 v 上限為 n，落在**席位序號最小的前 v 席**——同一家人分不出誰是誰，
 * 對「哪一桌幾份」這個用途足夠；同家被拆兩桌時的誤差由 vegSummary 提示。
 * n<=0 回一列 seatNo:0：不佔位，但保留這家廠商的資料列。
 * @returns {Array<{seatNo:number, veg:boolean}>}
 */
function expandGuestRow(count, vegCount) {
  var n = Number(count) || 0;
  if (n <= 0) return [{ seatNo: 0, veg: false }];
  var v = Math.max(0, Math.min(Number(vegCount) || 0, n));
  var out = [];
  for (var i = 1; i <= n; i++) out.push({ seatNo: i, veg: i <= v });
  return out;
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
  (unitNames || []).forEach(function (u) { cols.push({ name: u, kind: 'unit', names: (attendeesByUnit[u] || []).slice() }); });
  guestOwnerOrder(ownerNames, guestsByOwner).forEach(function (o) {
    cols.push({ name: o, kind: 'guest', names: ((guestsByOwner || {})[o] || []).slice() });
  });
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

  // 分類欄底色（表頭＋該欄有名字的格）：色票由 categoryPalette 統一發，
  // 正式座位表用同一張表上色 → 同一個人在兩份檔案的底色一致。
  var pal = categoryPalette(
    cols.filter(function (c) { return c.kind !== 'guest'; }).map(function (c) { return c.name; }),
    cols.filter(function (c) { return c.kind === 'guest'; }).map(function (c) { return c.name; }));
  var fills = [];
  cols.forEach(function (c, ci) {
    var rgb = (c.kind === 'guest') ? pal.guest[c.name] : pal.unit[c.name];
    fills.push([hdrRow, ci + 1, rgb]);
    for (var i = 0; i < c.names.length; i++) fills.push([hdrRow + 1 + i, ci + 1, rgb]);
  });
  return {
    aoa: aoa,
    freezeTopLeft: 'B' + (hdrRow + 2),   // 凍到分類表頭那列（座位區＋表頭恆可見）
    fills: fills,
  };
}

// 單位＝有彩度的淡色；來賓＝純灰階（s=0），兩類天然分得開。
// 彩度 0.55 在淡階（l=0.88）算出來的實際色差只有 0.13，跟灰階分不太開（2026-08-07 測試抓到），
// 故拉到 0.75——淡階色差 0.18、深階 0.30，仍是淡色底、黑字清楚。
var UNIT_SAT = 0.75;

/**
 * 單位用：n 個彼此分得開的淡色。色相用黃金比例鋪開（低差異序列，分布最勻）、明度兩段交錯。
 * ⚠️ 不可用「算完發現撞到就往旁邊推」：推過去會跟別人重疊，27 欄只產生 25 色
 *（2026-08-07 測試抓到，正好破壞「底色不重複」的要求）。
 */
function pastelPalette(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var h = ((i * 0.618033988749895) % 1) * 360;
    var l = (i % 2 === 0) ? 0.88 : 0.80;
    out.push(hslHex_(h, UNIT_SAT, l));
  }
  return out;
}

/**
 * 來賓（廠商）用：**灰階**漸層，由淺到深（使用者 2026-08-07 指定）。
 * 無彩度＝與單位的彩色欄一眼分流；明度序列＝分得出是哪位負責人帶的。n=1 時取最淺。
 */
function guestGradient(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var t = (n > 1) ? i / (n - 1) : 0;
    out.push(hslHex_(0, 0, 0.93 - 0.27 * t));       // 0.93 → 0.66，黑字仍清楚
  }
  return out;
}

/**
 * 把出席名單分成「單位」與「廠商負責人」兩組，決定欄序與欄內順序。
 * 排位用檔與正式座位表的色票都由這裡的 unitOrder／owners 發，故兩支下載必須共用這支——
 * 單位順序一漂，同一個人在兩份檔就會變色。
 *
 * - 欄序：單位依 optionRows 的選項主檔（總公司群組優先），沒列到的照出現順序補在後面。
 * - 欄內：走 sortSeats（與正式座位表同一支）＝職稱位階小者在前、無順位殿後、同順位穩定。
 *   收 seat 物件而非姓名字串，就是為了讓這步拿得到 title。
 *
 * 回 {byUnit, guestsByOwner, owners, unitOrder, guestSeats, empCount}，
 * 其中 byUnit／guestsByOwner 的值已降成姓名陣列，可直接餵 buildSeatingAoa。
 */
function groupSeatCategories(seats, optionRows, ranks) {
  var byUnit = {}, guestsByOwner = {}, owners = [], guestSeats = 0, empCount = 0;
  (seats || []).forEach(function (s) {
    if (s.kind === 'emp') {
      var u = String(s.unit || '').trim() || '（未填單位）';
      (byUnit[u] = byUnit[u] || []).push(s);
      empCount++;
    } else {
      var o = String(s.unit || '').trim() || '其他';
      (guestsByOwner[o] = guestsByOwner[o] || []).push(s);
      guestSeats++;
      if (o !== '其他' && owners.indexOf(o) < 0) owners.push(o);
    }
  });
  // 排位用檔不放素食資訊（2026-08-10 使用者拍板）：排位是照單位與職稱排的，
  // 誰吃素跟坐哪桌無關，標在名單上只是雜訊。素食要查走桌次管理的「🥬 素食」視圖。
  var toNames = function (m) {
    Object.keys(m).forEach(function (k) {
      m[k] = sortSeats(m[k], ranks || {}).map(function (x) { return x.name; });
    });
  };
  toNames(byUnit); toNames(guestsByOwner);

  var unitOrder = [];
  [true, false].forEach(function (wantHq) {
    (optionRows || []).forEach(function (o) {
      if (o.type !== '單位' || !byUnit[o.name] || unitOrder.indexOf(o.name) >= 0) return;
      if ((o.group === '總公司') === wantHq) unitOrder.push(o.name);
    });
  });
  Object.keys(byUnit).forEach(function (u) { if (unitOrder.indexOf(u) < 0) unitOrder.push(u); });

  return { byUnit: byUnit, guestsByOwner: guestsByOwner, owners: owners,
           unitOrder: unitOrder, guestSeats: guestSeats, empCount: empCount };
}

/**
 * 廠商欄的實際順序：ownerNames 之後，若名單裡有「其他」而 ownerNames 沒列到，補在最後。
 * 兩份檔案都得照這個順序發色票，否則同一位負責人會在兩邊拿到不同灰階。
 */
function guestOwnerOrder(ownerNames, guestsByOwner) {
  var out = (ownerNames || []).slice();
  if (guestsByOwner && guestsByOwner['其他'] && out.indexOf('其他') < 0) out.push('其他');
  return out;
}

/**
 * 分類→底色對照表：排位用檔與正式座位表的**唯一**色票來源。
 * 兩邊各自算一次調色盤（而不是共用這支）就會漂移，故色票只在這裡發。
 * 回 {unit:{單位名:RGB}, guest:{負責人:RGB}}。
 */
function categoryPalette(unitNames, ownerNames) {
  var units = unitNames || [], owners = ownerNames || [];
  var uPal = pastelPalette(units.length), gPal = guestGradient(owners.length);
  var map = { unit: {}, guest: {} };
  units.forEach(function (u, i) { map.unit[u] = uPal[i]; });
  owners.forEach(function (o, i) { map.guest[o] = gPal[i]; });
  return map;
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

/**
 * 員工編號比較（同職稱時的第二排序鍵，2026-08-11 使用者指定）。
 * 兩邊都是純數字 → 數值比（真實資料是 5 碼帶前導零，如 00008／06003，數值比才對）；
 * 否則退回字串比（日後格式若變成帶字母也不會排錯或丟例外）；
 * 空員編殿後——沒有編號的人排在有編號的同職稱者之後。
 */
function empNoOrder_(a, b) {
  var x = String(a == null ? '' : a).trim(), y = String(b == null ? '' : b).trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y);
  return x < y ? -1 : (x > y ? 1 : 0);
}

/**
 * 座位排序：來賓恆最後；同仁**先依職稱順位**（小=高、無順位殿後），
 * **同職稱再依員工編號**（小在前，2026-08-11 使用者指定：「排序一職稱、排序二員工編號」）；
 * 兩者都相同才回退到原順序（穩定）。
 * 排位用檔的分類名單（groupSeatCategories）與正式座位表同桌內順序（buildFormalAoa）共用這支，
 * 所以兩份檔案的人員順序一定一致——這正是使用者要的「通用到排位檔跟正式座位表」。
 */
function sortSeats(seats, ranks) {
  return (seats || []).map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) {
    var ga = a.s.kind === 'guest' ? 1 : 0, gb = b.s.kind === 'guest' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    if (!ga) {
      var ra = (ranks && ranks[a.s.title]) || 9999, rb = (ranks && ranks[b.s.title]) || 9999;
      if (ra !== rb) return ra - rb;
      var e = empNoOrder_(a.s.empNo, b.s.empNo);
      if (e !== 0) return e;
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
 * 素食彙總：一行一桌的份數與名單，給餐廳報數用。
 * 只回**有素食**的桌（零素食的桌不列，避免整片「0 份」的噪音）；未排桌的集中成 table:'' 一行、
 * 靠 tableOrder_ 排在最後——那一行是給使用者看的缺口（還沒定位的份數），不是給餐廳的。
 * splitVendors＝同一家廠商的素食席位落在兩張以上的桌。展開時素食固定落在席位序號最小的前幾席
 *（expandGuestRow），同家被拆桌時份數可能算錯桌，所以要在畫面上提示使用者手調。
 * @returns {{rows:Array<{table:string,count:number,names:string[]}>, total:number, splitVendors:string[]}}
 */
function vegSummary(seats) {
  var byTable = {}, keys = [], total = 0, vendorTables = {};
  (seats || []).forEach(function (s) {
    if (!s || !s.veg) return;
    var t = String(s.table || '');
    if (!byTable[t]) { byTable[t] = []; keys.push(t); }
    byTable[t].push(String(s.name || ''));
    total++;
    if (s.kind === 'guest' && t) {
      var v = String(s.name || '');
      (vendorTables[v] = vendorTables[v] || {})[t] = true;
    }
  });
  keys.sort(tableOrder_);
  return {
    rows: keys.map(function (t) {
      return { table: t, count: byTable[t].length, names: byTable[t].slice() };
    }),
    total: total,
    splitVendors: Object.keys(vendorTables).filter(function (v) {
      return Object.keys(vendorTables[v]).length > 1;
    }),
  };
}

/**
 * 正式座位表 AOA：一欄一桌、座位直排；同桌內同仁（順位序）前、來賓後。
 * palette＝categoryPalette 的回傳（可省略）：給了就把每個人的格子上他所屬單位／負責人的底色，
 * 與排位用檔分類欄同色——排位時記住的顏色，在正式表上還認得出來。
 * 回 {aoa, guestCells:[[rowIdx, colIdx], ...], fills:[[r,c,rgb], ...]}（皆 0-based）。
 */
function buildFormalAoa(seats, ranks, palette) {
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
  var guestCells = [], fills = [];
  for (var r = 0; r < maxLen; r++) {
    var line = [r + 1];
    cols.forEach(function (c, ci) {
      var p = c[r];
      line.push(p ? p.name : '');
      if (!p) return;
      if (p.kind === 'guest') guestCells.push([r + 1, ci + 1]);
      var rgb = palette && (p.kind === 'guest'
        ? palette.guest[String(p.unit || '').trim() || '其他']
        : palette.unit[String(p.unit || '').trim() || '（未填單位）']);
      if (rgb) fills.push([r + 1, ci + 1, rgb]);   // 查不到分類就不上色，不亂配一個顏色
    });
    aoa.push(line);
  }
  aoa.push(['人數'].concat(cols.map(function (c) { return c.length; })));

  // 底部附素食彙總：這份本來就是要印出來給人看的，彙總長在同一張紙上比另開一份可靠
  //（另開的那份一定會有人忘記帶）。座位格本身不標素食——拍板：只要知道哪桌幾份。
  // append 在最後，故不影響 fills／guestCells 既有的列索引。
  var vs = vegSummary(seats);
  if (vs.total) {
    aoa.push([]);
    aoa.push(['素食彙總']);
    aoa.push(['桌次', '份數', '姓名']);
    vs.rows.forEach(function (r) {
      aoa.push([r.table || '未排桌', r.count, r.names.join('、')]);
    });
    aoa.push(['合計', vs.total, '']);
  }
  return { aoa: aoa, guestCells: guestCells, fills: fills };
}

// ── 來賓簽到表 ──────────────────────────────────────────────────────────
var SIGNIN_ROWS = 24;   // 每頁每欄 24 列（＝一頁 48 家，與使用者提供的範本一致）

/** 桌次顯示：純數字補「桌」，其餘（主桌…）原樣；空值回空字串。 */
function signinTableLabel_(t) {
  var s = String(t == null ? '' : t).trim();
  if (!s) return '';
  return /^\d+(\.\d+)?$/.test(s) ? s + '桌' : s;
}

/**
 * 來賓一席一列 → 簽到表分頁結構（stats.html 產 xlsx 與 node --test 共用）。
 *
 * 規格來源＝使用者 2026-08-22 提供的「簽到表_廠商.xlsx」範本：
 * 一頁 48 家、左欄先填滿 24 家再填右欄、依桌次排序、簽名欄右側印淺灰桌號。
 * **參加人數 0 的廠商不列**（使用者指定：沒有人出席的廠商就不用列出來）——
 * 判準是來賓名單的席位數，不是當天報到紀錄；來賓不走員編掃碼報到，沒有報到資料可用。
 *
 * 聚合鍵沿用「負責人員|廠商名稱」，與既有的來賓名單下載（dlGuestFile）同一把尺——
 * 同名廠商掛在兩個負責人底下時兩邊都會列成兩列，兩份檔案才不會對不起來。
 *
 * **沒有廠商名稱的來賓不會被丟掉**（2026-08-22 使用者指出有兩位是這種）：
 * 取名順序＝廠商名稱 → 聯絡人；兩欄都空的仍佔一列、姓名欄留白並標記 `unnamed`，
 * 由呼叫端報給使用者補資料。原本這裡跟上傳解析一樣直接 `return`，
 * 有席位的人會**零提示消失**在簽到表上——現場點不到名才會發現。
 * 個人來賓的聚合鍵前綴 `#`，才不會跟剛好同名的廠商併成一列。
 *
 * @param {Array<{_row,owner,name,contact,seatNo,table}>} guests listGuests 回傳的 rows
 * @param {number} [perCol] 每欄列數（預設 SIGNIN_ROWS，測試可調小）
 * @returns {Array<{left:Array<{no,name,seats,table,unnamed}>, right:Array<...>}>} 沒有可列的來賓時回 []
 */
function buildSigninPages(guests, perCol) {
  perCol = perCol || SIGNIN_ROWS;
  var agg = {}, order = [];
  var clean = function (v) { return String(v == null ? '' : v).replace(/[\t\s　]+/g, ' ').trim(); };
  (guests || []).forEach(function (g) {
    var owner = clean(g.owner);
    var vendor = clean(g.name), person = clean(g.contact);
    // 廠商名稱 → 聯絡人 → 都沒有（姓名留白，等呼叫端提醒使用者補）
    var name = vendor || person;
    var k = vendor ? (owner + '|' + vendor)
      : (person ? (owner + '|#' + person) : (owner + '|#__無名__'));
    if (!agg[k]) { agg[k] = { name: name, seats: 0, tables: [], unnamed: !name }; order.push(k); }
    if (!(Number(g.seatNo) > 0)) return;
    agg[k].seats++;
    var t = String(g.table || '').trim();
    if (t && agg[k].tables.indexOf(t) < 0) agg[k].tables.push(t);
  });
  var list = [];
  order.forEach(function (k, i) {
    var v = agg[k];
    if (v.seats <= 0) return;                       // 0 人不列
    v.tables.sort(tableOrder_);
    list.push({ v: v, i: i, key: v.tables[0] || '' });
  });
  // 依桌次（tableOrder_：數字序、非數字字串在後、未排桌殿後）；同桌維持名單原序
  list.sort(function (a, b) {
    var c = tableOrder_(a.key, b.key);
    return c !== 0 ? c : a.i - b.i;
  });
  var pages = [], per = perCol * 2;
  for (var i = 0; i < list.length; i += per) {
    var chunk = list.slice(i, i + per).map(function (x, j) {
      return { no: i + j + 1, name: x.v.name, seats: x.v.seats,
               table: x.v.tables.map(signinTableLabel_).join('、'), unnamed: x.v.unnamed };
    });
    pages.push({ left: chunk.slice(0, perCol), right: chunk.slice(perCol) });
  }
  return pages;
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildSigninPages, SIGNIN_ROWS, buildSeatingAoa, expandGuests, parseSeatingUpload, sortSeats, buildFormalAoa,
                     pastelPalette, guestGradient, categoryPalette, guestOwnerOrder,
                     groupSeatCategories, expandGuestRow, vegSummary,
                     countNonEmpty_, SEAT_ROWS, TABLE_COLS };
}
