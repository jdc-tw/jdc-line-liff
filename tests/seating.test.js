const { test } = require('node:test');
const assert = require('node:assert');
const { buildSeatingAoa, expandGuests, parseSeatingUpload, sortSeats,
        buildFormalAoa, pastelPalette, guestGradient, categoryPalette, guestOwnerOrder,
        groupSeatCategories, expandGuestRow, vegSummary,
        buildSigninPages, SIGNIN_ROWS,
        SEAT_ROWS, TABLE_COLS } = require('../assets/seating.js');

/** 十六進位色 → {明度, 彩度, 是否純灰}，供「灰階 vs 彩色」與漸層順序的斷言用。 */
function hueLight(hex) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  return { l: (mx + mn) / 2, sat: mx - mn, gray: (r === g && g === b) };
}

test('expandGuests：一席一列展開（seatNo>0 才佔位）', () => {
  const guests = [
    { owner: '王小明', name: '家屬甲', seatNo: 1 },
    { owner: '王小明', name: '家屬甲', seatNo: 2 },
    { owner: '王小明', name: '家屬乙', seatNo: 0 },
    { owner: '李美麗', name: '家屬丙', seatNo: 1 },
  ];
  assert.deepEqual(expandGuests(guests), { '王小明': ['家屬甲', '家屬甲'], '李美麗': ['家屬丙'] });
});

test('buildSeatingAoa：一欄一桌（27 桌 × 12 席），A 欄席次、表頭桌次', () => {
  const { aoa } = buildSeatingAoa(['管理部'], { '管理部': ['甲', '乙'] }, ['王小明'], { '王小明': ['家屬甲'] }, 3);
  assert.equal(SEAT_ROWS, 12);
  assert.equal(TABLE_COLS, 27);
  assert.equal(aoa[0][0], '席次');
  assert.equal(aoa[0][1], 1);                        // 表頭＝桌次
  assert.equal(aoa[0][TABLE_COLS], TABLE_COLS);      // 最後一桌 27
  assert.equal(aoa[0][TABLE_COLS + 1], '檢核');
  assert.equal(aoa[1][0], 1);                        // A 欄＝席次
  assert.equal(aoa[SEAT_ROWS][0], SEAT_ROWS);        // 最後一席 12
});

test('buildSeatingAoa：檢核區公式不用 COUNTA（空字串會被誤數）', () => {
  const { aoa } = buildSeatingAoa(['A'], { 'A': ['甲'] }, [], {}, 1);
  const CV = TABLE_COLS + 2;                          // 值欄 index 29 → Excel AD
  assert.equal(aoa[1][CV], '=SUMPRODUCT(--(LEN(B2:AB13)>0))');   // 27 桌 B..AB × 12 席 2..13
  assert.equal(aoa[2][CV], 1);                        // 預定人數＝傳入的 expected
  assert.equal(aoa[4][CV], '=AD3-AD2-AD4');           // 預定−目前−未排定
  const rem = aoa[aoa.length - 2];
  assert.equal(rem[0], '剩餘');
  assert.match(String(rem[1]), /^=SUMPRODUCT\(--\(LEN\(B\d+:B\d+\)>0\)\)$/);
  assert.doesNotMatch(JSON.stringify(aoa), /COUNTA/, '整份不得殘留 COUNTA');
});

test('buildSeatingAoa：分類名單接在座位區下方，凍結點＝分類表頭列', () => {
  const { aoa, freezeTopLeft } = buildSeatingAoa(['管理部'], { '管理部': ['甲', '乙'] }, ['王小明'], { '王小明': ['家屬甲'] }, 3);
  const h = SEAT_ROWS + 2;                            // 0-based：表頭1+席次12+空行1 → index 14
  assert.equal(aoa[h][0], '序號');
  assert.equal(aoa[h][1], '管理部');
  assert.equal(aoa[h][2], '王小明');
  assert.equal(aoa[h + 1][1], '甲');
  assert.equal(aoa[h + 1][2], '家屬甲');
  assert.equal(freezeTopLeft, 'B' + (h + 2), '凍結列＝分類表頭那列（Excel 第 15 列）');
  assert.equal(freezeTopLeft, 'B16');
});

