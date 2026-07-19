const { test } = require('node:test');
const assert = require('node:assert');
const { buildSeatingAoa, expandGuests, SEAT_COLS, TABLE_ROWS } = require('../assets/seating.js');

test('expandGuests：參加人數 N→N 格、0 不出、簡稱去前導tab', () => {
  const guests = [
    { owner: '***REMOVED***', name: '\t***REMOVED***', count: 2 },
    { owner: '***REMOVED***', name: '***REMOVED***', count: 0 },
    { owner: '***REMOVED***', name: '***REMOVED***', count: 1 },
  ];
  const g = expandGuests(guests);
  assert.deepEqual(g, { '***REMOVED***': ['***REMOVED***', '***REMOVED***'], '***REMOVED***': ['***REMOVED***'] });
});

test('buildSeatingAoa：上方座位格＋下方分類名單區', () => {
  const attendeesByUnit = { '管理部': ['王小明', '李美麗'], '南港玉成': ['張三'] };
  const guestsByOwner = { '***REMOVED***': ['***REMOVED***', '***REMOVED***'] };
  const aoa = buildSeatingAoa(['管理部', '南港玉成'], attendeesByUnit, ['***REMOVED***'], guestsByOwner);
  // 表頭：桌次 + 1..SEAT_COLS + 目前人數
  assert.equal(aoa[0][0], '桌次');
  assert.equal(aoa[0][1], 1);
  assert.equal(aoa[0][SEAT_COLS], SEAT_COLS);
  assert.equal(aoa[0][SEAT_COLS + 1], '目前人數');
  // 桌列：A=桌號、其餘空
  assert.equal(aoa[1][0], 1);
  assert.equal(aoa[TABLE_ROWS][0], TABLE_ROWS);
  // 空行後的分類表頭：序號 + 單位欄 + 負責人欄 + 其他
  const hdrRow = TABLE_ROWS + 2;
  assert.equal(aoa[hdrRow][0], '序號');
  assert.equal(aoa[hdrRow][1], '管理部');
  assert.equal(aoa[hdrRow][2], '南港玉成');
  assert.equal(aoa[hdrRow][3], '***REMOVED***');
  assert.equal(aoa[hdrRow][4], '其他');
  // 名單直放
  assert.equal(aoa[hdrRow + 1][1], '王小明');
  assert.equal(aoa[hdrRow + 2][1], '李美麗');
  assert.equal(aoa[hdrRow + 1][2], '張三');
  assert.equal(aoa[hdrRow + 1][3], '***REMOVED***');
  assert.equal(aoa[hdrRow + 2][3], '***REMOVED***');
  // 序號欄
  assert.equal(aoa[hdrRow + 1][0], 1);
  assert.equal(aoa[hdrRow + 2][0], 2);
});
