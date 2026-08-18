const { test } = require('node:test');
const assert = require('node:assert');
const { esc, col, sinceText, batchesHtml } = require('../assets/messages-view.js');

const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];

function row(o) {
  return H.map(function (h) { return o[h] == null ? '' : o[h]; });
}

test('esc 跳脫 & < > " 四個字元', () => {
  assert.strictEqual(esc('<script>'), '&lt;script&gt;');
  assert.strictEqual(esc('a & b'), 'a &amp; b');
  assert.strictEqual(esc('say "hi"'), 'say &quot;hi&quot;');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(0), '0');
});

test('col 依欄名取值，找不到那一欄回空字串', () => {
  const r = row({ 對象姓名: '王小明' });
  assert.strictEqual(col(H, r, '對象姓名'), '王小明');
  assert.strictEqual(col(H, r, '不存在的欄'), '');
  assert.strictEqual(col([], r, '對象姓名'), '');
});

test('紀錄起始日沒設時要明講，不可留白', () => {
  assert.deepStrictEqual(sinceText('2026-08-19'),
    { text: '紀錄自 2026-08-19 起。在那之前發送的訊息沒有紀錄。', warn: false });
  const none = sinceText('');
  assert.strictEqual(none.warn, true);
  assert.ok(none.text.indexOf('未設定') >= 0, '要說出「未設定」，不能留白');
});

test('依批次聚合：同批次的多則收在同一個摺疊區塊', () => {
  const rows = [
    row({ 批次: 'b1', 對象姓名: '甲', 結果: '成功', 來源: 'bind_success', 發送時間: 't1' }),
    row({ 批次: 'b1', 對象姓名: '乙', 結果: '成功', 來源: 'bind_success', 發送時間: 't1' }),
    row({ 批次: 'b2', 對象姓名: '丙', 結果: '成功', 來源: 'checkin_done', 發送時間: 't2' }),
  ];
  const html = batchesHtml(H, rows);
  assert.strictEqual((html.match(/<details/g) || []).length, 2, '兩個批次＝兩個區塊');
  assert.ok(html.indexOf('2 則') >= 0);
  assert.ok(html.indexOf('1 則') >= 0);
});

test('有失敗時標題要標紅字並算對筆數', () => {
  const rows = [
    row({ 批次: 'b1', 結果: '成功' }),
    row({ 批次: 'b1', 結果: '失敗', 錯誤: '400 Invalid to' }),
  ];
  const html = batchesHtml(H, rows);
  assert.ok(html.indexOf('class="fail">失敗 1') >= 0, '失敗數要標紅');
  assert.ok(html.indexOf('成功 1') >= 0);
});

// ══ XSS ═══════════════════════════════════════════════════════════════
// 「來源」由呼叫端（line-platform 或日後第二個平台）提供，原樣寫進試算表
// 再渲染進 innerHTML。計畫的原始版本把批次標題那行直接串接、沒有 esc()，
// 這幾支就是釘住那個修正。
test('XSS：批次標題的「來源」必須跳脫', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = batchesHtml(H, [row({ 批次: 'b1', 來源: evil, 結果: '成功' })]);
  assert.ok(html.indexOf(evil) < 0, '未跳脫的標籤原文不得出現在輸出裡');
  assert.ok(html.indexOf('&lt;img') >= 0, '應該被跳脫成 &lt;img');
});

test('XSS：批次標題的「發送時間」必須跳脫', () => {
  const evil = '<svg onload=alert(1)>';
  const html = batchesHtml(H, [row({ 批次: 'b1', 發送時間: evil, 結果: '成功' })]);
  assert.ok(html.indexOf(evil) < 0);
  assert.ok(html.indexOf('&lt;svg') >= 0);
});

test('XSS：表格內每一個資料欄位都必須跳脫', () => {
  const evil = '<script>x</script>';
  const fields = ['對象姓名', '對象單位', '訊息型別', '訊息內容', '附件', '結果', '錯誤'];
  fields.forEach(function (f) {
    const o = { 批次: 'b1' };
    o[f] = evil;
    const html = batchesHtml(H, [row(o)]);
    assert.ok(html.indexOf(evil) < 0, f + ' 欄沒有跳脫');
  });
});

test('XSS：對象姓名為空時退回顯示 UserID，那個也要跳脫', () => {
  const evil = '<b>U1</b>';
  const html = batchesHtml(H, [row({ 批次: 'b1', 對象姓名: '', 對象UserID: evil })]);
  assert.ok(html.indexOf(evil) < 0);
});

test('批次代號是原型鏈上的名字時不得讓聚合出錯', () => {
  const rows = [
    row({ 批次: '__proto__', 對象姓名: '甲' }),
    row({ 批次: 'constructor', 對象姓名: '乙' }),
  ];
  const html = batchesHtml(H, rows);
  assert.strictEqual((html.match(/<details/g) || []).length, 2);
});
