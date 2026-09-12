/**
 * 「登入成功卻到不了目的地」在 `index.html` 上要**看得見**（2026-09-12）。
 *
 * 🔴 **為何非有這一支不可**：2026-09-12 使用者在手機 LINE 開 `board.html`（不帶 `?t=`），
 *    LINE 把他送去登入，登入完他落在**站台首頁**，畫面畫的是「目前沒有開放中的活動」。
 *    那張卡是真的、是對的、而且**與他要做的事完全無關**——畫面上沒有任何一個字說
 *    「你沒到目的地」。**零錯誤訊息的靜默失敗**，他只能自己來問。
 *
 * ⚠️ **誤傷面才是這一支真正要守的東西**：`?act=` 與 `?mode=onboard` 是今天全公司在用的
 *    入口，它們**也**走 `liff.state`。判準若寫成「有 liff.state 就擋」，那就是把全公司的
 *    入口一起擋掉，而且測試可以全綠（因為沒有人在測那幾條）。所以每一條既有入口
 *    都在下面有一格自己的斷言。
 *
 * 手法同 `board-e1a-wiring.test.js`：把 `index.html` 裡的 script 依序丟進 stub 環境跑，
 * 測的是那個檔裡真正那幾行字。DOM 與網路是假的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function fakeEl(id) {
  const el = {
    __id: id, style: {}, dataset: {}, options: [], children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {},
    removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    focus() {}, click() {}, remove() {}, scrollIntoView() {},
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, href: '',
  };
  return el;
}

/**
 * 跑 index.html，回 ctx ＋ 元素表。
 * 元素表**共用同一顆**（同 id 取到同一個物件），否則 `show()` 改的和斷言讀的不是同一格，
 * 斷言會永遠通過——那就是一盞永遠的綠燈。
 */