test('buildSeatingAoa：fills 只上在表頭與有名字的格，一欄一色且不重複', () => {
  const { aoa, fills } = buildSeatingAoa(['管理部', '施工部'], { '管理部': ['甲', '乙'], '施工部': ['丙'] }, [], {}, 3);
  const h = SEAT_ROWS + 2;
  // 管理部（欄1）：表頭＋2 個名字；施工部（欄2）：表頭＋1 個名字
  const col1 = fills.filter(f => f[1] === 1), col2 = fills.filter(f => f[1] === 2);
  assert.equal(col1.length, 3);
  assert.equal(col2.length, 2);
  assert.deepEqual(col1.map(f => f[0]), [h, h + 1, h + 2]);
  assert.equal(new Set(col1.map(f => f[2])).size, 1, '同欄同色');
  assert.notEqual(col1[0][2], col2[0][2], '不同欄不同色');
  // 沒名字的格不上色（施工部只有 1 人，第 2 列不該有）
  assert.ok(!fills.some(f => f[1] === 2 && f[0] === h + 2));
  // 上色的格都真的有內容
  fills.forEach(([r, c]) => { if (r > h) assert.ok(aoa[r][c], `第${r}列第${c}欄應有名字`); });
});

test('pastelPalette：27 色互不重複，且都是有彩度的（不會與來賓灰階混淆）', () => {
  const p = pastelPalette(27);
  assert.equal(p.length, 27);
  assert.equal(new Set(p).size, 27);
  p.forEach(c => {
    assert.match(c, /^[0-9A-F]{6}$/);
    const { gray, sat } = hueLight(c);
    assert.ok(!gray && sat > 0.15, `單位色 ${c} 太接近灰階（sat=${sat.toFixed(2)}）`);
  });
});

test('guestGradient：純灰階、由淺到深、彼此不重複', () => {
  const g = guestGradient(11);
  assert.equal(g.length, 11);
  assert.equal(new Set(g).size, 11, '11 位負責人要分得出來');
  const hl = g.map(hueLight);
  hl.forEach((x, i) => assert.ok(x.gray, `第 ${i + 1} 位不是純灰：${g[i]}`));
  for (let i = 1; i < hl.length; i++) assert.ok(hl[i].l < hl[i - 1].l, '明度要單調變深');
  assert.ok(hl[hl.length - 1].l > 0.6, '最深的一階仍要能襯黑字');
  assert.equal(guestGradient(1).length, 1, 'n=1 不得除以零');
});

test('buildSeatingAoa：單位彩色、來賓灰階漸層（一眼分得出哪些是廠商）', () => {
  const units = ['管理部', '施工部', '工務管理組'];
  const owners = ['王小明', '李美麗', '陳大同'];
  const { aoa, fills } = buildSeatingAoa(
    units, { 管理部: ['甲'], 施工部: ['乙'], 工務管理組: ['丙'] },
    owners, { 王小明: ['賓1'], 李美麗: ['賓2'], 陳大同: ['賓3'] }, 6);
  const h = SEAT_ROWS + 2;
  const colorOf = (ci) => (fills.find(f => f[0] === h && f[1] === ci) || [])[2];
  // 表頭順序確認：前三欄單位、後三欄負責人
  assert.deepEqual(aoa[h].slice(1), units.concat(owners));
  // 來賓：純灰、明度遞減
  const gl = [4, 5, 6].map(ci => hueLight(colorOf(ci)));
  gl.forEach(x => assert.ok(x.gray, '廠商欄必須是純灰階'));
  assert.ok(gl[0].l > gl[1].l && gl[1].l > gl[2].l);
  // 單位：都是彩色且彼此不同
  const uc = [1, 2, 3].map(colorOf);
  assert.equal(new Set(uc).size, 3);
  uc.forEach(c => assert.ok(!hueLight(c).gray, '單位欄不得是灰階'));
});

test('guestOwnerOrder：ownerNames 之後補「其他」，已列到就不重複', () => {
  assert.deepEqual(guestOwnerOrder(['王小明'], { 王小明: ['賓1'], 其他: ['賓2'] }), ['王小明', '其他']);
  assert.deepEqual(guestOwnerOrder(['王小明', '其他'], { 其他: ['賓2'] }), ['王小明', '其他']);
  assert.deepEqual(guestOwnerOrder(['王小明'], { 王小明: ['賓1'] }), ['王小明'], '沒有「其他」就不硬加');
});

