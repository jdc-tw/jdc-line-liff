const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * I4：年資里程碑卡的「（留停）」標記。
 *
 * 為何存在（2026-08-28 最終審查 I4）：anniv.js 原本讀 `o.onLeave`，
 * 但 getAnniversaries 回的是 pickAnniversaries 的列，那支只加了 `status`、
 * **從來沒有 onLeave 這個欄位** ⇒ 恆為 undefined、標記永遠不出現，零錯誤訊息。
 * 這支直接跑繪製函式、看產出的 HTML 裡有沒有那三個字。
 */
const { annivPaint_, annivOnLeave_ } = require('../assets/anniv.js');

/** 最小假 DOM：annivPaint_ 只碰 getElementById → innerHTML / style。 */
function fakeBox() {
  const box = { innerHTML: '', style: {} };
  global.document = { getElementById: (id) => (id === 'anniv-box' ? box : null) };
  return box;
}

const ROW = (name, status) => ({ name, unit: 'A部', years: 10, date: '2016-01-01', status });

test('I4：留停者的名字後面帶「（留停）」', () => {
  const box = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [ROW('留停乙', '留職停薪')] });
  assert.ok(box.innerHTML.indexOf('留停乙（留停）') >= 0,
    `標記沒有出現——這正是 o.onLeave 恆為 undefined 的樣子。實際輸出：\n${box.innerHTML}`);
});

test('I4：在職者（空白與「在職」兩種寫法）都不帶標記', () => {
  const box = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [ROW('在職甲', ''), ROW('在職丁', '在職')] });
  assert.ok(box.innerHTML.indexOf('在職甲（留停）') < 0);
  assert.ok(box.innerHTML.indexOf('在職丁（留停）') < 0);
  assert.ok(box.innerHTML.indexOf('在職甲') >= 0, '人還是要在名單上');
});

test('I4：沒有 status 欄位的舊快取列不炸、也不誤標', () => {
  const box = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [{ name: '舊甲', unit: 'A部', years: 5, date: '2021-01-01' }] });
  assert.ok(box.innerHTML.indexOf('舊甲') >= 0);
  assert.ok(box.innerHTML.indexOf('（留停）') < 0);
});

test('I4：判定走 roster-wide.js 的 jdcIsSeparated／jdcIsOnDuty（禁止前端重建字面比對）', () => {
  assert.strictEqual(annivOnLeave_({ status: '留職停薪' }), true);
  assert.strictEqual(annivOnLeave_({ status: '  留職停薪  ' }), true, 'trim 要跟後端一致');
  assert.strictEqual(annivOnLeave_({ status: '離職' }), false, '離職不是留停（pickAnniversaries 本來就已濾掉）');
  assert.strictEqual(annivOnLeave_({ status: '在職' }), false);
  assert.strictEqual(annivOnLeave_({ status: '' }), false);
  assert.strictEqual(annivOnLeave_({}), false);
});

test('I4：anniv.js 不得自己重建在職狀態字面比對（Ruling R15）', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'anniv.js'), 'utf8');
  const hits = SRC.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter((x) => /[=!]==\s*'(離職|留職停薪|在職)'/.test(x.l));
  assert.deepStrictEqual(hits.map((x) => x.n + ': ' + x.l.trim()), [],
    '前端重建字面比對＝與後端 isSeparated／isOnDuty 分岔，且分岔時零錯誤訊息');
});