function runIndex({ search }) {
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, fakeEl(id));
    return els.get(id);
  };
  const timers = new Set();
  const store = {};
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    clear() {}, key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  const pending = () => new Promise(() => {});
  const doc = {
    getElementById: getEl, querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => fakeEl(), createTextNode: () => fakeEl(),
    body: fakeEl('body'), documentElement: fakeEl('html'), head: fakeEl('head'),
    addEventListener() {}, removeEventListener() {}, readyState: 'complete',
  };
  const liff = {
    init: () => pending(),           // 停在 init：我們要測的是 applyState，不是 LIFF 流程
    isLoggedIn: () => true, getIDToken: () => 'IDTOK',
    getDecodedIDToken: () => ({ sub: 'U_SUB_1' }),
    login(o) { liff.__loginArgs = o; }, getProfile: pending,
    closeWindow() {}, openWindow() {}, getOS: () => 'ios', isInClient: () => true,
    getVersion: () => '2.0.0', __loginArgs: null,
  };
  const ctx = {
    console, document: doc,
    navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
    liff,
    location: {
      href: 'https://campaign.jdc-corpn.com.tw/' + search, search,
      pathname: '/', origin: 'https://campaign.jdc-corpn.com.tw', hash: '',
      replace() {}, assign() {}, reload() {},
    },
    localStorage: storage, sessionStorage: storage,
    fetch: () => pending(),
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

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
        vm.runInContext(m[2], ctx, { filename: 'index inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  const cleanup = () => { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); };
  const shown = (id) => els.has(id) && els.get(id).style.display === '';
  return { ctx, els, getEl, shown, cleanup };
}

/* ══ 量法本身有沒有鑑別力 ════════════════════════════════════════════════ */

test('⬛ 儀器檢查：harness 真的把 index.html 的函式跑出來了', () => {
  const { ctx, cleanup } = runIndex({ search: '' });
  try {
    assert.equal(typeof ctx.destFromLiffState, 'function',
      'destFromLiffState 不存在 ⇒ 下面每一條斷言測的都是空氣');
    assert.equal(typeof ctx.applyState, 'function', 'applyState 沒被定義出來');
  } finally { cleanup(); }
});

/* ══ ① 路徑式深連結：要看得見 ═══════════════════════════════════════════ */

test('🔴 liff.state 指向 /board.html → 認得出目的地', () => {
  const { ctx, cleanup } = runIndex({ search: '?liff.state=%2Fboard.html' });
  try {
    assert.equal(ctx.destFromLiffState(), '/board.html');
  } finally { cleanup(); }
});

test('🔴 liff.state 指向 /board.html → 畫面**顯示**到不了的訊息，而不是活動卡', () => {
  const { ctx, shown, getEl, cleanup } = runIndex({ search: '?liff.state=%2Fboard.html' });
  try {
    ctx.applyState({ bound: true, verified: true });
    assert.equal(shown('section-dest-blocked'), true,
      '他登入成功卻到不了目的地，而畫面什麼都沒說 ⇒ 這就是 9/12 那次的樣子');
    assert.equal(getEl('dest-blocked-path').textContent, '/board.html',
      '訊息沒講出他要去的是哪一頁 ⇒ 他截圖給資訊人員也看不出是哪條連結');
    assert.equal(shown('section-no-activity'), false,
      '同時還畫了「目前沒有開放中的活動」⇒ 兩張卡互相矛盾，比只有一張錯的更糟');
    assert.equal(shown('section-activity'), false);
  } finally { cleanup(); }
});

test('liff.state 帶路徑又帶 query（/board.html?x=1）→ 只取路徑', () => {
  const { ctx, cleanup } = runIndex({ search: '?liff.state=%2Fboard.html%3Fx%3D1' });
  try {
    assert.equal(ctx.destFromLiffState(), '/board.html');
  } finally { cleanup(); }
});

/* ══ ② 誤傷面：今天全公司在用的入口，一條都不可以被攔到 ══════════════════ */
/* 這幾條 liff.state 的值是 2026-09-12 直接向 liff.line.me 要來的，不是我編的：   */
/*   curl https://liff.line.me/2010451233-a781rqsm?act=midyear2026 → "?act=…"    */

test('⬛ 對照組：?act= 入口（liff.state="?act=midyear2026"）不可被攔', () => {
  const { ctx, shown, cleanup } = runIndex({ search: '?liff.state=%3Fact%3Dmidyear2026' });
  try {
    assert.equal(ctx.destFromLiffState(), '', '把活動入口判成「要去別頁」⇒ 全公司填不了活動調查');
    ctx.applyState({ bound: true, verified: true });
    assert.equal(shown('section-dest-blocked'), false);
  } finally { cleanup(); }
});

test('⬛ 對照組：?mode=onboard 入口（新人報到）不可被攔', () => {
  const { ctx, shown, cleanup } = runIndex({ search: '?liff.state=%3Fmode%3Donboard' });
  try {
    assert.equal(ctx.destFromLiffState(), '');
    ctx.applyState({ bound: true, verified: true });
    assert.equal(shown('section-dest-blocked'), false, '新人報到被擋掉了');
    assert.equal(shown('section-onboard'), true, '報到表單沒出現 ⇒ 新人進不去');
  } finally { cleanup(); }
});

test('⬛ 對照組：完全沒有 liff.state（LINE 裡最常見的一種）不可被攔', () => {
  const { ctx, shown, cleanup } = runIndex({ search: '' });
  try {
    assert.equal(ctx.destFromLiffState(), '');
    ctx.applyState({ bound: true, verified: true });
    assert.equal(shown('section-dest-blocked'), false);
  } finally { cleanup(); }
});

test('⬛ 對照組：liff.state="/"（根目錄本身）不算「要去別頁」', () => {
  const { ctx, cleanup } = runIndex({ search: '?liff.state=%2F' });
  try {
    assert.equal(ctx.destFromLiffState(), '');
  } finally { cleanup(); }
});

test('🔴 liff.state="//evil.example.com/x"（換網域）不可被當成本站的頁', () => {
  const { ctx, cleanup } = runIndex({ search: '?liff.state=%2F%2Fevil.example.com%2Fx' });
  try {
    assert.equal(ctx.destFromLiffState(), '',
      '把 `//別的網域` 印進畫面 ⇒ 這一格就變成別人可以控制的文案');
  } finally { cleanup(); }
});
