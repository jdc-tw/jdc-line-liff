const { test } = require('node:test'); const assert = require('node:assert');
const { passCacheKey, passCacheUsable } = require('../assets/pass-cache.js');

const OK = { v: '21', res: { published: true, code: 'CHK|a|1|s', table: '21' } };

test('passCacheKey：以「人＋活動」分開；act 省略時歸 auto，不會跟指定場次互相污染', () => {
  assert.equal(passCacheKey('U1', 'midyear2026'), 'jdcPass:v2:U1:midyear2026');
  assert.equal(passCacheKey('U1', ''), 'jdcPass:v2:U1:auto');
  assert.notEqual(passCacheKey('U1', 'a'), passCacheKey('U2', 'a'));
});

/**
 * 版本段（2026-09-02，第三階段）。
 *
 * 為何存在：報到 QR 裡的身分從員編換成內部碼，而手機上那份快取存的是**換之前**簽出來的碼。
 * 沒有版本段的話，圖文選單那顆常駐鈕（走 `:auto` 鍵、且「沒帶 v 就永不重抓」）會一直
 * 拿舊碼畫 QR，到現場掃不進去——而且畫面完全正常，沒有任何一層會喊。
 *
 * 加了 `v2` 之後，前端一部署，舊鍵整批讀不到 → 自動重抓一次 → 拿到內部碼版的 QR。
 * 零使用者動作、零錯誤訊息。讀寫清三支全走 passCacheKey（index.html:516-526），所以改這裡就夠。
 *
 * ⚠️ 這裡**只驗鍵字串**。「舊鍵讀不到」要走真的 storage loader 才驗得出來（見 Task 6 Step 6）——
 * 把舊鍵存的有效 record 直接餵給 passCacheUsable，它會回 true，那是假綠。
 */
test('passCacheKey：帶版本段 v2，舊鍵不可能再被產生出來', () => {
  assert.ok(passCacheKey('U1', 'a').indexOf(':v2:') !== -1, '鍵裡要有 v2 版本段');
  assert.notEqual(passCacheKey('U1', 'a'), 'jdcPass:U1:a');       // 舊格式
  assert.notEqual(passCacheKey('U1', ''), 'jdcPass:U1:auto');     // 舊格式（auto 鍵）
});

test('沒帶 v（圖文選單常駐鈕）→ 有快取就用，永不重抓', () => {
  assert.equal(passCacheUsable(OK, ''), true);
});

test('帶的 v 與存下來的相同（同一則通知重複點開）→ 用快取', () => {
  assert.equal(passCacheUsable(OK, '21'), true);
});

test('帶的 v 不同（桌次改了、承辦人補發）→ 不能用，要重抓', () => {
  assert.equal(passCacheUsable(OK, '25'), false);
});

test('未發佈的快取一律不算數——否則發佈後那支手機會一直吃到「還沒公布」那份', () => {
  assert.equal(passCacheUsable({ v: '', res: { published: false } }, ''), false);
});

test('沒有快取、或形狀壞掉 → 一律當作沒有，去打 GAS（不要拿 undefined 去畫 QR）', () => {
  assert.equal(passCacheUsable(null, ''), false);
  assert.equal(passCacheUsable({}, ''), false);
  assert.equal(passCacheUsable({ v: '21' }, '21'), false);
});

/* ═══════════ 活動過去了就不能再用（2026-08-22）═══════════
 * 為何：圖文選單那顆是常駐鈕、跨場次同一個網址（:auto 鍵），而「沒帶 v → 永不重抓」
 * 對同一場是對的、跨場次就變成永遠不失效。8/28 之後按圖文選單會一直看到年中聚餐的 QR。
 */
const { passCacheExpired, passToday, passCacheMissReason } = require('../assets/pass-cache.js');

const EV = { v: '21', res: { published: true, table: '21', activity: { name: '2026 年中聚餐', eventDate: '2026/08/28' } } };

test('活動當天仍可用（是 < 不是 <=，當天正是要用它的時候）', () => {
  assert.equal(passCacheUsable(EV, '', '2026/08/28'), true);
});

test('★活動隔天就不能用了（否則按圖文選單的人會一路看到尾牙）', () => {
  assert.equal(passCacheUsable(EV, '', '2026/08/29'), false);
});

test('活動前當然可用', () => {
  assert.equal(passCacheUsable(EV, '', '2026/08/27'), true);
});

test('跨年比較不能靠字串長度矇對：2027/01/05 > 2026/08/28', () => {
  assert.equal(passCacheExpired(EV, '2027/01/05'), true);
  assert.equal(passCacheExpired(EV, '2026/12/31'), true);
});

test('沒有活動日期（後端拿不到 meta）→ 不判到期，維持原行為', () => {
  const noDate = { v: '', res: { published: true, activity: { name: 'x', eventDate: '' } } };
  assert.equal(passCacheUsable(noDate, '', '2027/01/01'), true);
});

test('沒帶 todayStr → 不判到期（舊呼叫端與既有測試不受影響）', () => {
  assert.equal(passCacheUsable(EV, ''), true);
});

test('未命中原因要說得出「活動已過去」，不能跟其他三種混在一起', () => {
  assert.equal(passCacheMissReason(EV, '', '2026/08/29'), '活動已過去');
  assert.equal(passCacheMissReason(EV, '', '2026/08/28'), '（其實可用）');
});

test('passToday：補零、用手機當地時區，且不依賴 padStart（舊 iOS）', () => {
  assert.equal(passToday(new Date(2026, 7, 8)), '2026/08/08');
  assert.equal(passToday(new Date(2026, 11, 25)), '2026/12/25');
});

test('對照組：拿掉到期判斷，★那條必須翻紅', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'pass-cache.js'), 'utf8');
  const m = src.match(/^function passCacheUsable\([\s\S]*?^}/m);
  const mutated = m[0].replace(/\n\s*if \(passCacheExpired\(rec, todayStr\)\) return false;/, '');
  assert.notEqual(mutated, m[0], '突變沒注入成功——先確認真的改到字了');
  const vm = require('node:vm');
  const ctx = { passCacheExpired };
  vm.createContext(ctx);
  vm.runInContext(mutated, ctx);
  assert.equal(ctx.passCacheUsable(EV, '', '2026/08/29'), true,
    '拿掉之後隔天照樣回 true ⇒ ★那條斷言確實抓得到這個回歸');
});
