/**
 * E1a：`board.html` 的兩條進場路（2026-09-12）。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開 board.html 時網址帶著
 *    `?t=STUBTOKEN` ⇒ 它跑的**永遠是舊路**。新路一行都沒被執行過，而它全綠。
 *    「改了行為卻測試全綠」在這裡的長相就是這個——不是測試寫錯，是**沒有人在跑新路**。
 *
 * 🔴 **只驗新路也不夠**：這一格是切換，**切換本身**才是會出事的東西。
 *    所以兩種模式都驗，而且驗的是同一批斷言的相反面。
 *
 * ⚠️ 手法同 page-load.test.js：把頁面的 script 依序丟進 stub 環境跑，
 *    測的是 board.html 裡真正那幾行字。DOM 與網路是假的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function fakeEl() {
  const el = {
    style: {}, dataset: {}, options: [], children: [], classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, querySelector: () => fakeEl(),
    querySelectorAll: () => [], focus() {}, click() {}, remove() {}, scrollIntoView() {},
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, href: '',
  };
  return el;
}

/** 跑 board.html，回 ctx ＋ 送出去的網址清單。 */
function runBoard({ search, loggedIn = true, idToken = 'IDTOK', sub = 'U_SUB_1', noLiff = false }) {
  const urls = [];
  const timers = new Set();
  const store = {};
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    clear() {}, key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  const pending = () => new Promise(() => {});
  const doc = {
    getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => fakeEl(), createTextNode: () => fakeEl(),
    body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
    addEventListener() {}, removeEventListener() {}, readyState: 'complete',
  };
  const liff = {
    init: () => Promise.resolve(),
    isLoggedIn: () => loggedIn,
    getIDToken: () => idToken,
    getDecodedIDToken: () => ({ sub }),
    login(o) { liff.__loginArgs = o; },
    getProfile: pending, closeWindow() {}, openWindow() {},
    getOS: () => 'ios', isInClient: () => true, getVersion: () => '2.0.0',
    __loginArgs: null, __initCalled: 0,
  };
  const origInit = liff.init;
  liff.init = (...a) => { liff.__initCalled++; return origInit(...a); };

  const ctx = {
    console, document: doc,
    navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
    liff: noLiff ? undefined : liff,
    location: {
      href: 'http://localhost/board.html' + search, search,
      pathname: '/board.html', origin: 'http://localhost', hash: '',
      replace() {}, assign() {}, reload() {},
    },
    localStorage: storage, sessionStorage: storage,
    fetch: (u) => { urls.push(String(u)); return pending(); },
    XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {} }; },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); return clearTimeout(id); },
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); return clearInterval(id); },
    requestAnimationFrame(fn) { return ctx.setTimeout(fn, 0); },
    alert() {}, confirm: () => false, prompt: () => null,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ display: 'block', getPropertyValue: () => '' }),
    Event: function (t) { return { type: t }; }, CustomEvent: function (t) { return { type: t }; },
    Blob: function () { return {}; },
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; },
              subtle: { digest: pending, importKey: pending, encrypt: pending, decrypt: pending } },
    isSecureContext: true, performance: { now: () => 0, getEntriesByType: () => [] },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  const onRej = () => {};
  process.on('unhandledRejection', onRej);
  try {
    while ((m = re.exec(html)) !== null) {
      const src = ((m[1] || '').match(/\bsrc="([^"]+)"/) || [])[1];
      if (src) {
        if (/^https?:|^\/\//.test(src)) continue;
        const p = path.join(ROOT, src);
        if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: src, timeout: 5000 });
      } else if (m[2].trim()) {
        vm.runInContext(m[2], ctx, { filename: 'board inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  const cleanup = () => { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); };
  return { ctx, urls, liff, cleanup };
}

/** 讓所有已排定的微任務跑完（AUTH_READY 是好幾層 then）。 */
const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(r))));

/* ══ ① 舊路：網址帶 ?t= ════════════════════════════════════════════════ */

test('①舊路：帶 ?t= → 不碰 LIFF，TOKEN／FP 都是網址上那串', async () => {
  const { ctx, liff, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, 'STUBTOKEN');
    assert.equal(ctx.FP, 'STUBTOKEN', '舊路的快取指紋必須與改動前逐字相同');
    assert.equal(liff.__initCalled, 0, '舊路不該去初始化 LIFF（那會多一次外部相依）');
    assert.equal(ctx.ID_TOKEN, '', '舊路不該有 idToken');
  } finally { cleanup(); }
});

test('①舊路：呼叫帶 token、**不帶** idToken（否則後端會改道）', async () => {
  const { ctx, urls, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    ctx.jsonp('getHrPending', { token: ctx.TOKEN });
    const u = urls[urls.length - 1];
    assert.match(u, /[?&]token=STUBTOKEN/, '舊路沒把 token 送出去');
    assert.equal(/idToken=/.test(u), false,
      '舊路帶了 idToken ⇒ 後端的分流條件會被打到，福委會那型的改道風險就在這裡');
  } finally { cleanup(); }
});

/* ══ ② 新路：網址沒有 ?t= ══════════════════════════════════════════════ */

test('②新路：沒有 ?t= → 走 LIFF，FP 變成 LINE 的 sub', async () => {
  const { ctx, liff, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '沒有 ?t= 卻沒去初始化 LIFF ⇒ 新路根本沒跑');
    assert.equal(ctx.ID_TOKEN, 'IDTOK');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
  } finally { cleanup(); }
});