test('buildFormalAoa：每格上該員所屬分類的底色，與排位用檔同一張色票', () => {
  const units = ['管理部', '施工部'], owners = ['王小明'];
  const byUnit = { 管理部: ['甲'], 施工部: ['乙'] };
  const guestsByOwner = { 王小明: ['賓1'], 其他: ['賓2'] };
  const seats = [
    { name: '甲', title: '主任', kind: 'emp', unit: '管理部', table: '1' },
    { name: '乙', title: '主任', kind: 'emp', unit: '施工部', table: '1' },
    { name: '賓1', kind: 'guest', unit: '王小明', table: '1' },
    { name: '賓2', kind: 'guest', unit: '', table: '2' },       // 沒負責人 → 歸「其他」
  ];
  const pal = categoryPalette(units, guestOwnerOrder(owners, guestsByOwner));
  const { aoa, fills } = buildFormalAoa(seats, { 主任: 8 }, pal);
  const at = (r, c) => (fills.find(f => f[0] === r && f[1] === c) || [])[2];
  // 正式表：1 桌＝甲(第1席)、乙(第2席)、賓1(第3席)；2 桌＝賓2
  assert.deepEqual(aoa[1].slice(0, 3), [1, '甲', '賓2']);
  assert.equal(at(1, 1), pal.unit['管理部']);
  assert.equal(at(2, 1), pal.unit['施工部']);
  assert.equal(at(3, 1), pal.guest['王小明']);
  assert.equal(at(1, 2), pal.guest['其他'], '沒填負責人的來賓歸「其他」色');
  assert.notEqual(pal.unit['管理部'], pal.unit['施工部']);

  // ⭐ 真正要守的：同一個人在兩份檔案的底色一模一樣（色票只有 categoryPalette 一個來源）
  const sb = buildSeatingAoa(units, byUnit, owners, guestsByOwner, 4);
  const h = SEAT_ROWS + 2;                                  // 分類表頭列
  const colOf = (name) => sb.aoa[h].indexOf(name);
  const seatingColor = (name) => (sb.fills.find(f => f[0] === h && f[1] === colOf(name)) || [])[2];
  assert.equal(at(1, 1), seatingColor('管理部'), '甲：排位用檔與正式表同色');
  assert.equal(at(2, 1), seatingColor('施工部'), '乙：排位用檔與正式表同色');
  assert.equal(at(3, 1), seatingColor('王小明'), '賓1：排位用檔與正式表同色');
  assert.equal(at(1, 2), seatingColor('其他'), '賓2：排位用檔與正式表同色');
});

test('buildFormalAoa：不給 palette 就完全不上色（舊呼叫方式不會炸）', () => {
  const seats = [{ name: '甲', kind: 'emp', unit: '管理部', table: '1' }];
  const { fills, guestCells } = buildFormalAoa(seats, {});
  assert.deepEqual(fills, []);
  assert.deepEqual(guestCells, []);
});

test('buildFormalAoa：查不到分類的人不上色（不亂配一個顏色）', () => {
  const seats = [{ name: '甲', kind: 'emp', unit: '不在名單的單位', table: '1' }];
  const { fills } = buildFormalAoa(seats, {}, categoryPalette(['管理部'], []));
  assert.deepEqual(fills, [], '查無對應時寧可留白，也不套到別人的顏色');
});

test('buildFormalAoa：表頭列與人數列不上色（那兩列是桌號與統計，不屬於任何單位）', () => {
  const seats = [{ name: '甲', kind: 'emp', unit: '管理部', table: '1' }];
  const { aoa, fills } = buildFormalAoa(seats, {}, categoryPalette(['管理部'], []));
  assert.ok(!fills.some(f => f[0] === 0), '表頭列不得上色');
  assert.ok(!fills.some(f => f[0] === aoa.length - 1), '人數列不得上色');
  assert.ok(!fills.some(f => f[1] === 0), '席位序號欄不得上色');
});

test('parseSeatingUpload（新版）：表頭桌號、逐欄收人', () => {
  const aoa = [
    ['席次', 1, 2, 3, '檢核', '值'],
    [1, '王小明', '張三', '', '目前人數', 3],
    [2, '李美麗', '', '', '預定人數', 5],
    [],
    ['序號', '管理部', '陳大同'],
    [1, '未排的人', '家屬甲'],
  ];
  assert.deepEqual(parseSeatingUpload(aoa), [
    { name: '王小明', table: '1' }, { name: '李美麗', table: '1' }, { name: '張三', table: '2' }]);
});

test('parseSeatingUpload（新版）：去掉 (素) 類註記', () => {
  const aoa = [['席次', 5, 6], [1, '張三(素)', '李四（素）']];
  assert.deepEqual(parseSeatingUpload(aoa), [
    { name: '張三', table: '5' }, { name: '李四', table: '6' }]);
});

test('parseSeatingUpload（舊版相容）：A1=桌次 → 一列一桌照舊解析', () => {
  const aoa = [
    ['桌次', 1, 2, 3, '檢核', '值'],
    [1, '王小明', '李美麗', '', '目前人數', 2],
    [2, '張三', '', '', '預定人數', 3],
    [],
    ['序號', '管理部'],
    [1, '未排的人'],
  ];
  assert.deepEqual(parseSeatingUpload(aoa, 3), [
    { name: '王小明', table: '1' }, { name: '李美麗', table: '1' }, { name: '張三', table: '2' }]);
});

