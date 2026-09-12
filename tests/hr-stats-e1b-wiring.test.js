/**
 * E1b 第 1 頁：`hr-stats.html` 的兩條進場路（2026-09-12）。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開 hr-stats.html 時網址帶著
 *    `?t=STUBTOKEN` ⇒ 它跑的**永遠是舊路**。新路一行都沒被執行過，而它全綠。
 *    「改了行為卻測試全綠」在這裡的長相就是這個——不是測試寫錯，是**沒有人在跑新路**。
 *
 * 🔴 **只驗新路也不夠**：這一格是切換，**切換本身**才是會出事的東西。
 *    所以兩種模式都驗，而且驗的是同一批斷言的相反面。
 *
 * ⚠️ 手法與 `board-e1a-wiring.test.js` 逐字同型（同一個 stub 環境、同一種 settle），
 *    刻意不自創第二套——兩套環境的嚴格度會分歧，而分歧是靜默的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 🔴 stub 環境走共用的一支（`tests/helpers/page-stub.js`）——「退路一次性實測」
//    也是用同一支跑改動前那一份，兩邊的嚴格度才可能相同。理由見該檔檔頭。
const { runPage, settle, execOnly, ROOT } = require('./helpers/page-stub.js');

/* ══ ① 舊路：網址帶 ?t=（退路，行為必須逐字相同） ════════════════════ */

test('①舊路：帶 ?t= → 不碰 LIFF，TOKEN／FP 都是網址上那串', async () => {
  const { ctx, liff, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, 'STUBTOKEN');
    assert.equal(ctx.FP, 'STUBTOKEN', '舊路的快取指紋必須與改動前逐字相同');
    assert.equal(liff.__initCalled, 0, '舊路不該去初始化 LIFF（那會多一次外部相依）');
    assert.equal(ctx.ID_TOKEN, '', '舊路不該有 idToken');
  } finally { cleanup(); }
});

test('🔴 ①舊路：呼叫帶 token、**不帶** idToken（帶了後端就會改道）', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    ctx.jsonp('getHrStats', { token: ctx.TOKEN });
    const u = urls[urls.length - 1];
    assert.match(u, /[?&]token=STUBTOKEN/, '舊路沒把 token 送出去');
    assert.equal(/idToken=/.test(u), false,
      '舊路帶了 idToken ⇒ 後端 doGet 的分流條件會被打到，福委會那型的改道風險就在這裡');
  } finally { cleanup(); }
});

/* ══ ② 新路：網址沒有 ?t= ══════════════════════════════════════════════ */

test('②新路：沒有 ?t= → 走 LIFF，FP 變成 LINE 的 sub', async () => {
  const { ctx, liff, cleanup } = runPage({ search: '' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '沒有 ?t= 卻沒去初始化 LIFF ⇒ 新路根本沒跑');
    assert.equal(ctx.ID_TOKEN, 'IDTOK');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
  } finally { cleanup(); }
});

test('🔴 ②新路的指紋不可以是空字串（同一台裝置上 A 的快取會被 B 解開）', async () => {
  // 本頁快取裡含退休預警的**姓名**，指紋撞號不是效能問題，是個資問題。
  const { ctx, cleanup } = runPage({ search: '' });
  await settle();
  try {
    assert.notEqual(ctx.FP, '', '指紋是空字串 ⇒ 共用裝置上不同人的快取會混在一起');
  } finally { cleanup(); }
});

test('②新路：呼叫自動帶 idToken（憑證只掛在 jsonp 一處）', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '' });
  await settle();
  try {
    ctx.jsonp('getHrStats', { token: ctx.TOKEN });
    const u = urls[urls.length - 1];
    assert.match(u, /[?&]idToken=IDTOK/, '沒帶 idToken ⇒ 這一支會永遠驗不過');
    assert.match(u, /[?&]token=&|[?&]token=$/, 'token 應該是空的，否則後端走舊路');
  } finally { cleanup(); }
});

test('🔴 ②新路：idToken 是「呼叫當下才取」，不是開頁時取一次存起來', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '' });
  await settle();
  try {
    // 模擬一小時後 LINE 換了新憑證（看板開著不動一整個上午是常態）
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    ctx.jsonp('getHrStats', { token: ctx.TOKEN });
    assert.match(urls[urls.length - 1], /idToken=IDTOK_REFRESHED/,
      '送出去的還是舊憑證 ⇒ 他會被說「請重新登入」，而他根本沒登出過');
  } finally { cleanup(); }
});

/* ══ 失敗路徑：每一種都要擋住首載，而且不可以帶空憑證送出去 ══════════════ */

test('🔴 還沒登入 → 去登入，且**首載不發車**（不可以帶空憑證打後端）', async () => {
  const { urls, liff, cleanup } = runPage({ search: '', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/hr-stats.html',
      'redirectUri 不是本頁 ⇒ 登入後回不來');
    assert.equal(urls.length, 0, '導頁中還送出了 ' + urls.length + ' 個請求：' + urls.join(' | '));
  } finally { cleanup(); }
});