test('🔴 ②新路的指紋不可以是空字串（同一台裝置上 A 的快取會被 B 解開）', async () => {
  const { ctx, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.notEqual(ctx.FP, '', '指紋是空字串 ⇒ 共用裝置上不同人的快取會混在一起');
  } finally { cleanup(); }
});

test('②新路：每一支呼叫都自動帶 idToken（憑證只掛在 jsonp 一處）', async () => {
  const { ctx, urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    ctx.jsonp('getHrPending', { token: ctx.TOKEN });
    ctx.jsonp('listOptions', { token: ctx.TOKEN });
    assert.equal(urls.length >= 2, true, '呼叫沒送出去');
    urls.slice(-2).forEach((u) => {
      assert.match(u, /[?&]idToken=IDTOK/, '有一支沒帶 idToken ⇒ 那一支會永遠驗不過');
      assert.match(u, /[?&]token=&|[?&]token=$/, 'token 應該是空的，否則後端走舊路');
    });
  } finally { cleanup(); }
});

test('🔴 ②新路：idToken 是「呼叫當下才取」，不是開頁時取一次存起來', async () => {
  const { ctx, urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    // 模擬一小時後 LINE 換了新憑證（人事開著這一頁核准一整個上午是常態）
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    ctx.jsonp('getHrPending', { token: ctx.TOKEN });
    assert.match(urls[urls.length - 1], /idToken=IDTOK_REFRESHED/,
      '送出去的還是舊憑證 ⇒ 他會在按下核准時被說「請重新登入」，而他根本沒登出過');
  } finally { cleanup(); }
});

/* ══ 失敗路徑：每一種都要擋住首載，而且不可以帶空憑證送出去 ══════════════ */

test('🔴 還沒登入 → 去登入，且**首載不發車**（不可以帶空憑證打後端）', async () => {
  const { urls, liff, cleanup } = runBoard({ search: '', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/board.html',
      'redirectUri 不是本頁 ⇒ 登入後回不來');
    assert.equal(urls.length, 0, '導頁中還送出了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 登入了但拿不到憑證 → 擋住，首載不發車', async () => {
  const { urls, cleanup } = runBoard({ search: '', idToken: '' });
  await settle();
  try {
    assert.equal(urls.length, 0, '拿不到憑證卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 LIFF 元件整個沒載入 → 擋住，首載不發車（fail-closed）', async () => {
  const { urls, cleanup } = runBoard({ search: '', noLiff: true });
  await settle();
  try {
    assert.equal(urls.length, 0, 'LIFF 缺席卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('⬛ 對照組：一切正常時首載**確實會**發車（否則上面三條是「反正都不發」）', async () => {
  const { urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.equal(urls.length >= 1, true,
      '正常情況也沒發車 ⇒ 上面三條零鑑別力，它們證明的是「這支測試不會發車」');
    assert.match(urls[0], /action=batch/, '首載那一發不是 batch');
    assert.match(urls[0], /idToken=IDTOK/, '首載沒帶憑證');
  } finally { cleanup(); }
});

test('⬛ 對照組：舊路也一樣會發車，而且帶的是 token', async () => {
  const { urls, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    assert.equal(urls.length >= 1, true, '舊路沒發車 ⇒ 我把現行行為弄壞了');
    assert.match(urls[0], /token=STUBTOKEN/);
    assert.equal(/idToken=/.test(urls[0]), false);
  } finally { cleanup(); }
});

/* ══ 跨看板連結 ══════════════════════════════════════════════════════ */

test('②新路不顯示跨看板連結（stats.html 還沒改，點了必定失敗）', async () => {
  const { ctx, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    let appended = 0;
    ctx.document.body.appendChild = () => { appended++; };
    ctx.showAdminSwitch(true);
    assert.equal(appended, 0, '顯示了一個點下去必定失敗的連結');
  } finally { cleanup(); }
});

test('⬛ 對照組：①舊路仍然顯示它（否則上一條只是「這支永遠不顯示」）', async () => {
  const { ctx, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    let appended = 0;
    ctx.document.body.appendChild = () => { appended++; };
    ctx.document.getElementById = () => null;   // 讓「已存在就不加」那一格不擋
    ctx.showAdminSwitch(true);
    assert.equal(appended, 1, '舊路的跨看板連結不見了 ⇒ 我把管理者的現行功能弄壞了');
  } finally { cleanup(); }
});

/* ══ LIFF ID 必須與另外兩頁同一條 ══════════════════════════════════════ */

test('LIFF ID 與 index／welfare 同一條（tools.md：不多開 LIFF ID）', () => {
  const pick = (f, re) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(re) || [])[1];
  const b = pick('board.html', /^var LIFF_ID='([^']+)';/m);
  const w = pick('welfare.html', /^var LIFF_ID = '([^']+)';/m);
  const i = pick('index.html', /^\s*var LIFF_ID = '([^']+)';/m);
  assert.ok(b, 'board.html 找不到 LIFF_ID');
  assert.equal(b, w, 'board 與 welfare 的 LIFF ID 不同');
  assert.equal(b, i, 'board 與 index 的 LIFF ID 不同');
});
