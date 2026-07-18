const { test } = require('node:test');
const assert = require('node:assert');
const { parseTablePaste, matchByName, diffWrites } = require('../assets/table-import.js');

test('parseTablePaste：tab 分隔（Excel 複製）', () => {
  assert.deepEqual(parseTablePaste('王小明\t1\n李美麗\t主桌\n'), [
    { name: '王小明', table: '1' }, { name: '李美麗', table: '主桌' }]);
});

test('parseTablePaste：空白分隔、跳過空行與表頭', () => {
  assert.deepEqual(parseTablePaste('姓名 桌次\n王小明  3\n\n張三　5'), [
    { name: '王小明', table: '3' }, { name: '張三', table: '5' }]);
});

test('parseTablePaste：tab 分隔時名內空白保留（王 瑩）', () => {
  assert.deepEqual(parseTablePaste('王 瑩\t3'), [{ name: '王 瑩', table: '3' }]);
});

test('parseTablePaste：只有一欄的行列入 unparsed', () => {
  const rows = parseTablePaste('王小明\n李美麗\t2');
  assert.deepEqual(rows, [{ name: '王小明', table: '' }, { name: '李美麗', table: '2' }]);
});

const PEOPLE = [
  { userId: 'u1', name: '王小明', unit: '管理部', table: '' },
  { userId: 'u2', name: '李美麗', unit: '施工部', table: '2' },
  { userId: 'u3', name: '王 瑩', unit: '管理部', table: '' },
  { userId: 'u4', name: '陳大同', unit: '南港玉成', table: '' },
  { userId: 'u5', name: '陳大同', unit: '富貴莊園', table: '' },
];

test('matchByName：正常比對＋姓名空白正規化', () => {
  const r = matchByName([{ name: '王小明', table: '1' }, { name: '王瑩', table: '3' }], PEOPLE);
  assert.deepEqual(r.writes, [{ userId: 'u1', table: '1' }, { userId: 'u3', table: '3' }]);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.ambiguous, []);
});

test('matchByName：查無→unmatched；同名多人→ambiguous', () => {
  const r = matchByName([{ name: '不存在', table: '1' }, { name: '陳大同', table: '4' }], PEOPLE);
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.unmatched, [{ name: '不存在', table: '1' }]);
  assert.deepEqual(r.ambiguous, [{ name: '陳大同', table: '4', candidates: [
    { userId: 'u4', name: '陳大同', unit: '南港玉成', table: '' },
    { userId: 'u5', name: '陳大同', unit: '富貴莊園', table: '' }] }]);
});

test('diffWrites：與現值相同的不寫', () => {
  const cur = { u1: '', u2: '2', u3: '3' };
  assert.deepEqual(diffWrites([
    { userId: 'u1', table: '1' },   // 空→1 要寫
    { userId: 'u2', table: '2' },   // 同值不寫
    { userId: 'u3', table: '' },    // 3→空 要寫（清桌次）
  ], cur), [{ userId: 'u1', table: '1' }, { userId: 'u3', table: '' }]);
});