test('sortSeats：同仁依順位、來賓最後、同順位穩定', () => {
  const ranks = { '支店長': 1, '主任': 8 };
  const seats = [
    { name: '甲', title: '主任', kind: 'emp' },
    { name: '家屬甲', kind: 'guest' },
    { name: '乙', title: '支店長', kind: 'emp' },
    { name: '丙', title: '沒登錄', kind: 'emp' },
    { name: '丁', title: '主任', kind: 'emp' },
  ];
  assert.deepEqual(sortSeats(seats, ranks).map(s => s.name), ['乙', '甲', '丁', '丙', '家屬甲']);
});

test('buildFormalAoa：一欄一桌直排、桌次照原值、含人數列', () => {
  const seats = [
    { name: '乙', title: '支店長', kind: 'emp', table: '1' },
    { name: '甲', title: '主任', kind: 'emp', table: '1' },
    { name: '家屬甲', kind: 'guest', table: '1' },
    { name: '丙', title: '主任', kind: 'emp', table: '2' },
    { name: '丁', title: '主任', kind: 'emp', table: '' },   // 未排桌不列入
  ];
  const { aoa, guestCells } = buildFormalAoa(seats, { '支店長': 1, '主任': 8 });
  assert.deepEqual(aoa[0], ['席位', '1', '2']);
  assert.deepEqual(aoa[1], [1, '乙', '丙']);
  assert.deepEqual(aoa[2], [2, '甲', '']);
  assert.deepEqual(aoa[3], [3, '家屬甲', '']);
  assert.deepEqual(aoa[aoa.length - 1], ['人數', 3, 1]);
  assert.deepEqual(guestCells, [[3, 1]]);   // 來賓格 (row,col) 供上紅字
});

test('排位→上傳→正式表 往返：新版排位檔解析出來的桌次能還原', () => {
  const { aoa } = buildSeatingAoa(['管理部'], { '管理部': ['甲', '乙'] }, [], {}, 2);
  // 模擬使用者把「甲」放到 3 桌第 1 席、「乙」放到 5 桌第 2 席
  aoa[1][3] = '甲';   // 第 2 列（席次1）第 3 桌欄（index 3 → 桌號 aoa[0][3]=3）
  aoa[2][5] = '乙';
  const parsed = parseSeatingUpload(aoa);
  assert.deepEqual(parsed, [{ name: '甲', table: '3' }, { name: '乙', table: '5' }]);
});

test('groupSeatCategories：欄內依職稱位階排序，且與正式座位表同一套規則', () => {
  const ranks = { 支店長: 1, 部長: 3, 主任: 8 };
  const seats = [
    { name: '丙', kind: 'emp', unit: '管理部', title: '主任' },
    { name: '甲', kind: 'emp', unit: '管理部', title: '支店長' },
    { name: '丁', kind: 'emp', unit: '管理部', title: '沒登錄的職稱' },
    { name: '乙', kind: 'emp', unit: '管理部', title: '部長' },
  ];
  const g = groupSeatCategories(seats, [], ranks);
  assert.deepEqual(g.byUnit['管理部'], ['甲', '乙', '丙', '丁'], '位階小者在前、無順位殿後');
  // 正式座位表把同一群人放同一桌時，欄內順序必須一致（兩邊都走 sortSeats）
  const formal = buildFormalAoa(seats.map(s => ({ ...s, table: '1' })), ranks);
  assert.deepEqual(formal.aoa.slice(1, 5).map(r => r[1]), g.byUnit['管理部'],
    '排位用檔的單位欄順序＝正式座位表的同桌順序');
});

test('groupSeatCategories：單位欄序＝選項主檔（總公司優先），未列到的補在後面', () => {
  const rows = [
    { type: '單位', name: '施工部', group: '工地' },
    { type: '單位', name: '管理部', group: '總公司' },
    { type: '職稱', name: '主任', group: '總公司' },      // 非單位列不得混進來
    { type: '單位', name: '沒人參加的單位', group: '總公司' },
  ];
  const seats = [
    { name: '甲', kind: 'emp', unit: '施工部' },
    { name: '乙', kind: 'emp', unit: '管理部' },
    { name: '丙', kind: 'emp', unit: '主檔沒有的單位' },
  ];
  const g = groupSeatCategories(seats, rows, {});
  assert.deepEqual(g.unitOrder, ['管理部', '施工部', '主檔沒有的單位'],
    '總公司先、工地次之、主檔沒列到的殿後；沒人參加的單位不出現');
});

