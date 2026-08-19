const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 「整頁能不能載入」測試。
 *
 * 為何存在（2026-08-20，T268）：
 * `node --check` 只抓 SyntaxError，**抓不到執行期的頂層拋錯**。
 * 2026-08-19 的 Critical 就是這一型——`stats.html` 把 `SECOND.then(...)` 寫在
 * `var SECOND = …` 賦值之前，`var` 被 hoist 但值還是 undefined，
 * `undefined.then` 直接 TypeError → **那一行之後的所有程式碼一行都沒跑**。
 * 當時 149 個單元測試全綠、`node --check` 也過，因為
 * **沒有任何東西在跑那些 inline script**。我甚至回報過「已驗證通過」。
 *
 * 這支把每頁的 `<script src>` 與 inline `<script>` 依序丟進一個 stub 環境執行，
 * 只要頂層同步拋錯就紅。
 *
 * ⚠️ 它驗的是「載得起來」，不是「功能正確」——DOM 是假的、網路是假的。
 * 功能正確仍然要靠真瀏覽器實測。
 */

const ROOT = path.join(__dirname, '..');
const PAGES = ['admin.html', 'board.html', 'stats.html', 'attend.html', 'hr-stats.html', 'messages.html'];

/** 一個什麼都收的假元素——頁面頂層常直接對 getElementById 的結果取屬性。 */
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, options: [], children: [], files: [],
    innerHTML: '', outerHTML: '', textContent: '', innerText: '', value: '', href: '', src: '',
    checked: false, disabled: false, hidden: false, selectedIndex: -1, scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore(c) { return c; }, replaceChildren() {}, remove() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    click() {}, focus() {}, blur() {}, scrollIntoView() {}, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    checkVisibility() { return true; },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {},
  };
  el.parentNode = null;
  return el;
}

function makeContext() {
  const doc = {
    title: '', readyState: 'complete', cookie: '',
    getElementById() { return fakeEl(); },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    getElementsByClassName() { return []; },
    createElement(t) { return fakeEl(t); },
    createTextNode() { return fakeEl(); },
    createDocumentFragment() { return fakeEl(); },
    addEventListener() {}, removeEventListener() {},
    write() {}, writeln() {},
  };
  doc.body = fakeEl('body');
  doc.head = fakeEl('head');
  doc.documentElement = fakeEl('html');

  const store = {};
  const storage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    key(i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; },
  };

  // 網路一律掛住：我們只驗頂層同步流程，不驗非同步結果。
  const pending = () => new Promise(() => {});

  const ctx = {
    console,
    document: doc,
    navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
    location: {
      href: 'http://localhost/board.html?t=STUBTOKEN&act=&mt=STUBMT',
      search: '?t=STUBTOKEN&act=&mt=STUBMT',
      pathname: '/board.html', origin: 'http://localhost', hash: '',
      replace() {}, assign() {}, reload() {},
    },
    localStorage: storage,
    sessionStorage: storage,
    fetch: pending,
    XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {} }; },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame: clearTimeout,
    alert() {}, confirm() { return false; }, prompt() { return null; },
    addEventListener() {}, removeEventListener() {},
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    getComputedStyle() { return { display: 'block', getPropertyValue() { return ''; } }; },
    Event: function (t) { return { type: t }; },
    CustomEvent: function (t) { return { type: t }; },
    Blob: function () { return {}; },
    FileReader: function () { return { readAsText() {}, addEventListener() {} }; },
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    crypto: {
      getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; },
      subtle: { digest: pending, importKey: pending, encrypt: pending, decrypt: pending },
    },
    isSecureContext: true,
    performance: { now: () => 0, getEntriesByType: () => [] },
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

/** 取出頁面依序要跑的程式碼：先 <script src>（本站相對路徑），再 inline。 */
function scriptsOf(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const src = (attrs.match(/\bsrc="([^"]+)"/) || [])[1];
    if (src) {
      if (/^https?:|^\/\//.test(src)) continue;            // 外部 CDN 不抓
      const p = path.join(ROOT, src);
      if (fs.existsSync(p)) out.push({ name: src, code: fs.readFileSync(p, 'utf8') });
    } else if (m[2].trim()) {
      out.push({ name: `${page} inline#${out.length}`, code: m[2] });
    }
  }
  return out;
}

for (const page of PAGES) {
  test(`${page}：所有 script 依序跑完，頂層不得拋錯`, () => {
    const ctx = makeContext();
    vm.createContext(ctx);
    // 非同步的失敗不算——這支只驗「載得起來」，網路與 DOM 都是假的
    const onRej = () => {};
    process.on('unhandledRejection', onRej);
    try {
      for (const s of scriptsOf(page)) {
        try {
          vm.runInContext(s.code, ctx, { filename: s.name, timeout: 5000 });
        } catch (e) {
          assert.fail(`${s.name} 頂層拋錯：${e && e.message}\n${(e && e.stack || '').split('\n').slice(0, 4).join('\n')}`);
        }
      }
    } finally {
      process.removeListener('unhandledRejection', onRej);
    }
  });
}

test('對照組：把 Critical 的形狀重現一次，這支測試必須抓得到', () => {
  // stats.html 2026-08-19 的真實錯法：頂層先用 SECOND，才在後面 var SECOND = …
  const broken = 'SECOND.then(function(){});\nvar SECOND = Promise.resolve();';
  const ctx = makeContext();
  vm.createContext(ctx);
  assert.throws(() => vm.runInContext(broken, ctx, { filename: 'broken' }), /TypeError/,
    '這支測試必須抓得到「頂層在賦值前使用 var」——抓不到就代表整組頁面測試沒有防護力');
});
