/**
 * 探針（不是測試）：回答三個問題，全部用真的 board.html ＋ 真 WebCrypto ＋ 真 store。
 *
 *   ① 被存進快取的 `{ok:false, msg:'無權限或連結已失效。'}` 重開頁時會不會被**畫出來**？
 *   ② 那筆快取有沒有可能在「第一次到 board.html」之前就存在？
 *   ③ LIFF 已登入但 `getIDToken()` 回空時，快取指紋 `FP` 是什麼值？
 *
 * ⚠️ **先前那支探針對快取是零鑑別力**：它把 `crypto.subtle.digest` стub 成永不 resolve 的
 *    Promise ⇒ `cacheBootstrap` 永遠不會完成，快取那一整層一行都沒跑到。
 *    這一支改用 node 的真 WebCrypto。
 *
 * 用法：node tests/manual/probe-board-cache.js <mode>
 *   fp-line | fp-noid | fp-nosub | fp-token | paint-bad | paint-good
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const MODE = process.argv[2] || 'fp-line';

/* ── 會記錄「被寫進畫面的文字」的假 DOM ────────────────────────────────── */
const painted = [];
function fakeEl(id) {
  const el = {
    __id: id, style: {}, dataset: {}, options: [], children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore(c) { this.children.unshift(c); return c; },
    insertAdjacentHTML(_, h) { painted.push(['insertAdjacentHTML', id, String(h)]); },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => fakeEl('?'), querySelectorAll: () => [],
    focus() {}, click() {}, remove() {}, scrollIntoView() {},
    value: '', checked: false, hidden: false, href: '',
    get firstChild() { return this.children[0] || null; },
  };
  let _t = '', _h = '';
  Object.defineProperty(el, 'textContent', {
    get: () => _t, set: (v) => { _t = String(v); if (_t) painted.push(['textContent', id, _t]); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => _h, set: (v) => { _h = String(v); if (_h) painted.push(['innerHTML', id, _h]); },
  });
  return el;
}

/* ── 真的 store（一個普通物件就夠，board-cache 只用 get/set/removeItem/key/length）── */
function makeStore(seed) {
  const s = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
    clear() { Object.keys(s).forEach((k) => delete s[k]); },
    key: (i) => Object.keys(s)[i] || null,
    get length() { return Object.keys(s).length; },
    __raw: s,
  };
}

/** 先用模組自己的 cacheSave 把一筆快取種進 store（與頁面用的是同一套加密）。 */
async function seedCache(fp, name, obj) {
  const store = makeStore();
  const BC = require(path.join(ROOT, 'assets', 'board-cache.js'));
  BC.__setStoreForTest(store);
  BC.__setCryptoForTest(webcrypto.subtle);
  await BC.cacheSave(fp, name, obj);
  BC.__resetForTest();
  return store.__raw;
}

async function main() {
  const seedMap = {
    'paint-bad': { fp: 'U_SUB_1', name: 'getHrPending', obj: { ok: false, msg: '無權限或連結已失效。' } },
    'paint-good': { fp: 'U_SUB_1', name: 'getHrPending', obj: { ok: true, rows: [], msg: '' } },
  }[MODE];
  let seeded = {};
  if (seedMap) seeded = await seedCache(seedMap.fp, seedMap.name, seedMap.obj);

  const timers = new Set();
  const storage = makeStore(seeded);
  const pending = () => new Promise(() => {});
  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const doc = {
    getElementById: getEl, querySelector: () => fakeEl('?'), querySelectorAll: () => [],
    createElement: (t) => fakeEl('new:' + t), createTextNode: () => fakeEl('text'),
    body: fakeEl('body'), documentElement: fakeEl('html'), head: fakeEl('head'),
    addEventListener() {}, removeEventListener() {}, readyState: 'complete',
  };

  const idTok = MODE === 'fp-noid' ? '' : 'IDTOK';
  const liff = {
    init: () => Promise.resolve(), isLoggedIn: () => true,
    getIDToken: () => idTok,
    getDecodedIDToken: () => {
      if (MODE === 'fp-nosub') throw new Error('no decoded token');
      return { sub: 'U_SUB_1' };
    },
    login(o) { liff.__loginArgs = o; }, getProfile: pending,
    closeWindow() {}, openWindow() {}, getOS: () => 'ios',
    isInClient: () => true, getVersion: () => '2.0.0',
  };
  const search = MODE === 'fp-token' ? '?t=STUBTOKEN' : '';
  const urls = [];
  const ctx = {
    console, document: doc, liff,
    navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
    location: { href: 'https://campaign.jdc-corpn.com.tw/board.html' + search, search,
                pathname: '/board.html', origin: 'https://campaign.jdc-corpn.com.tw', hash: '',
                replace() {}, assign() {}, reload() {} },
    localStorage: storage, sessionStorage: makeStore(),
    // 網路永遠不回——模擬「離線／慢」，那正是快取會被畫出來的情境。
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
    crypto: webcrypto,                       // 🔴 真的 WebCrypto，不是永不 resolve 的替身
    isSecureContext: true, performance: { now: () => 0, getEntriesByType: () => [] },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  process.on('unhandledRejection', () => {});
  const fpCalls = [];
  while ((m = re.exec(html)) !== null) {
    const src = ((m[1] || '').match(/\bsrc="([^"]+)"/) || [])[1];
    if (src) {
      if (/^https?:|^\/\//.test(src)) continue;
      const p = path.join(ROOT, src);
      if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: src, timeout: 5000 });
      // 資產載入後、內嵌腳本執行前，把快取層的入口包起來記錄它收到的指紋。
      if (src.indexOf('board-cache') >= 0) {
        ['cacheBootstrap', 'cacheSave', 'persistBatchSlices', 'cacheClear'].forEach((fn) => {
          const orig = ctx[fn];
          if (typeof orig !== 'function') return;
          ctx[fn] = function (tokenArg) {
            fpCalls.push([fn, JSON.stringify(tokenArg)]);
            return orig.apply(this, arguments);
          };
        });
      }
    } else if (m[2].trim()) {
      vm.runInContext(m[2], ctx, { filename: 'board inline', timeout: 5000 });
    }
  }

  await new Promise((r) => setTimeout(r, 600));
  const hit = painted.filter((p) => p[2].indexOf('無權限或連結已失效') >= 0);
  console.log('=== MODE=' + MODE + ' ===');
  console.log('TOKEN=' + JSON.stringify(ctx.TOKEN) + '  ID_TOKEN=' + JSON.stringify(ctx.ID_TOKEN)
    + '  FP=' + JSON.stringify(ctx.FP));
  console.log('快取層收到的指紋：' + (fpCalls.length ? JSON.stringify(fpCalls) : '(一次都沒被呼叫)'));
  console.log('store 裡的鍵：' + JSON.stringify(Object.keys(storage.__raw)));
  console.log('送出的請求數：' + urls.length);
  console.log('畫面上出現「無權限或連結已失效」的次數：' + hit.length
    + (hit.length ? '  ← ' + JSON.stringify(hit.slice(0, 3)) : ''));
  console.log('畫面被寫入的文字筆數（零點：這個數字是 0 就代表整輪什麼都沒畫，上面那個 0 不算數）：'
    + painted.length);
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  process.exit(0);
}
main();