test('groupSeatCategories：來賓歸負責人、無負責人歸「其他」且不進 owners', () => {
  const seats = [
    { name: '賓1', kind: 'guest', unit: '王小明' },
    { name: '賓2', kind: 'guest', unit: '' },
    { name: '甲', kind: 'emp', unit: '' },
  ];
  const g = groupSeatCategories(seats, [], {});
  assert.deepEqual(g.owners, ['王小明'], '「其他」不列入 owners（欄序由 guestOwnerOrder 補在最後）');
  assert.deepEqual(g.guestsByOwner['其他'], ['賓2']);
  assert.deepEqual(g.byUnit['（未填單位）'], ['甲'], '沒填單位的同仁有自己的欄、不被丟掉');
  assert.equal(g.empCount, 1);
  assert.equal(g.guestSeats, 2);
});

test('groupSeatCategories → buildSeatingAoa：排好的順序真的落到分類名單上', () => {
  const ranks = { 支店長: 1, 主任: 8 };
  const seats = [
    { name: '丙', kind: 'emp', unit: '管理部', title: '主任' },
    { name: '甲', kind: 'emp', unit: '管理部', title: '支店長' },
  ];
  const g = groupSeatCategories(seats, [], ranks);
  const { aoa } = buildSeatingAoa(g.unitOrder, g.byUnit, g.owners, g.guestsByOwner, g.empCount);
  const h = SEAT_ROWS + 2;
  assert.equal(aoa[h][1], '管理部');
  assert.equal(aoa[h + 1][1], '甲', '第一列＝位階最高的');
  assert.equal(aoa[h + 2][1], '丙');
});

// ── 來賓上傳檔的素食人數展開 ──────────────────────────────────────────
test('expandGuestRow：5 人 2 素 → 席位 1、2 為素食', () => {
  assert.deepEqual(expandGuestRow(5, 2), [
    { seatNo: 1, veg: true }, { seatNo: 2, veg: true },
    { seatNo: 3, veg: false }, { seatNo: 4, veg: false }, { seatNo: 5, veg: false },
  ]);
});

test('expandGuestRow：素食人數超過參加人數 → 取小值，不得產生比席位多的素食', () => {
  assert.deepEqual(expandGuestRow(2, 5), [
    { seatNo: 1, veg: true }, { seatNo: 2, veg: true },
  ]);
});

test('expandGuestRow：舊檔沒有素食人數欄 → 全部 false', () => {
  assert.deepEqual(expandGuestRow(3, undefined), [
    { seatNo: 1, veg: false }, { seatNo: 2, veg: false }, { seatNo: 3, veg: false },
  ]);
  assert.deepEqual(expandGuestRow(3, ''), [
    { seatNo: 1, veg: false }, { seatNo: 2, veg: false }, { seatNo: 3, veg: false },
  ]);
});

test('expandGuestRow：參加人數 0 → 一列 seatNo 0（不佔位但保留這家廠商）', () => {
  assert.deepEqual(expandGuestRow(0, 0), [{ seatNo: 0, veg: false }]);
  assert.deepEqual(expandGuestRow('', 0), [{ seatNo: 0, veg: false }]);
});

test('expandGuestRow：負數素食人數當 0', () => {
  assert.deepEqual(expandGuestRow(2, -1), [
    { seatNo: 1, veg: false }, { seatNo: 2, veg: false },
  ]);
});

// ── 素食彙總 ──────────────────────────────────────────────────────────
test('vegSummary：只列有素食的桌，依桌號排序，未排桌殿後', () => {
  const seats = [
    { kind: 'emp', name: '甲', table: '3', veg: true },
    { kind: 'emp', name: '乙', table: '3', veg: false },
    { kind: 'emp', name: '丙', table: '1', veg: true },
    { kind: 'emp', name: '丁', table: '2', veg: false },   // 2 桌零素食 → 不得出現
    { kind: 'emp', name: '戊', table: '', veg: true },     // 未排桌
  ];
  const r = vegSummary(seats);
  assert.deepEqual(r.rows, [
    { table: '1', count: 1, names: ['丙'] },
    { table: '3', count: 1, names: ['甲'] },
    { table: '', count: 1, names: ['戊'] },
  ]);
  assert.equal(r.total, 3);
});

test('vegSummary：同桌多份彙總成一行', () => {
  const r = vegSummary([
    { kind: 'emp', name: '甲', table: '5', veg: true },
    { kind: 'emp', name: '乙', table: '5', veg: true },
  ]);
  assert.deepEqual(r.rows, [{ table: '5', count: 2, names: ['甲', '乙'] }]);
  assert.equal(r.total, 2);
});

