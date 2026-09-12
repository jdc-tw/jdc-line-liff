/**
 * 把一個 `.html` 頁面的 script 依序丟進 stub 環境跑，回傳 ctx 與它送出去的網址。
 *
 * 🔴 **為何抽出來（2026-09-12，E1b 第 1 頁）**：同一套環境同時要被兩種東西用——
 *    常駐測試（`hr-stats-e1b-wiring.test.js`）與「退路一次性實測」
 *    （把改動前那一份跑起來、逐字比對送出去的網址）。
 *    **各寫一份的話，兩份的嚴格度會分歧，而分歧是靜默的**：
 *    退路那一份少給一個替身，量到的差異就會是替身造成的，讀起來卻像程式改壞了。
 *
 * ⚠️ `board-e1a-wiring.test.js` 有一份**自己的**同型環境，這一輪刻意不動它——
 *    改它等於在「hr-stats 上線」這次改動裡順手動到 board 的驗收，
 *    而那一頁已經在線上跑了。要收攏是另外一次改動。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function fakeEl() {
  const el = {
    style: {}, dataset: {}, options: [], children: [], classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, querySelector: () => fakeEl(),
    querySelectorAll: () => [], focus() {}, click() {}, remove() {}, scrollIntoView() {},
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, href: '',
    parentNode: { removeChild() {} },
  };
  return el;
}

/** 跑 hr-stats.html，回 ctx ＋ 送出去的網址清單。 */
function runPage({ search, loggedIn = true, idToken = 'IDTOK', sub = 'U_SUB_1', noLiff = false,
                   file = 'hr-stats.html', html = null }) {
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
      href: 'http://localhost/' + file + search, search,
      pathname: '/' + file, origin: 'http://localhost', hash: '',
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
    Uint8Array, Uint32Array, ArrayBuffer,
    // 🔴 **`subtle` 給真的，不給永遠 pending 的替身。**（與 board-e1a-wiring 的差別，理由如下）
    //    本頁的整個首載都排在 `cacheBootstrap()` 後面，而它第一件事就是
    //    `subtle.digest` 算指紋。替身若永遠不 resolve，**這一頁一個請求都不會送出去**
    //    ⇒ 「還沒登入不可以發車」那三條會全綠，而它們證明的是
    //    「這支測試不會發車」，不是「程式擋住了」。⬛ 下面的對照組就是為了逼出這件事。
    //    （board.html 的首載不在 cacheBootstrap 後面，所以它那支用替身沒事。）
    crypto: require('node:crypto').webcrypto,
    isSecureContext: true, performance: { now: () => 0, getEntriesByType: () => [] },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const src = html == null ? fs.readFileSync(path.join(ROOT, file), 'utf8') : html;
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  const onRej = () => {};
  process.on('unhandledRejection', onRej);
  try {
    while ((m = re.exec(src)) !== null) {
      const s = ((m[1] || '').match(/\bsrc="([^"]+)"/) || [])[1];
      if (s) {
        if (/^https?:|^\/\//.test(s)) continue;
        const p = path.join(ROOT, s);
        if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: s, timeout: 5000 });
      } else if (m[2].trim()) {
        vm.runInContext(m[2], ctx, { filename: file + ' inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  const cleanup = () => { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); };
  return { ctx, urls, liff, cleanup };
}

/** 讓所有已排定的微任務跑完（AUTH_READY 是好幾層 then）。 */
const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(r))));

/** 只留打 /exec 的那幾發（hr-stats-pub.json 是公開靜態檔，不是 action 呼叫）。 */
const execOnly = (urls) => urls.filter((u) => u.indexOf('script.google.com') >= 0);

module.exports = { runPage, settle, execOnly, fakeEl, ROOT };
