/**
 * **分流頁 `me.html` 的接線**（E1b 第 1 項，2026-09-12）。
 *
 * 🔴 **`page-load.test.js` 只證明「載得起來」**——它跑完整頁 script 而不看畫面，
 *    所以「清單畫錯、未遷移的頁做成了可點的連結」它一條都不會紅。
 *    而那正是這一頁唯一會害到人的錯：**點下去必定被擋，而他什麼都沒做錯。**
 *
 * ⚠️ 手法沿用 `board-e1a-wiring.test.js`：把頁面的 script 丟進 stub 環境跑，
 *    測的是 `me.html` 裡真正那幾行字。DOM 與網路是假的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** 一顆記得住 innerHTML／textContent 的假元素（畫面內容就是本檔的受測物）。 */
function fakeEl(id) {
  return {
    id: id || '', style: {}, dataset: {}, children: [], className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    innerHTML: '', textContent: '', value: '', hidden: false, href: '',
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {},
    removeAttribute() {}, addEventListener(t, f) { (this.__on = this.__on || {})[t] = f; },
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, click() { if (this.__on && this.__on.click) this.__on.click(); }, remove() {},
  };
}

/**
 * 跑 me.html。
 * @param {object} o  `reply`＝後端要回的 JSON；`transportFail`＝連線層直接壞掉
 */
function runMe(o) {
  const opt = o || {};
  const 送出 = [];
  const timers = new Set();
  const els = {};
  const get = (id) => (els[id] || (els[id] = fakeEl(id)));
  const pending = () => new Promise(() => {});
  const doc = {
    getElementById: get, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => fakeEl(t), body: fakeEl('body'), documentElement: fakeEl('html'),
    head: fakeEl('head'), addEventListener() {}, readyState: 'complete',
  };
  const liff = {
    __initCalled: 0, __loginArgs: null, __logoutCalled: 0,
    init(a) { liff.__initCalled++; return Promise.resolve(a); },
    isLoggedIn: () => opt.loggedIn !== false,
    getIDToken: () => (opt.idToken === undefined ? 'IDTOK' : opt.idToken),
    getDecodedIDToken: () => ({ sub: 'U_SUB_1' }),
    logout() { liff.__logoutCalled++; },
    login(a) { liff.__loginArgs = a; },
    getProfile: pending, closeWindow() {}, openWindow() {}, isInClient: () => true,
  };
  const ctx = {
    console, document: doc, liff: opt.noLiff ? undefined : liff,
    navigator: { userAgent: 'node-stub' },
    location: { href: 'http://localhost/me.html', search: '', pathname: '/me.html',
                origin: 'http://localhost', hash: '', replace() {}, assign() {}, reload() {} },
    fetch: (u, init) => {
      送出.push({ url: String(u), body: String((init && init.body) || '') });
      if (opt.transportFail) return Promise.reject(new Error('boom'));
      return Promise.resolve({
        text: () => Promise.resolve('cb(' + JSON.stringify(opt.reply || { ok: true, who: '甲', pages: [] }) + ')'),
      });
    },
    URL, URLSearchParams, Promise, Date, Math, JSON, Object, Array, String, Number,
    Boolean, RegExp, Error, Buffer,
    setTimeout: (f, m) => { const i = setTimeout(f, m); timers.add(i); return i; },
    clearTimeout: (i) => { timers.delete(i); return clearTimeout(i); },
    setInterval: (f, m) => { const i = setInterval(f, m); timers.add(i); return i; },
    clearInterval: (i) => { timers.delete(i); return clearInterval(i); },
    alert() {}, confirm: () => false, addEventListener() {}, removeEventListener() {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
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
        vm.runInContext(m[2], ctx, { filename: 'me inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  return { ctx, els, get, liff, 送出,
           cleanup: () => { for (const i of timers) { clearTimeout(i); clearInterval(i); } timers.clear(); } };
}

const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(() => setImmediate(r)))));

const 四頁 = {
  ok: true, who: '丁小恆',
  pages: [
    { page: 'board.html', title: '人事異動看板', gateAction: 'getCheckinPending', lineReady: true, note: '' },
    { page: 'messages.html', title: 'LINE 訊息紀錄', gateAction: 'getMsgLogToken', lineReady: false, note: '需另外開通檢視權限' },
  ],
};

/* ══ ⬛ 對照組先行 ═══════════════════════════════════════════════════════ */

test('⬛ 對照組：登入正常時，真的打了 listMyPages 並把清單畫出來', async () => {
  const r = runMe({ reply: 四頁 });
  await settle();
  try {
    assert.equal(r.liff.__initCalled, 1, 'LIFF 沒被初始化 ⇒ 這一頁的身分那一段根本沒跑');
    assert.equal(r.送出.length, 1, '沒有送出任何呼叫（或送了不只一次）');
    assert.match(r.送出[0].body, /(^|&)action=listMyPages(&|$)/, '打的不是 listMyPages');
    assert.match(r.get('who').textContent, /丁小恆/, '畫面沒說出是以誰的身分進來的');
    assert.ok(r.get('list').innerHTML.length > 50, '清單是空的 ⇒ 下面那些斷言在驗沒發生的事');
  } finally { r.cleanup(); }
});

