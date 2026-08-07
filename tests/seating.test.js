const { test } = require('node:test');
const assert = require('node:assert');
const { buildSeatingAoa, expandGuests, parseSeatingUpload, sortSeats,
        buildFormalAoa, pastelPalette, guestGradient, SEAT_ROWS, TABLE_COLS } = require('../assets/seating.js');

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
