const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * C1：核准前的員編撞號警語（board.html）。
 *
 * 為何存在（2026-08-28 最終審查 C1）：留停者換 LINE 帳號回鍋報到時，
 * 人事按下「核准報到」＝**覆寫名冊上那一列**。拍板是放行，但畫面要先指名道姓
 * 講清楚覆寫的是誰。離職列原本是靜默覆寫，一併補上。
 *
 * ⚠️ 這支盯的是最容易做成裝飾品的那一半：新人報到表單**不收員編**
 *（index.html 沒有這個欄位，對照組見 `grep -c submitCheckin index.html`＝1、
 *  `grep -c 員編 index.html`＝0），員編是人事在這張卡上當場打的。
 * 警語如果只吃「這一列存檔的員編」，在最該出現的那一次永遠不會出現、零錯誤訊息。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'board.html'), 'utf8');

/** 從頁面抽一支頂層函式的原始碼。抽不到就是簽名被改了，測試要跟著改。 */
function grab(name) {
  const re = new RegExp('^function ' + name + ' ?\\([^)]*\\) ?\\{[\\s\\S]*?^\\}', 'm');
  const m = HTML.match(re);
  assert.ok(m, `board.html 找不到 function ${name}(...)——改了簽名就要同步改這支測試`);
  return m[0];
}

function load(conflicts) {
  const ctx = { console, String, gEmpConflicts: conflicts || {} };
  vm.createContext(ctx);
  vm.runInContext(grab('empConflictOf') + '\n' + grab('empWarnText'), ctx, { filename: 'board.html-extract' });
  return ctx;
}

const IDX = {
  '02': { name: '留停乙', status: '留職停薪' },
  '03': { name: '離職丙', status: '離職' },
};

test('C1：人事當場打進留停者的員編 → 立刻查得到撞號（這一列存檔員編是空的）', () => {
  const ctx = load(IDX);
  assert.deepStrictEqual({ ...ctx.empConflictOf('02', '', null) }, IDX['02']);
});

test('C1：撞離職列同樣查得到（原本是靜默覆寫）', () => {
  const ctx = load(IDX);
  assert.deepStrictEqual({ ...ctx.empConflictOf('03', '', null) }, IDX['03']);
});

test('C1：撞在勤者或查無 → null（不製造假警報）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empConflictOf('01', '', null), null);
  assert.strictEqual(ctx.empConflictOf('99', '', null), null);
});

test('C1：空員編 → null（還沒填的卡不該掛警語）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empConflictOf('', '', null), null);
  assert.strictEqual(ctx.empConflictOf('   ', '', null), null);
  assert.strictEqual(ctx.empConflictOf(null, '', null), null);
});

test('C1：索引缺席（部署前存的舊快取）→ 退回後端算好的那一筆，不整張卡失去警語', () => {
  const ctx = load({});   // gEmpConflicts 空物件＝舊快取
  const orig = { name: '留停乙', status: '留職停薪' };
  assert.deepStrictEqual({ ...ctx.empConflictOf('02', '02', orig) }, orig);
});

test('C1：索引缺席且人事把員編改成別的 → 不得沿用上一個人的警語', () => {
  const ctx = load({});
  const orig = { name: '留停乙', status: '留職停薪' };
  assert.strictEqual(ctx.empConflictOf('77', '02', orig), null,
    '輸入值已經不是存檔值了還掛著舊警語＝畫面在說謊，比沒有警語更糟');
});

test('C1：警語指名道姓，並說出「核准將覆寫該列」', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText(IDX['02']),
    '⚠️ 此員編屬留職停薪同仁 留停乙，核准將覆寫該列。');
  assert.strictEqual(ctx.empWarnText(IDX['03']),
    '⚠️ 此員編屬已離職同仁 離職丙，核准將覆寫該列。');
});

test('C1：沒有撞號 → 空字串（渲染端據此收起整塊）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText(null), '');
});

test('C1：名冊未填姓名也要有話講（不得印出 undefined）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText({ name: '', status: '留職停薪' }),
    '⚠️ 此員編屬留職停薪同仁 （名冊未填姓名），核准將覆寫該列。');
});

// ── 接線：光有函式沒接上去＝警語永遠不出現，而且零錯誤訊息 ──────────────────
test('C1 接線：renderRow 在開卡當下就畫一次警語', () => {
  const src = grab('renderRow');
  assert.ok(/paintEmpWarn\(\);/.test(src),
    'renderRow 沒有在渲染當下呼叫 paintEmpWarn＝曾核准過又重送報到的列開卡看不到警語');
});

test('C1 接線：員編輸入框要掛 input 監聽（主要情境是人事當場打員編）', () => {
  const src = grab('renderRow');
  assert.ok(/addEventListener\('input',\s*paintEmpWarn\)/.test(src),
    '員編欄沒有掛 input 監聽＝人事打進留停者員編時警語不會出現，而那正是 C1 的情境');
});

test('C1 接線：renderLoad 要把後端的 empNoConflicts 收進索引', () => {
  const src = grab('renderLoad');
  assert.ok(/gEmpConflicts\s*=\s*r\.empNoConflicts\s*\|\|\s*\{\}/.test(src),
    '索引沒有從回應收進來＝empConflictOf 永遠查空，警語形同不存在');
});
