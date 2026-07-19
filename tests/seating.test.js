const { test } = require('node:test');
const assert = require('node:assert');
const { buildSeatingAoa, expandGuests, parseSeatingUpload, sortSeats,
        buildFormalAoa, SEAT_COLS, TABLE_ROWS } = require('../assets/seating.js');

test('expandGuests：一席一列展開（seatNo>0 才佔位）', () => {
  const guests = [
    { owner: '王建堃', name: '吉泰', seatNo: 1 },
    { owner: '王建堃', name: '吉泰', seatNo: 2 },
    { owner: '王建堃', name: '金亞', seatNo: 0 },
    { owner: '李隆基', name: '永洋', seatNo: 1 },
  ];
  assert.deepEqual(expandGuests(guests), { '王建堃': ['吉泰', '吉泰'], '李隆基': ['永洋'] });
});

test('buildSeatingAoa：28 桌、A 欄純數字、含檢核公式與剩餘列', () => {
  const aoa = buildSeatingAoa(['管理部'], { '管理部': ['甲', '乙'] }, ['王建堃'], { '王建堃': ['吉泰'] }, 3);
  assert.equal(aoa[0][0], '桌次');
  assert.equal(aoa[0][SEAT_COLS + 1], '檢核');
  assert.equal(aoa[1][0], 1);                       // A 欄純數字（不寫主桌）
  assert.equal(aoa[TABLE_ROWS][0], TABLE_ROWS);
  assert.equal(TABLE_ROWS, 28);
  // 檢核區
  assert.equal(aoa[1][SEAT_COLS + 1], '目前人數');
  assert.ok(String(aoa[1][SEAT_COLS + 2]).startsWith('=COUNTA('));
  assert.equal(aoa[2][SEAT_COLS + 1], '預定人數');
  assert.equal(aoa[2][SEAT_COLS + 2], 3);           // 傳入的 expected
  assert.equal(aoa[4][SEAT_COLS + 1], '檢核差額（0＝沒漏）');
  // 分類名單
  const h = TABLE_ROWS + 2;
  assert.equal(aoa[h][0], '序號');
  assert.equal(aoa[h][1], '管理部');
  assert.equal(aoa[h][2], '王建堃');
  assert.equal(aoa[h + 1][1], '甲');
  assert.equal(aoa[h + 1][2], '吉泰');
  // 剩餘列（COUNTA）
  const rem = aoa[aoa.length - 2];
  assert.equal(rem[0], '剩餘');
  assert.ok(String(rem[1]).startsWith('=COUNTA('));
});

test('parseSeatingUpload：讀座位格→{name, table}[]，跳過空格與非座位區', () => {
  const aoa = [
    ['桌次', 1, 2, 3, '檢核', '值'],
    [1, '王小明', '李美麗', '', '目前人數', 2],
    [2, '張三', '', '', '預定人數', 3],
    [],
    ['序號', '管理部', '王建堃'],
    [1, '未排的人', '吉泰'],
  ];
  assert.deepEqual(parseSeatingUpload(aoa, 3), [
    { name: '王小明', table: '1' }, { name: '李美麗', table: '1' }, { name: '張三', table: '2' }]);
});

test('parseSeatingUpload：去掉 (素) 類註記、保留主體名', () => {
  const aoa = [['桌次', 1, 2], [5, '彭莉涵(素)', '呂旻恩（素）']];
  assert.deepEqual(parseSeatingUpload(aoa, 2), [
    { name: '彭莉涵', table: '5' }, { name: '呂旻恩', table: '5' }]);
});

test('sortSeats：同仁依順位、來賓最後、同順位穩定', () => {
  const ranks = { '支店長': 1, '主任': 8 };
  const seats = [
    { name: '甲', title: '主任', kind: 'emp' },
    { name: '吉泰', kind: 'guest' },
    { name: '乙', title: '支店長', kind: 'emp' },
    { name: '丙', title: '沒登錄', kind: 'emp' },
    { name: '丁', title: '主任', kind: 'emp' },
  ];
  assert.deepEqual(sortSeats(seats, ranks).map(s => s.name), ['乙', '甲', '丁', '丙', '吉泰']);
});

test('buildFormalAoa：一欄一桌直排、桌次照原值、含人數列', () => {
  const seats = [
    { name: '乙', title: '支店長', kind: 'emp', table: '1' },
    { name: '甲', title: '主任', kind: 'emp', table: '1' },
    { name: '吉泰', kind: 'guest', table: '1' },
    { name: '丙', title: '主任', kind: 'emp', table: '2' },
    { name: '丁', title: '主任', kind: 'emp', table: '' },   // 未排桌不列入
  ];
  const { aoa, guestCells } = buildFormalAoa(seats, { '支店長': 1, '主任': 8 });
  assert.deepEqual(aoa[0], ['席位', '1', '2']);
  assert.deepEqual(aoa[1], [1, '乙', '丙']);
  assert.deepEqual(aoa[2], [2, '甲', '']);
  assert.deepEqual(aoa[3], [3, '吉泰', '']);
  assert.deepEqual(aoa[aoa.length - 1], ['人數', 3, 1]);
  assert.deepEqual(guestCells, [[3, 1]]);   // 來賓格 (row,col) 供上紅字
});

test('parseSeatingUpload：分隔空行被刪掉時，序號列不會被誤當桌號（靠 22 欄外的資料形狀無法判斷→至少不重覆收人）', () => {
  const aoa = [
    ['桌次', 1, 2],
    [1, '王小明', ''],
    ['序號', '管理部', '王建堃'],   // 表頭非數字→跳過
    [1, '未排的人', '吉泰'],        // 無分隔行時仍會被讀到（已知限制）
  ];
  const r = parseSeatingUpload(aoa, 2);
  assert.ok(r.some(x => x.name === '王小明'));
});

test('buildSeatingAoa：檢核公式互相對得上（預定−目前−未排定）', () => {
  const aoa = buildSeatingAoa(['A'], { 'A': ['甲'] }, [], {}, 1);
  const CV = SEAT_COLS + 2;                       // 值欄 index 24 → Excel Y
  assert.equal(aoa[1][CV], '=COUNTA(B2:W29)');    // 目前人數涵蓋 B..W 全 22 席×28 桌
  assert.equal(aoa[4][CV], '=Y3-Y2-Y4');          // 預定−目前−未排定
});