/* ══ 🔴 這一頁不可以碰 token ══════════════════════════════════════════════ */

test('🔴 送出的呼叫帶 idToken、**一個 token 參數都不帶**（帶了後端就改走舊路）', async () => {
  const r = runMe({ reply: 四頁 });
  await settle();
  try {
    const b = r.送出[0].body;
    assert.match(b, /(^|&)idToken=IDTOK(&|$)/, '沒帶 idToken ⇒ 後端永遠認不出他是誰');
    assert.equal(/(^|&)t(oken)?=/.test(b), false,
      '帶了 token 參數 ⇒ 後端 `_hasTok` 成立、整條路改走 gateAction，'
      + '而這一頁存在的前提就是他手上沒有那串。送出的是：' + b);
  } finally { r.cleanup(); }
});

test('🔴 整頁不得產生任何帶 ?t= 的連結（登入不是憑證發放機，2026-09-12 拍板）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  // 只看程式碼與標記，註解裡講這件事是刻意的（那正是它被寫下來的原因）。
  const 去註解 = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/\?t=|[?&]t=['"+]|urlToken\s*\(/.test(去註解), false,
    'me.html 出現了 `?t=` 或 urlToken() ⇒ 它開始經手那串憑證了');
  // ⬛ 對照組：這把尺分得出「有」——board.html 就真的有（它兩條路都走）。
  const board = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/\?t=|urlToken\s*\(/.test(board), true,
    '連 board.html 都掃不到 `?t=` ⇒ 這把尺什麼都沒測到，上面那條的綠燈是假的');
});

/* ══ 🔴 可點與不可點 ════════════════════════════════════════════════════ */

test('🔴 lineReady:true → 真的可點的 <a>；lineReady:false → 沒有 <a>，而且說得出為什麼', async () => {
  const r = runMe({ reply: 四頁 });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    assert.match(h, /<a class="card" href="board\.html">/,
      '已遷移的頁沒做成連結 ⇒ 他明明進得去，卻沒有入口');
    assert.match(h, /人事異動看板/);
    // 🔴 未遷移的頁：出現在畫面上，但不是連結。
    assert.match(h, /LINE 訊息紀錄/, '未遷移的頁被藏起來了 ⇒ 「沒權限」與「還沒做好」變同一個畫面');
    assert.equal(/<a[^>]+href="messages\.html"/.test(h), false,
      '未遷移的頁做成了可點的連結 ⇒ 點下去必定被擋，而他什麼都沒做錯');
    assert.match(h, /尚未支援 LINE 登入/, '不可點的那一列沒說出為什麼');
    assert.match(h, /需另外開通檢視權限/, 'note 沒畫出來 ⇒ 「守門算不出來」這件事被吞掉了');
  } finally { r.cleanup(); }
});

test('⬛ 對照組：把 lineReady 反過來，可點／不可點必須整個對調（否則上面是恆真）', async () => {
  const r = runMe({ reply: { ok: true, who: '甲', pages: [
    { page: 'board.html', title: '人事異動看板', gateAction: 'getCheckinPending', lineReady: false, note: '' },
    { page: 'messages.html', title: 'LINE 訊息紀錄', gateAction: 'getMsgLogToken', lineReady: true, note: '' },
  ] } });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    assert.equal(/<a[^>]+href="board\.html"/.test(h), false, 'lineReady 反過來了，board 卻還是連結 ⇒ 這一格根本沒看 lineReady');
    assert.match(h, /<a class="card" href="messages\.html">/);
  } finally { r.cleanup(); }
});

/* ══ 🔴 空清單與失敗：每一種要講不同的話 ═══════════════════════════════ */

test('🔴 空清單 → 不是錯誤畫面，而且要把「你是誰」留在畫面上', async () => {
  const r = runMe({ reply: { ok: true, who: '丁小祥', pages: [] } });
  await settle();
  try {
    assert.match(r.get('who').textContent, /丁小祥/,
      '空清單時沒說出身分 ⇒ 「我沒權限」與「我登入成了另一個 LINE 帳號」在畫面上一模一樣');
    assert.match(r.get('list').innerHTML, /沒有可以進入的頁面/);
    assert.equal(/msg-err/.test(r.get('list').innerHTML), false,
      '空清單畫成紅色錯誤 ⇒ 他會以為系統壞了而一直重試');
  } finally { r.cleanup(); }
});

