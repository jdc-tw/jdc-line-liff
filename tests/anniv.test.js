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

/* ══ 「被擋住」與「沒有資料」必須走不同的路（2026-09-12，E1a）═══════════
 *
 * 🔴 為何存在：原本這兩種語意擠在**同一個運算式**的兩側——
 *    `annivEsc_((r && !r.ok && r.msg) || emptyText)`，而外層 class 寫死 `.empty`
 *    （這一頁用來說「這一區沒有資料」的樣式）。
 *    ⇒ 被擋在門外的人看到的東西，跟「今年沒有人逢五週年」長得一模一樣。
 *
 * ⚠️ **判準是「走了哪一條路」，不是「顏色對不對」。** 顏色寫死在測試裡等於把同一個值
 *    抄第二份；而且失敗樣式根本不由本檔決定（呼叫端傳 failBox 進來）。
 *
 * ⚠️ 這條路在 board.html 上**曾經是死路**：它當時沒傳 opts ⇒ emptyText 是 undefined
 *    ⇒ `if (emptyText)` 恆假 ⇒ 後端失敗時整塊靜靜不顯示。同一次已把 failBox 傳進去，
 *    所以它現在是活的。**先量再改**——這段話是量出來的，不是讀出來的。
 */
/** 呼叫端供給的失敗樣式（board.html 的 failBox 就是這個形狀）。 */
const FAIL = (msg, fb) => '<div class="msg msg-err show">' + (msg || fb) + '</div>';

test('⬛ 對照組：有資料時照樣畫名單（否則下面在驗一堆沒發生的事）', () => {
  const box = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [ROW('在職甲', '在職')] }, { failBox: FAIL });
  assert.ok(box.innerHTML.indexOf('在職甲') >= 0, '有資料卻沒畫出來');
  assert.equal(box.innerHTML.indexOf('msg-err'), -1, '有資料卻畫成失敗');
});

test('🔴 後端回失敗 → 走 failBox 那條路，不可以走 .empty', () => {
  const box = fakeBox();
  annivPaint_({ ok: false, msg: '您的 LINE 帳號還沒有完成員工身分綁定' },
    { emptyText: '今年沒有人逢五週年', failBox: FAIL });
  assert.ok(box.innerHTML.indexOf('您的 LINE 帳號還沒有完成員工身分綁定') >= 0,
    `後端那句話不見了。實際輸出：\n${box.innerHTML}`);
  assert.equal(box.innerHTML.indexOf('class="empty"'), -1,
    `被擋住卻走了「沒有資料」那條路 ⇒ 他不知道自己被擋住了。實際輸出：\n${box.innerHTML}`);
});

test('🔴 沒有資料 → 走 .empty，而且不可以帶上任何失敗樣式', () => {
  const box = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [] },
    { emptyText: '今年沒有人逢五週年', failBox: FAIL });
  assert.ok(box.innerHTML.indexOf('今年沒有人逢五週年') >= 0, '空狀態文字沒出現');
  assert.equal(box.innerHTML.indexOf('msg-err'), -1,
    `沒有資料卻畫成錯誤 ⇒ 反過來嚇人。實際輸出：\n${box.innerHTML}`);
});

test('🔴 兩種狀態畫出來的東西必須不同（這就是這一格要買的）', () => {
  const a = fakeBox();
  annivPaint_({ ok: false, msg: '被擋住了' }, { emptyText: '沒有人', failBox: FAIL });
  const blocked = a.innerHTML;
  const b = fakeBox();
  annivPaint_({ ok: true, year: 2026, rows: [] }, { emptyText: '沒有人', failBox: FAIL });
  const empty = b.innerHTML;
  assert.ok(blocked && empty, '有一種狀態什麼都沒畫 ⇒ 這條在比空字串');
  assert.notEqual(blocked, empty, '「被擋住」與「沒有資料」畫出一模一樣的東西');
});

test('沒傳 failBox → 失敗時不畫（維持舊行為，且不在本檔自備第二份樣式）', () => {
  const box = fakeBox();
  annivPaint_({ ok: false, msg: '被擋住了' }, { emptyText: '沒有人' });
  assert.equal(box.innerHTML, '', '沒有 failBox 卻自己畫了東西 ⇒ 本檔長出了第二份失敗樣式');
});

test('🔴 失敗訊息要逸出（後端的字不可以當成 HTML）', () => {
  const box = fakeBox();
  const ESC = (msg, fb) => '<div class="msg msg-err show">'
    + String(msg == null ? fb : msg).replace(/</g, '&lt;') + '</div>';
  annivPaint_({ ok: false, msg: '<img src=x onerror=1>' }, { failBox: ESC });
  assert.equal(box.innerHTML.indexOf('<img'), -1, '失敗訊息原樣進了 innerHTML');
});
