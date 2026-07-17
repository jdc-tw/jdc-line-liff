const { test } = require('node:test');
const assert = require('node:assert');
const { buildRosterWide, buildRosterFlat } = require('../assets/roster-wide.js');

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

// ── 逐人明細（直表）─────────────────────────────────────────────
function q(empNo, name, unit, title, status) {
  return { empNo: empNo, name: name, unit: unit, title: title, status: status || '在職' };
}

test('直表：欄位＝員編/姓名/單位/職稱、單位序同寬表、只列在職、右上 metadata', () => {
  const rows = [
    q('00003', '甲一', '南港玉成', '工程師'),
    q('00001', '乙一', '管理部', '副理'),
    q('00002', '丙一', '工務管理', '主任'),
    q('00009', '離人', '富貴莊園', '所長', '離職'),
  ];
  const aoa = buildRosterFlat(rows, OPTS, '2026/07/17');
  assert.deepStrictEqual(aoa[0], ['員工編號', '姓名', '單位', '職稱', '', '員工名冊更新日期', '2026/07/17']);
  // 單位序：管理部 → 工務管理 → 南港玉成；首資料列尾帶總人數
  assert.deepStrictEqual(aoa[1], ['00001', '乙一', '管理部', '副理', '', '員工總人數', 3]);
  assert.deepStrictEqual(aoa[2], ['00002', '丙一', '工務管理', '主任']);
  assert.deepStrictEqual(aoa[3], ['00003', '甲一', '南港玉成', '工程師']);
  assert.strictEqual(aoa.length, 4); // 離職不列
});

test('直表：主檔沒有的單位排最後、空單位歸（未填單位）', () => {
  const rows = [q('1', '甲', '神秘單位', 'X'), q('2', '乙', '管理部', 'Y'), q('3', '丙', '', 'Z')];
  const aoa = buildRosterFlat(rows, OPTS, '2026/07/17');
  assert.deepStrictEqual(aoa.slice(1).map(function (r) { return r[1]; }), ['乙', '甲', '丙']);
  assert.strictEqual(aoa[3][2], '（未填單位）');
});
