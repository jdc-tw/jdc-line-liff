const { test } = require('node:test');
const assert = require('node:assert');
const { buildRosterWide, jdcIsSeparated, jdcIsOnDuty } = require('../assets/roster-wide.js');

const OPTS = [
  { type: '單位', name: '管理部', group: '總公司' },
  { type: '單位', name: '工務管理', group: '總公司' },
  { type: '單位', name: '南港玉成', group: '工地' },
  { type: '單位', name: '富貴莊園', group: '工地' },
  { type: '職稱', name: '副理', group: '行政／管理' },   // 職稱列要被忽略
];
function p(name, unit, status) { return { name: name, unit: unit, status: status || '在職' }; }

test('單位欄序＝選項主檔列序、總公司在前工地在後；只列在職', () => {
  const rows = [
    p('甲一', '南港玉成'), p('乙一', '管理部'), p('乙二', '管理部'),
    p('丙一', '工務管理'), p('離人', '富貴莊園', '離職'),
  ];
  const aoa = buildRosterWide(rows, OPTS, '2026/07/16');
  // 富貴莊園整欄無在職者 → 不出欄
  assert.deepStrictEqual(aoa[0].slice(0, 4), ['序號', '管理部', '工務管理', '南港玉成']);
  // 表頭右側 metadata
  assert.deepStrictEqual(aoa[0].slice(-3), ['', '員工名冊更新日期', '2026/07/16']);
  // 第一資料列：序號 1＋各欄第一人＋總人數（在職 4 人，離職不算）
  assert.deepStrictEqual(aoa[1].slice(0, 4), [1, '乙一', '丙一', '甲一']);
  assert.deepStrictEqual(aoa[1].slice(-3), ['', '員工總人數', 4]);
  // 第二資料列：只有管理部還有人，其他欄留空；無 metadata 尾巴
  assert.deepStrictEqual(aoa[2], [2, '乙二', '', '']);
  assert.strictEqual(aoa.length, 3); // header＋最深單位 2 列
});

test('名冊有、選項主檔沒有的單位排最後（防禦）', () => {
  const rows = [p('甲', '管理部'), p('乙', '神秘單位')];
  const aoa = buildRosterWide(rows, OPTS, '2026/07/16');
  assert.deepStrictEqual(aoa[0].slice(0, 3), ['序號', '管理部', '神秘單位']);
});

test('單位空白歸「（未填單位）」欄', () => {
  const rows = [p('甲', '')];
  const aoa = buildRosterWide(rows, OPTS, '2026/07/16');
  assert.strictEqual(aoa[0][1], '（未填單位）');
  assert.strictEqual(aoa[1][1], '甲');
});

test('includeLeavers=true：離職者列入並加（離職）標記、總人數仍只數在職', () => {
  const rows = [p('甲一', '管理部'), p('離人', '管理部', '離職')];
  const aoa = buildRosterWide(rows, OPTS, '2026/07/17', { includeLeavers: true });
  assert.deepStrictEqual([aoa[1][1], aoa[2][1]], ['甲一', '離人（離職）']);
  assert.deepStrictEqual(aoa[1].slice(-2), ['員工總人數', 1]);
});

test('留停者預設就列出，姓名加「（留停）」標記；不計入員工總人數', () => {
  const rows = [p('甲一', '管理部'), p('留停乙', '管理部', '留職停薪')];
  const aoa = buildRosterWide(rows, [{ type: '單位', name: '管理部', group: '總公司' }], '2026/08/28');
  assert.deepStrictEqual([aoa[1][1], aoa[2][1]], ['甲一', '留停乙（留停）']);
  assert.strictEqual(aoa[1][aoa[1].length - 1], 1);   // 員工總人數只數在勤
});

// jdcIsSeparated／jdcIsOnDuty：語意須與後端 binding.js 的 isSeparated／isOnDuty 完全一致（Ruling R15）。
test('jdcIsSeparated：只有「離職」為 true，含 null／undefined／空白／前後空白', () => {
  assert.strictEqual(jdcIsSeparated('離職'), true);
  assert.strictEqual(jdcIsSeparated('  離職  '), true);
  assert.strictEqual(jdcIsSeparated('留職停薪'), false);
  assert.strictEqual(jdcIsSeparated('在職'), false);
  assert.strictEqual(jdcIsSeparated(''), false);
  assert.strictEqual(jdcIsSeparated(null), false);
  assert.strictEqual(jdcIsSeparated(undefined), false);
});

test('jdcIsOnDuty：離職與留職停薪皆 false，空白＝在職＝true，含 null／undefined／前後空白', () => {
  assert.strictEqual(jdcIsOnDuty('離職'), false);
  assert.strictEqual(jdcIsOnDuty('留職停薪'), false);
  assert.strictEqual(jdcIsOnDuty('  留職停薪  '), false);
  assert.strictEqual(jdcIsOnDuty('在職'), true);
  assert.strictEqual(jdcIsOnDuty(''), true);
  assert.strictEqual(jdcIsOnDuty(null), true);
  assert.strictEqual(jdcIsOnDuty(undefined), true);
});