test('vegSummary：同一家廠商的素食席位落在兩桌 → 列入 splitVendors 提示', () => {
  const r = vegSummary([
    { kind: 'guest', name: '某某工程行', table: '1', veg: true },
    { kind: 'guest', name: '某某工程行', table: '2', veg: true },
    { kind: 'guest', name: '另一家', table: '1', veg: true },
  ]);
  assert.deepEqual(r.splitVendors, ['某某工程行']);
  assert.equal(r.total, 3);
});

test('vegSummary：同一家廠商素食都在同一桌 → 不提示', () => {
  const r = vegSummary([
    { kind: 'guest', name: '某某工程行', table: '1', veg: true },
    { kind: 'guest', name: '某某工程行', table: '1', veg: true },
  ]);
  assert.deepEqual(r.splitVendors, []);
});

test('vegSummary：全部無素食 → 空清單、合計 0', () => {
  const r = vegSummary([{ kind: 'emp', name: '甲', table: '1', veg: false }]);
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.splitVendors, []);
});

test('vegSummary：veg 欄不存在（後端未上版）→ 不當成素食', () => {
  const r = vegSummary([{ kind: 'emp', name: '甲', table: '1' }]);
  assert.equal(r.total, 0);
});

// ── 兩份 Excel 帶素食 ─────────────────────────────────────────────────
// 2026-08-10 使用者拍板：排位用檔不需要素食資訊——排位是照單位與職稱排的，
// 素食是誰跟坐哪桌無關，標了只是雜訊。素食要查走桌次管理的「🥬 素食」視圖。
test('groupSeatCategories：分類名單只有姓名，不加素食後綴', () => {
  const seats = [
    { kind: 'emp', name: '甲一', unit: '管理部', title: '副理', veg: true },
    { kind: 'emp', name: '乙二', unit: '管理部', title: '課長', veg: false },
    { kind: 'guest', name: '某某工程行', unit: '甲一', veg: true },
  ];
  const g = groupSeatCategories(seats, [{ type: '單位', name: '管理部', group: '總公司' }], { '副理': 10, '課長': 20 });
  assert.deepEqual(g.byUnit['管理部'], ['甲一', '乙二']);
  assert.deepEqual(g.guestsByOwner['甲一'], ['某某工程行']);
});

test('parseSeatingUpload：帶「（素）」的名字上傳回來會被清成原名（既有行為，不可壞）', () => {
  const aoa = [['席次', 1, 2], [1, '甲一（素）', '乙二']];
  assert.deepEqual(parseSeatingUpload(aoa), [
    { name: '甲一', table: '1' }, { name: '乙二', table: '2' },
  ]);
});

test('buildFormalAoa：正式座位表的座位格不標素食（拍板：只要哪桌幾份）', () => {
  const { aoa } = buildFormalAoa([{ kind: 'emp', name: '甲一', unit: '管理部', table: '1', veg: true }], {});
  assert.equal(aoa[1][1], '甲一');
});

test('buildFormalAoa：表格最下方附素食彙總（桌號／份數／姓名）', () => {
  const { aoa } = buildFormalAoa([
    { kind: 'emp', name: '甲一', unit: '管理部', table: '1', veg: true },
    { kind: 'emp', name: '乙二', unit: '管理部', table: '1', veg: false },
    { kind: 'emp', name: '丙三', unit: '工務部', table: '2', veg: true },
  ], {});
  const flat = aoa.map((r) => r.join('|'));
  assert.ok(flat.some((r) => r.indexOf('素食彙總') >= 0), '應有「素食彙總」標題列');
  assert.ok(flat.some((r) => r.indexOf('甲一') >= 0 && r.indexOf('1') >= 0));
  assert.ok(flat.some((r) => r.indexOf('合計') >= 0 && r.indexOf('2') >= 0));
});

test('buildFormalAoa：零素食時不附彙總段（不留空標題）', () => {
  const { aoa } = buildFormalAoa([{ kind: 'emp', name: '甲一', unit: '管理部', table: '1', veg: false }], {});
  assert.ok(!aoa.map((r) => r.join('|')).some((r) => r.indexOf('素食彙總') >= 0));
});

