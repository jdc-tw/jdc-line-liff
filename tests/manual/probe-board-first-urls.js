/**
 * 探針（不是測試）：把 board.html 在 stub 環境跑起來，印出**自動送出**的每一支網址，
 * 看它帶不帶 idToken。
 *
 * 為何要有：既有的 board-e1a-wiring.test.js 驗的是「我手動呼叫 ctx.jsonp 之後」的網址，
 * 那證明不了**首載那批自己發出去的**有沒有帶。使用者 9/12 看到的是首載的結果。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const MODE = process.argv[2] || 'line';   // line | token | late

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

// MODE=late：模擬「liff.init 已 resolve，但 getIDToken 稍晚才有值」。
let idTokenReady = (MODE !== 'late' && MODE !== 'noid');
const liff = {
  init: () => Promise.resolve(),
  isLoggedIn: () => true,
  getIDToken: () => (idTokenReady ? 'IDTOK' : ''),
  getDecodedIDToken: () => ({ sub: 'U_SUB_1' }),
  login(o) { liff.__loginArgs = o; },
  getProfile: pending, closeWindow() {}, openWindow() {},
  getOS: () => 'ios', isInClient: () => true, getVersion: () => '2.0.0',
};

const search = MODE === 'token' ? '?t=STUBTOKEN' : '';
const ctx = {
  console, document: doc,
  navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
  liff,
  location: {
    href: 'https://campaign.jdc-corpn.com.tw/board.html' + search, search,
    pathname: '/board.html', origin: 'https://campaign.jdc-corpn.com.tw', hash: '',
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
process.on('unhandledRejection', () => {});
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

setTimeout(() => {
  if (MODE === 'late') idTokenReady = true;  // 'noid' 永遠不給   // 憑證「後來」才到
}, 5);

setTimeout(() => {
  console.log('MODE=' + MODE + '  TOKEN=' + JSON.stringify(ctx.TOKEN) + '  ID_TOKEN=' + JSON.stringify(ctx.ID_TOKEN) + '  FP=' + JSON.stringify(ctx.FP));
  console.log('自動送出的請求數：' + urls.length);
  urls.forEach((u, i) => {
    const action = (u.match(/[?&]action=([^&]*)/) || [])[1];
    console.log('  #' + (i + 1) + ' action=' + action
      + '  token=' + JSON.stringify((u.match(/[?&]token=([^&]*)/) || [])[1])
      + '  idToken=' + ((/[?&]idToken=/.test(u)) ? JSON.stringify((u.match(/[?&]idToken=([^&]*)/) || [])[1]) : '**沒有這個參數**'));
  });
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  process.exit(0);
}, 400);