test('🔴 登入了但拿不到憑證 → 擋住，首載不發車', async () => {
  const { urls, cleanup } = runPage({ search: '', idToken: '' });
  await settle();
  try {
    assert.equal(urls.length, 0, '拿不到憑證卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 LIFF 元件整個沒載入 → 擋住，首載不發車（fail-closed）', async () => {
  const { urls, cleanup } = runPage({ search: '', noLiff: true });
  await settle();
  try {
    assert.equal(urls.length, 0, 'LIFF 缺席卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('⬛ 對照組：一切正常時首載**確實會**發車（否則上面三條是「反正都不發」）', async () => {
  const { urls, cleanup } = runPage({ search: '' });
  await settle();
  try {
    assert.ok(urls.length >= 1,
      '正常情況也沒發車 ⇒ 上面三條零鑑別力，它們證明的是「這支測試不會發車」');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '沒有任何一發打到 /exec');
    assert.match(e[0], /action=getHrStats/, '首載那一發不是 getHrStats');
    assert.match(e[0], /idToken=IDTOK/, '首載沒帶憑證');
  } finally { cleanup(); }
});

test('⬛ 對照組：①舊路也一樣會發車，而且帶的是 token', async () => {
  const { urls, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '舊路沒發車 ⇒ 我把現行行為弄壞了');
    assert.match(e[0], /token=STUBTOKEN/);
    assert.equal(/idToken=/.test(e[0]), false);
  } finally { cleanup(); }
});

/* ══ 🔴 退路：舊連結的行為必須與改動前**逐字相同** ═══════════════════
 *
 * ⚠️ **「與改動前逐字相同」這件事刻意沒有做成常駐測試。**
 *    要做成常駐的，就得在 repo 裡放一份改動前的 `hr-stats.html` 副本當夾具，
 *    而**副本一產生就開始腐爛**：日後這一頁為了別的原因改一行，這條就會變紅，
 *    而當下最省事的處置是「更新夾具」——那一刻它就不再是「改動前」，
 *    卻長得跟原來一模一樣。（同 `feedback_comment_enshrines_a_bug` 的期望值表。）
 *
 * ⇒ 改成**一次性實測**，證據留在交件回報裡：
 *    `scratchpad/rollback-diff.js`（把 `c9085f8` 的那一份與現行檔在同一個 stub
 *    環境各跑一次，逐字比對送出去的網址）。
 *    常駐的是上面那兩條**不會腐爛**的斷言：①舊路帶 token、不帶 idToken。
 */

/* ══ 取值方式：不可以長出第二種寫法 ════════════════════════════════ */

test('🔴 本頁的取參數只走共用的 urlParam，不可以自己再寫一份正則', () => {
  // ⚠️ 這裡刻意**不寫**「`func`＋`tion q(k){…}`」那種字面樣式：`source-scan-tripwire`
  //    會掃測試檔裡的字串與正則字面量，含那個字就被判成「自己手寫抽取式」。
  //    改成只認「有沒有委派出去」與「舊的正則還在不在」，兩者都不需要那個字。
  const html = fs.readFileSync(path.join(ROOT, 'hr-stats.html'), 'utf8');
  const 內文 = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(內文.indexOf('return urlParam(k);') >= 0, 'q() 沒有委派給共用函式');
  assert.ok(!/new RegExp\('\[\?&\]'\+k/.test(內文),
    '舊的自寫正則還在 ⇒ 換來源時這一頁會靜靜地繼續走舊路');
  assert.match(html, /<script src="assets\/url-token\.js"><\/script>/,
    '沒有載入共用的取值函式 ⇒ q() 會在執行時 ReferenceError');
});

test('🔴 行為面：頁面的 q() 與共用的 urlParam 對同一組輸入必須逐字相同', async () => {
  // 掃原始碼只能證明「寫了委派」；這一條證明**跑起來真的是同一支**。
  // 🔴 `bad` 那一格是這組輸入裡**唯一分得出兩種實作**的：舊的自寫版
  //    `decodeURIComponent('%')` 會拋 URIError（而且是在頂層、會把後面整段打斷），
  //    共用版包了 try/catch 回原字串。少了它，這一條對「改回自寫正則」零鑑別力
  //    ——2026-09-12 實測：沒有這一格時那一發突變只打紅掃原始碼那條。
  const { ctx, cleanup } = runPage({ search: '?t=STUBTOKEN&x=1&zz=%E4%B8%AD&bad=%&empty=' });
  await settle();
  try {
    ['t', 'x', 'zz', 'bad', 'empty', '沒有這個參數'].forEach((k) => {
      assert.strictEqual(ctx.q(k), ctx.urlParam(k), 'q("' + k + '") 與 urlParam 不一致');
    });
    // ⬛ 零點：這組輸入真的量得到東西（不是每一格都是空字串在對空字串）
    assert.strictEqual(ctx.q('t'), 'STUBTOKEN');
    assert.strictEqual(ctx.q('zz'), '中', 'decodeURIComponent 沒作用 ⇒ 這組輸入沒有鑑別力');
    assert.strictEqual(ctx.q('bad'), '%', '壞的百分比編碼要回原字串，不可以拋');
    assert.strictEqual(ctx.q('沒有這個參數'), '', '取不到時要回空字串，不是 null／undefined');
  } finally { cleanup(); }
});

test('🔴 TOKEN 只有一個宣告點（兩個的話 jsonp 讀到的與首載用的不是同一個）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'hr-stats.html'), 'utf8');
  const n = (html.match(/var TOKEN\b/g) || []).length;
  assert.strictEqual(n, 1, '有 ' + n + ' 個 TOKEN 宣告點');
});

test('LIFF ID 與 index／welfare／board 同一條（tools.md：不多開 LIFF ID）', () => {
  const pick = (f, re) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(re) || [])[1];
  const h = pick('hr-stats.html', /^var LIFF_ID='([^']+)';/m);
  const b = pick('board.html', /^var LIFF_ID='([^']+)';/m);
  const w = pick('welfare.html', /^var LIFF_ID = '([^']+)';/m);
  const i = pick('index.html', /^\s*var LIFF_ID = '([^']+)';/m);
  assert.ok(h, 'hr-stats.html 找不到 LIFF_ID');
  assert.equal(h, b, 'hr-stats 與 board 的 LIFF ID 不同');
  assert.equal(h, w, 'hr-stats 與 welfare 的 LIFF ID 不同');
  assert.equal(h, i, 'hr-stats 與 index 的 LIFF ID 不同');
});