// ── 排序：單位內＝職稱順位優先，同職稱再依員工編號 ────────────────────
// 2026-08-11 使用者指定：「排序一職稱、排序二員工編號」，通用到排位用檔與正式座位表。
test('sortSeats：同職稱時依員工編號小到大（11401 排在 11403 前）', () => {
  const seats = [
    { kind: 'emp', name: '乙', title: '主任', empNo: '11403' },
    { kind: 'emp', name: '甲', title: '主任', empNo: '11401' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['甲', '乙']);
});

test('sortSeats：職稱順位優先於員工編號（高職稱即使員編大也在前）', () => {
  const seats = [
    { kind: 'emp', name: '小主任', title: '主任', empNo: '00001' },
    { kind: 'emp', name: '大副理', title: '副理', empNo: '99999' },
  ];
  assert.deepEqual(sortSeats(seats, { 副理: 10, 主任: 30 }).map(s => s.name), ['大副理', '小主任']);
});

test('sortSeats：前導零的員編走數值比較（00008 在 06003 前）', () => {
  const seats = [
    { kind: 'emp', name: '乙', title: '主任', empNo: '06003' },
    { kind: 'emp', name: '甲', title: '主任', empNo: '00008' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['甲', '乙']);
});

test('sortSeats：沒有員編的人殿後（同職稱者中）', () => {
  const seats = [
    { kind: 'emp', name: '無編', title: '主任', empNo: '' },
    { kind: 'emp', name: '有編', title: '主任', empNo: '11401' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['有編', '無編']);
});

test('sortSeats：非數字員編退回字串比較，不得丟例外', () => {
  const seats = [
    { kind: 'emp', name: '乙', title: '主任', empNo: 'B002' },
    { kind: 'emp', name: '甲', title: '主任', empNo: 'A001' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['甲', '乙']);
});

test('sortSeats：來賓仍恆最後，不受員編規則影響', () => {
  const seats = [
    { kind: 'guest', name: '廠商', title: '', empNo: '' },
    { kind: 'emp', name: '員工', title: '主任', empNo: '99999' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['員工', '廠商']);
});

test('sortSeats：無職稱順位者仍殿後，但彼此之間依員編排', () => {
  const seats = [
    { kind: 'emp', name: '無銜乙', title: '', empNo: '11403' },
    { kind: 'emp', name: '無銜甲', title: '', empNo: '11401' },
    { kind: 'emp', name: '主任', title: '主任', empNo: '99999' },
  ];
  assert.deepEqual(sortSeats(seats, { 主任: 30 }).map(s => s.name), ['主任', '無銜甲', '無銜乙']);
});

// ── buildSigninPages（來賓簽到表）─────────────────────────────────────────

/** 造一家廠商的 n 席（seatNo 1..n），table 可為單值或逐席陣列。 */
function vendor(owner, name, n, table) {
  const out = [];
  if (n === 0) return [{ owner, name, seatNo: 0, table: '' }];
  for (let i = 1; i <= n; i++) {
    out.push({ owner, name, seatNo: i, table: Array.isArray(table) ? table[i - 1] : (table || '') });
  }
  return out;
}

test('buildSigninPages：參加人數 0 的廠商不列出來', () => {
  const pages = buildSigninPages([].concat(
    vendor('王小明', '甲營造', 2, '3'),
    vendor('王小明', '乙工程', 0),
    vendor('李美麗', '丙機電', 1, '5')));
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].left.map(e => e.name), ['甲營造', '丙機電']);
});

test('buildSigninPages：依桌次數字序（10 桌在 2 桌之後，不是字串比大小）', () => {
  const pages = buildSigninPages([].concat(
    vendor('a', '十桌家', 1, '10'),
    vendor('a', '二桌家', 1, '2'),
    vendor('a', '九桌家', 1, '9')));
  assert.deepEqual(pages[0].left.map(e => e.name), ['二桌家', '九桌家', '十桌家']);
  assert.deepEqual(pages[0].left.map(e => e.table), ['2桌', '9桌', '10桌']);
});

test('buildSigninPages：沒排桌的排最後、桌次欄留空', () => {
  const pages = buildSigninPages([].concat(
    vendor('a', '未排桌家', 2, ''),
    vendor('a', '五桌家', 1, '5')));
  assert.deepEqual(pages[0].left.map(e => e.name), ['五桌家', '未排桌家']);
  assert.equal(pages[0].left[1].table, '');
});

test('buildSigninPages：非數字桌名原樣保留、跨兩桌用「、」串起來', () => {
  const pages = buildSigninPages([].concat(
    vendor('a', '主桌家', 1, '主桌'),
    vendor('a', '跨桌家', 2, ['7', '8'])));
  const byName = {};
  pages[0].left.forEach(e => { byName[e.name] = e.table; });
  assert.equal(byName['跨桌家'], '7桌、8桌');
  assert.equal(byName['主桌家'], '主桌');
});

test('buildSigninPages：一頁 48 家（左 24 右 24），編號跨頁連續', () => {
  let rows = [];
  for (let i = 1; i <= 49; i++) rows = rows.concat(vendor('a', 'V' + i, 1, String(i)));
  const pages = buildSigninPages(rows);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].left.length, 24);
  assert.equal(pages[0].right.length, 24);
  assert.equal(pages[0].left[0].no, 1);
  assert.equal(pages[0].right[0].no, 25);
  assert.equal(pages[1].left.length, 1);
  assert.equal(pages[1].right.length, 0);
  assert.equal(pages[1].left[0].no, 49);
  assert.equal(pages[1].left[0].name, 'V49');
});

test('buildSigninPages：人數＝該廠商的席位數；名稱去掉 tab／全形空白', () => {
  const pages = buildSigninPages([].concat(
    vendor('a', '\t吉泰', 2, '11'),
    vendor('a', '富眾　', 1, '17')));
  assert.deepEqual(pages[0].left.map(e => e.name), ['吉泰', '富眾']);
  assert.deepEqual(pages[0].left.map(e => e.seats), [2, 1]);
});

test('buildSigninPages：全部 0 人或空名單 → 沒有任何頁（呼叫端據此擋下產檔）', () => {
  assert.deepEqual(buildSigninPages([]), []);
  assert.deepEqual(buildSigninPages(vendor('a', '乙工程', 0)), []);
});

test('buildSigninPages：同桌維持名單原順序（穩定排序）', () => {
  const pages = buildSigninPages([].concat(
    vendor('a', '後來的', 1, '3'),
    vendor('a', '先來的', 1, '3')));
  assert.deepEqual(pages[0].left.map(e => e.name), ['後來的', '先來的']);
});

test('buildSigninPages：沒有廠商名稱時，用「聯絡人」的人名頂上', () => {
  const pages = buildSigninPages([
    { _row: 2, owner: 'a', name: '', contact: '王大明', seatNo: 1, table: '3' },
    { _row: 3, owner: 'a', name: '甲營造', contact: '李小華', seatNo: 1, table: '4' },
  ]);
  assert.deepEqual(pages[0].left.map(e => e.name), ['王大明', '甲營造']);
  assert.equal(pages[0].left[1].name, '甲營造', '有廠商名稱時不會被聯絡人蓋掉');
});

test('buildSigninPages：同一位無廠商名的來賓佔兩席，聚合成一列人數 2', () => {
  const pages = buildSigninPages([
    { _row: 2, owner: 'a', name: '', contact: '王大明', seatNo: 1, table: '3' },
    { _row: 3, owner: 'a', name: '', contact: '王大明', seatNo: 2, table: '3' },
  ]);
  assert.equal(pages[0].left.length, 1);
  assert.equal(pages[0].left[0].seats, 2);
});

test('buildSigninPages：無廠商名的人不會跟同名的廠商併成一列', () => {
  const pages = buildSigninPages([
    { _row: 2, owner: 'a', name: '', contact: '王大明', seatNo: 1, table: '3' },
    { _row: 3, owner: 'a', name: '王大明', contact: '', seatNo: 1, table: '3' },
  ]);
  assert.equal(pages[0].left.length, 2, '一個是廠商、一個是個人來賓，是兩列');
});

test('buildSigninPages：廠商名與聯絡人都空白也不丟掉——列出來並標記，讓呼叫端能報給使用者', () => {
  const pages = buildSigninPages([
    { _row: 2, owner: '王小明', name: '', contact: '', seatNo: 1, table: '3' },
    { _row: 3, owner: '王小明', name: '', contact: '', seatNo: 2, table: '3' },
    { _row: 4, owner: '王小明', name: '甲營造', contact: '', seatNo: 1, table: '4' },
  ]);
  const rows = pages[0].left;
  assert.equal(rows.length, 2, '無名那筆仍佔一列，沒有被靜默丟掉');
  const blank = rows.filter(e => e.unnamed);
  assert.equal(blank.length, 1);
  assert.equal(blank[0].name, '', '姓名欄留白等人工補');
  assert.equal(blank[0].seats, 2, '同一位負責人底下的無名席位併成一列，人數不會漏');
  assert.ok(!rows.find(e => e.name === '甲營造').unnamed, '有名字的不該被標記');
});

test('buildSigninPages：無名但 0 席，一樣不列（0 人不列的規則優先）', () => {
  assert.deepEqual(buildSigninPages([{ _row: 2, owner: 'a', name: '', contact: '', seatNo: 0, table: '' }]), []);
});