test('🔴 憑證壞掉 → 給「重新登入」鈕；權限算不出來 → 不給（重登對後者永遠沒用）', async () => {
  const 壞憑證 = runMe({ reply: { ok: false, msg: '請重新登入。', reason: 'line_bad_token' } });
  await settle();
  const 算不出角色 = runMe({ reply: { ok: false, msg: '系統目前讀不到您的權限設定。', reason: 'role_unresolved' } });
  await settle();
  try {
    assert.match(壞憑證.get('list').innerHTML, /重新登入/, '憑證過期卻沒給重登的路');
    assert.match(壞憑證.get('list').innerHTML, /請重新登入。/, '沒把後端那句話原樣顯示出來');
    assert.equal(/id="relogin"/.test(算不出角色.get('list').innerHTML), false,
      '「讀不到權限設定」也給了重登鈕 ⇒ 他會一直重登一直失敗，而問題根本不在他身上');
    assert.match(算不出角色.get('list').innerHTML, /讀不到您的權限設定/);
  } finally { 壞憑證.cleanup(); 算不出角色.cleanup(); }
});

test('🔴 按下重新登入要先 logout 再 login（只 login 會帶著同一把過期憑證直接回來）', async () => {
  const r = runMe({ reply: { ok: false, msg: '請重新登入。', reason: 'line_no_token' } });
  await settle();
  try {
    r.get('relogin').click();
    assert.equal(r.liff.__logoutCalled, 1, '沒有先登出 ⇒ 他會一直按、一直失敗');
    assert.ok(r.liff.__loginArgs, '沒有去登入');
  } finally { r.cleanup(); }
});

test('🔴 連線失敗與「伺服器說不行」講不同的話（一個重試有用、一個永遠沒用）', async () => {
  const 斷線 = runMe({ transportFail: true });
  await settle();
  const 被拒 = runMe({ reply: { ok: false, msg: '此連結非您的權限範圍。', reason: 'role_mismatch' } });
  await settle();
  try {
    assert.notEqual(斷線.get('who').textContent, 被拒.get('who').textContent,
      '兩種失敗講同一句話 ⇒ 其中一種的人會被指錯路');
    assert.match(斷線.get('list').innerHTML, /連線|網路/);
    assert.equal(/id="relogin"/.test(斷線.get('list').innerHTML), false,
      '斷線卻叫他重新登入 ⇒ 重登不會讓網路變好');
  } finally { 斷線.cleanup(); 被拒.cleanup(); }
});

/* ══ 🔴 還沒登入：不可以帶著空憑證去打後端 ════════════════════════════ */

test('🔴 還沒登入 → 去 LINE 登入，且一個呼叫都不發（空憑證打後端＝製造一發必定失敗）', async () => {
  const r = runMe({ loggedIn: false });
  await settle();
  try {
    assert.ok(r.liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(r.liff.__loginArgs.redirectUri, 'http://localhost/me.html',
      'redirectUri 不是本頁 ⇒ 登完回不來');
    assert.deepStrictEqual(r.送出, [], '還沒登入就發車了');
  } finally { r.cleanup(); }
});

test('🔴 登入了卻拿不到憑證 → 明講是後台設定問題，而且不發車', async () => {
  const r = runMe({ idToken: '' });
  await settle();
  try {
    assert.deepStrictEqual(r.送出, [], '拿不到憑證還是發車了 ⇒ 換來一句看不懂的後端錯誤');
    assert.match(r.get('list').innerHTML, /重新整理不會好|資訊人員/,
      '沒說出「重新整理不會好」⇒ 他會一直重整');
  } finally { r.cleanup(); }
});

test('🔴 LIFF SDK 根本沒載進來 → 出聲，不要停在「確認身分中…」', async () => {
  const r = runMe({ noLiff: true });
  await settle();
  try {
    assert.equal(/確認身分中/.test(r.get('who').textContent), false,
      '停在初始文案 ⇒ 使用者只會看到一頁不動的畫面，而沒有人知道是哪一段壞了');
    assert.match(r.get('list').innerHTML, /LINE 的元件/);
  } finally { r.cleanup(); }
});

/* ══ 🔴 清單是後端算的，不是這一頁算的 ════════════════════════════════ */

test('🔴 頁面清單不得寫死在前端（寫死＝兩份會分歧，而分歧長成「點了被擋」）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  const 去註解 = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  ['board.html', 'stats.html', 'hr-stats.html', 'messages.html', 'staff.html'].forEach((p) => {
    assert.equal(去註解.indexOf("'" + p + "'") >= 0 || 去註解.indexOf('"' + p + '"') >= 0, false,
      'me.html 的程式碼裡寫死了 ' + p + ' ⇒ 它開始自己維護一份清單了');
  });
  // ⬛ 對照組：這把尺掃得到真的有寫死頁名的東西（本檔自己就有那五個字串）。
  const 自己 = fs.readFileSync(__filename, 'utf8');
  assert.equal(自己.indexOf("'board.html'") >= 0, true,
    '連本檔自己都掃不到 ⇒ 上面那條的「沒有」只是尺壞了');
});
