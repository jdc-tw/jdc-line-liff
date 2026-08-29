/**
 * tpl-editor.test.js — 範本編輯器的行為守門。
 *
 * 🔴 **這個檔在 assets/tpl-editor.js 存在之前就先寫好了**（2026-08-29）。
 *    tpl-editor.js 是從 stats.html 搬出來的，而「行為不變」若沒有搬動前就
 *    存在的測試，只是宣稱。下面每一條斷言的都是搬動**前** stats.html 的實際行為，
 *    唯二的例外標了〔行為變更〕，那是一項刻意的正確性修正。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { tplEsc, phList, renderMirrorHtml, registerPhSet, enableEmoji,
        renderEmojiPalette, GLOBALS_DECLARED } = require('../assets/tpl-editor.js');

test('對照組：模組真的匯出得到（assets/*.js 沒有自動 shim）', () => {
  assert.equal(typeof renderMirrorHtml, 'function', '忘了寫 module.exports');
});

test('🔴 不可以宣告全域 esc——stats-view.js 已經佔了那個名字（74 處呼叫）', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'assets', 'tpl-editor.js'), 'utf8');
  assert.ok(!/^function esc\s*\(/m.test(src),
    '宣告了全域 esc，會覆寫 stats-view.js 那個只跳脫 < 的版本');
  assert.ok(!/^var esc\s*=/m.test(src));
});

test('🔴 既有 bc 組的佔位符一個不少（照抄搬動前的 stats.html）', () => {
  assert.deepStrictEqual(phList('bc').map((p) => p.k),
    ['姓名', '單位', '活動名', '日期', '桌次', '連結']);
  assert.equal(phList('bc').find((p) => p.k === '連結').why,
    '不能刪，沒有它同仁點不到報到碼', '「為何不能刪」的提示掉了');
});

test('🔴 既有 sn 組的佔位符一個不少', () => {
  assert.deepStrictEqual(phList('sn').map((p) => p.k),
    ['姓名', '單位', '年資', '年度', '入社日']);
});

test('不存在的組回空陣列，不可拋', () => {
  assert.deepStrictEqual(phList('沒這組'), []);
  assert.deepStrictEqual(phList(undefined), []);
});

test('🔴 認得的佔位符上色、不認得的不上色（一眼看出打錯字）', () => {
  const h = renderMirrorHtml('{姓名}與{姓名2}', 'bc');
  assert.ok(h.indexOf('<mark>{姓名}</mark>') >= 0, '認得的沒上色');
  assert.ok(h.indexOf('<mark>{姓名2}</mark>') < 0, '不認得的上色了——打錯字就看不出來');
});

test('🔴 同一組的佔位符在不同組不上色（組別真的有作用）', () => {
  assert.ok(renderMirrorHtml('{年資}', 'sn').indexOf('<mark>') >= 0);
  assert.ok(renderMirrorHtml('{年資}', 'bc').indexOf('<mark>') < 0, 'bc 組沒有「年資」');
});

test('🔴 跳脫在最前面（既有 stats.html 的順序，照搬不可改）', () => {
  const h = renderMirrorHtml('<img src=x onerror=alert(1)>', 'bc');
  assert.ok(h.indexOf('<img src=x') < 0, '產生了真的 img 元素');
  assert.ok(h.indexOf('&lt;img') >= 0, '角括號沒有被跳脫');
});

// ⚠️ 下面這兩條不是「現況」，是刻意的行為變更。
//    既有 stats-view.js 的全域 esc **只跳脫 `<`**（一手碼 assets/stats-view.js:7），
//    而 tplEsc 跳脫五個字元。所以本次搬動**不是純粹的行為不變重構**，
//    它含一個明示的正確性修正。
test('🔴〔行為變更〕& 與引號也要被跳脫（舊版只跳脫 <）', () => {
  assert.ok(renderMirrorHtml('A & B', 'bc').indexOf('&amp;') >= 0);
  assert.ok(renderMirrorHtml('a" onload="x', 'bc').indexOf('&quot;') >= 0);
});

test('🔴〔行為變更・對照〕舊版對字面 &amp; 會少跳一層，新版對齊才正確', () => {
  // 唯一有可見差異的輸入是「內容本身就含 HTML entity」：
  //   舊：`&amp;` → HTML 裡還是 `&amp;` → 渲染成 `&`（1 字）→ 與 textarea 的 5 字**錯位**
  //   新：`&amp;` → `&amp;amp;`        → 渲染成 `&amp;`（5 字）→ **對齊正確**
  // 鏡像層的文字是 transparent、只有 <mark> 底色看得見，所以差異表現為
  // 「底色位置偏移」而不是「文字變了」。新版是修好，不是弄壞。
  const h = renderMirrorHtml('&amp;', 'bc');
  assert.ok(h.indexOf('&amp;amp;') >= 0, '沒有把字面 entity 再跳一層');
});

test('🔴 佔位符的比對是在「已跳脫的字串」上做的，含角括號的假佔位符不上色', () => {
  assert.ok(renderMirrorHtml('{<b>}', 'bc').indexOf('<mark>') < 0);
});

test('佔位符名稱超過 12 字不上色（既有 regex 的上限，照搬）', () => {
  assert.ok(renderMirrorHtml('{' + '字'.repeat(13) + '}', 'bc').indexOf('<mark>') < 0);
});

test('換行不會讓佔位符跨行匹配（既有 regex 的 [^{}\\n]，照搬）', () => {
  assert.ok(renderMirrorHtml('{姓\n名}', 'bc').indexOf('<mark>') < 0);
});

test('tplEsc：null / undefined 回空字串，不會印出 "null"', () => {
  assert.equal(tplEsc(null), '');
  assert.equal(tplEsc(undefined), '');
});

test('registerPhSet：註冊新的一組，既有兩組不受影響', () => {
  registerPhSet('zz-test', [{ k: '測試欄' }]);
  assert.deepStrictEqual(phList('zz-test').map((p) => p.k), ['測試欄']);
  assert.deepStrictEqual(phList('bc').map((p) => p.k),
    ['姓名', '單位', '活動名', '日期', '桌次', '連結'], '註冊新組動到了既有的 bc');
});

/* ── 全域命名衝突的機械檢查 ────────────────────────────────────────────
   抽出的模組會和 stats.html 已載入的九支 asset 共用同一個全域範圍。
   **同名的 function／var 後載入者會覆寫前一個，而且零錯誤訊息。** */

/**
 * 🔴 **實際把檔案載進一個隔離的 context，比對前後的全域名單**——
 *    不要用 regex 猜 JavaScript 的作用域。regex 版有三種漏法：
 *
 *   | 寫法                    | vm   | regex |
 *   |-------------------------|------|-------|
 *   | `  var esc = 1;`（縮排）| 抓到 | **漏**|  ← 縮排在 JS 沒有作用域語意，它仍是全域
 *   | `var safe = 1, esc = 2;`| 抓到 | 只第一個 |
 *   | `this.esc = 1;`         | 抓到 | **漏**|  ← 等同 window.esc =
 *
 * ⚠️ **vm 也有一個看不見的**：頂層 const／let 建立的是語彙綁定，不是 context
 *    的 own property。所以下面另外用一條 regex 禁掉它們。那條是補洞不是主要防線
 *    ——const 衝突的後果是載入時直接 SyntaxError（吵的），不是靜默覆寫（安靜的）。
 */
function globalsAddedBy(src, ctx, filename) {
  const vm = require('node:vm');
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(src, ctx, { filename: filename });
  return Object.getOwnPropertyNames(ctx).filter((n) => !before.has(n));
}

/** 最小的瀏覽器替身。 */
function browserStub() {
  const vm = require('node:vm');
  const noop = () => {};
  const el = new Proxy({}, { get: () => noop, set: () => true });
  const doc = new Proxy({ getElementById: () => el, createElement: () => el,
                          querySelectorAll: () => [], querySelector: () => el,
                          addEventListener: noop, body: el, head: el },
                        { get: (t, k) => (k in t ? t[k] : noop) });
  const ctx = { document: doc, console, setTimeout, clearTimeout, JSON, Math, Date,
                localStorage: { getItem: () => null, setItem: noop },
                location: { href: '', search: '' }, navigator: {}, fetch: noop };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  return vm.createContext(ctx);
}

/** stats.html 在 inline script 之前載入的九支（一手碼：stats.html 460-468 行）。 */
const LOADED_BEFORE_INLINE = ['deny-no-role.js', 'roster-wide.js', 'roster-dl.js',
  'seating.js', 'xlsx-post.js', 'stats-view.js', 'send-modal.js', 'qr-badge.js',
  'board-cache.js'];

test('對照組：替身夠用——九支既有 asset 全部載得進去', () => {
  // 載不進去的話下面兩條測的就是「空集合 vs 空集合」，恆綠而且什麼都沒測到。
  const fs = require('node:fs'), path = require('node:path');
  const A = path.join(__dirname, '..', 'assets');
  const ctx = browserStub();
  const all = [];
  LOADED_BEFORE_INLINE.forEach((f) => {
    all.push(...globalsAddedBy(fs.readFileSync(path.join(A, f), 'utf8'), ctx, f));
  });
  assert.ok(all.length > 50, '只抓到 ' + all.length + ' 個全域，替身可能讓某些檔提早中斷');
  assert.ok(all.indexOf('esc') >= 0, '沒抓到 stats-view.js 的全域 esc——這個量法壞了');
});

test('🔴 本檔的全域名稱不得與 stats.html 已載入的 asset 重疊', () => {
  const fs = require('node:fs'), path = require('node:path');
  const A = path.join(__dirname, '..', 'assets');
  const ctx = browserStub();
  const theirs = new Set();
  LOADED_BEFORE_INLINE.forEach((f) => {
    globalsAddedBy(fs.readFileSync(path.join(A, f), 'utf8'), ctx, f)
      .forEach((n) => theirs.add(n));
  });
  // 換一個乾淨的 context 載本檔，才知道「本檔自己新增了什麼」
  const mine = globalsAddedBy(
    fs.readFileSync(path.join(A, 'tpl-editor.js'), 'utf8'), browserStub(), 'tpl-editor.js');
  const clash = mine.filter((n) => theirs.has(n));
  assert.deepStrictEqual(clash, [],
    '這幾個全域名稱會覆寫既有 asset 的同名東西（後載入者贏，零錯誤訊息）：'
    + clash.join(', '));
});

test('🔴 GLOBALS_DECLARED 與實際新增的全域完全一致（多列少列都要紅）', () => {
  const fs = require('node:fs'), path = require('node:path');
  const mine = globalsAddedBy(
    fs.readFileSync(path.join(__dirname, '..', 'assets', 'tpl-editor.js'), 'utf8'),
    browserStub(), 'tpl-editor.js');
  assert.deepStrictEqual(mine.slice().sort(), GLOBALS_DECLARED.slice().sort(),
    'manifest 與實際新增的全域不一致——'
    + '漏列會讓上面那條衝突檢查不知道要檢查它；多列則是 manifest 說謊');
});

test('🔴 補洞：本檔不得用頂層 let/const（vm 看不見它們）', () => {
  // 這條是 vm 唯一看不見的東西。既有九支 asset 也都用 var，照它們的慣例。
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'tpl-editor.js'), 'utf8');
  const hits = src.match(/^\s*(let|const)\s+[A-Za-z_$][\w$]*/gm);
  assert.deepStrictEqual(hits, null, '用了頂層 let/const：' + (hits || []).join(' / '));
});

test('對照組：這四條量法真的分得出差異（不是恆綠）', () => {
  const g = (src) => globalsAddedBy(src, browserStub(), 't.js').sort();
  // 🔴 regex 版漏掉的三種，vm 都抓得到——這正是換掉 regex 的理由
  assert.deepStrictEqual(g('  var esc = 1;'), ['esc'], '縮排的頂層宣告沒抓到');
  assert.deepStrictEqual(g('var safe = 1, esc = 2;'), ['esc', 'safe'], '一行多個沒抓全');
  assert.deepStrictEqual(g('this.esc = 1;'), ['esc'], 'window 指派沒抓到');
  // 預設參數不該被誤判成第二個宣告
  assert.deepStrictEqual(g('var f = function (a, b = 1) {};'), ['f'], '預設參數被誤判了');
  // 而 const 確實看不見——這就是上面那條 regex 補洞測試存在的理由
  assert.deepStrictEqual(g('const esc = 1;'), [], 'const 竟然抓得到？那條補洞測試可以拿掉了');
});

/* ── emoji palette ────────────────────────────────────────────────────
   受測的只有「產生了幾個節點、綁了哪些事件、觸發後插入什麼字串」，
   用不到真的排版 ⇒ **不引入 jsdom**，本檔自己十來行假 DOM。
   真正的 DOM 行為在 Playwright 場景驗。 */

/** 假 DOM。只實作 renderEmojiPalette 與 insertAtCursor 真的會呼叫的那幾支。 */
function makeDomStub(ids) {
  function node(tag) {
    const n = {
      tagName: tag, children: [], listeners: {}, _html: '',
      value: '', selectionStart: null, selectionEnd: null,
      appendChild(c) { this.children.push(c); c._parent = this; return c; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      remove() {
        const p = this._parent;
        if (p) p.children = p.children.filter((x) => x !== this);
      },
      dispatchEvent() { return true; },
      focus() {},
    };
    Object.defineProperty(n, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = v; if (v === '') this.children = []; },
    });
    return n;
  }
  const store = {};
  (ids || []).forEach((id) => { store[id] = node('div'); });
  return {
    document: { getElementById: (id) => store[id] || null, createElement: node },
    get: (id) => store[id],
    /** 深度優先攤平，方便找按鈕 */
    all(root) {
      const out = [];
      (function walk(n) { out.push(n); n.children.forEach(walk); })(root);
      return out;
    },
  };
}

/** 借用假 DOM 跑一段，跑完一定還原全域 document。 */
function withStub(stub, fn) {
  const saved = global.document;
  global.document = stub.document;
  try { return fn(); } finally { global.document = saved; }
}

test('🔴 點一下插入的是合格式的標記（renderMirrorHtml 認得的那種）', () => {
  const stub = makeDomStub(['box', 'ta']);
  const ta = stub.get('ta');
  ta.selectionStart = ta.selectionEnd = 0;
  registerPhSet('wf2', []);
  enableEmoji('wf2', [{ productId: '670e0cce840a8236ddd4ee4c', emojiId: '001', label: '測試' }]);
  withStub(stub, () => {
    renderEmojiPalette('wf2', 'box', 'ta');
    const btn = stub.all(stub.get('box')).find((n) => n.tagName === 'button');
    assert.ok(btn, '一顆按鈕都沒畫出來');
    btn.listeners.mousedown[0]({ preventDefault() {} });
  });
  assert.equal(ta.value, '[[e:670e0cce840a8236ddd4ee4c:001]]');
  // 🔴 對照組：插進去的東西，鏡像層真的認得
  assert.ok(renderMirrorHtml(ta.value, 'wf2').indexOf('<img') >= 0,
    '插入的標記鏡像層不認得——兩邊的 regex 對不上');
});

test('🔴 插入走 insertAtCursor：插在游標處、游標跟著移到後面', () => {
  const stub = makeDomStub(['box', 'ta']);
  const ta = stub.get('ta');
  ta.value = '前後'; ta.selectionStart = ta.selectionEnd = 1;
  enableEmoji('wf2b', [{ productId: 'abc123', emojiId: '007' }]);
  registerPhSet('wf2b', []);
  withStub(stub, () => {
    renderEmojiPalette('wf2b', 'box', 'ta');
    stub.all(stub.get('box')).find((n) => n.tagName === 'button')
      .listeners.mousedown[0]({ preventDefault() {} });
  });
  assert.equal(ta.value, '前[[e:abc123:007]]後', '沒插在游標處');
  assert.equal(ta.selectionStart, 1 + '[[e:abc123:007]]'.length, '游標沒跟著移');
});

test('🔴 用 mousedown/touchstart 不用 click（行動裝置游標會跑掉）', () => {
  const stub = makeDomStub(['box', 'ta']);
  enableEmoji('wf2c', [{ productId: 'abc123', emojiId: '001' }]);
  registerPhSet('wf2c', []);
  withStub(stub, () => renderEmojiPalette('wf2c', 'box', 'ta'));
  const btn = stub.all(stub.get('box')).find((n) => n.tagName === 'button');
  const evs = Object.keys(btn.listeners);
  assert.ok(evs.indexOf('mousedown') >= 0 && evs.indexOf('touchstart') >= 0, evs.join(','));
  assert.ok(evs.indexOf('click') < 0, '用了 click——照抄 renderPhs 的理由，不要改');
});

test('沒開 emoji 的組畫出空的（bc / sn 一期不受影響）', () => {
  const stub = makeDomStub(['box', 'ta']);
  withStub(stub, () => renderEmojiPalette('bc', 'box', 'ta'));
  assert.equal(stub.get('box').children.length, 0);
});

test('palette 是空陣列或缺欄位時不炸', () => {
  const stub = makeDomStub(['box', 'ta']);
  enableEmoji('wf3', []); registerPhSet('wf3', []);
  assert.doesNotThrow(() => withStub(stub, () => renderEmojiPalette('wf3', 'box', 'ta')));
  enableEmoji('wf4', [{ productId: 'x' }]); registerPhSet('wf4', []);
  assert.doesNotThrow(() => withStub(stub, () => renderEmojiPalette('wf4', 'box', 'ta')));
});

test('🔴「更多」：沒給 groups 就不畫那顆按鈕（不留死按鈕）', () => {
  const stub = makeDomStub(['box', 'ta']);
  enableEmoji('wf5', [{ productId: 'abc123', emojiId: '001' }]);   // 沒給第三個參數
  registerPhSet('wf5', []);
  withStub(stub, () => renderEmojiPalette('wf5', 'box', 'ta'));
  const more = stub.all(stub.get('box')).filter((n) => n.tagName === 'button')
    .filter((b) => b.textContent === '更多…');
  assert.equal(more.length, 0, '沒有完整清單卻畫了「更多」，點下去是空的');
});

test('🔴「更多」：展開後畫出該組的全部顆數，再點一次收起', () => {
  const stub = makeDomStub(['box', 'ta']);
  enableEmoji('wf6', [{ productId: 'abc123', emojiId: '001' }],
    [{ productId: 'ggg111', count: 3 }, { productId: 'hhh222', count: 2, label: '符號' }]);
  registerPhSet('wf6', []);
  withStub(stub, () => {
    renderEmojiPalette('wf6', 'box', 'ta');
    const more = stub.all(stub.get('box')).find((b) => b.textContent === '更多…');
    assert.ok(more, '沒畫出「更多」按鈕');
    more.listeners.mousedown[0]({ preventDefault() {} });
    const panel = stub.get('box').children.find((c) => c.className === 'emo-panel');
    assert.ok(panel, '展開後沒有面板');
    const sel = panel.children.find((c) => c.tagName === 'select');
    assert.equal(sel.children.length, 2, '組別選單少了組');
    assert.equal(sel.value, '1', '沒有預設停在有名字的那一組（符號組）');
    const grid = panel.children.find((c) => c.className === 'emo-grid');
    assert.equal(grid.children.length, 2, '格子數不等於該組顆數');
    // 再點一次收起
    more.listeners.mousedown[0]({ preventDefault() {} });
    assert.equal(stub.get('box').children.filter((c) => c.className === 'emo-panel').length, 0,
      '再點一次沒收起來');
  });
});

test('🔴「更多」：換組會重畫，格子數跟著換', () => {
  const stub = makeDomStub(['box', 'ta']);
  enableEmoji('wf7', [{ productId: 'abc123', emojiId: '001' }],
    [{ productId: 'ggg111', count: 3 }, { productId: 'hhh222', count: 7, label: '符號' }]);
  registerPhSet('wf7', []);
  withStub(stub, () => {
    renderEmojiPalette('wf7', 'box', 'ta');
    stub.all(stub.get('box')).find((b) => b.textContent === '更多…')
      .listeners.mousedown[0]({ preventDefault() {} });
    const panel = stub.get('box').children.find((c) => c.className === 'emo-panel');
    const sel = panel.children.find((c) => c.tagName === 'select');
    const grid = panel.children.find((c) => c.className === 'emo-grid');
    assert.equal(grid.children.length, 7, '預設組（符號）的格子數不對');
    sel.value = '0';
    sel.listeners.change[0]({});
    assert.equal(grid.children.length, 3, '換組之後沒重畫');
  });
});

test('🔴「更多」的格子點下去，插入的是那一組的 id（不是常用一排的）', () => {
  const stub = makeDomStub(['box', 'ta']);
  const ta = stub.get('ta');
  ta.selectionStart = ta.selectionEnd = 0;
  enableEmoji('wf8', [{ productId: 'abc123', emojiId: '001' }],
    [{ productId: 'ggg111', count: 2 }]);
  registerPhSet('wf8', []);
  withStub(stub, () => {
    renderEmojiPalette('wf8', 'box', 'ta');
    stub.all(stub.get('box')).find((b) => b.textContent === '更多…')
      .listeners.mousedown[0]({ preventDefault() {} });
    const grid = stub.get('box').children.find((c) => c.className === 'emo-panel')
      .children.find((c) => c.className === 'emo-grid');
    grid.children[1].listeners.mousedown[0]({ preventDefault() {} });   // 第二顆
  });
  assert.equal(ta.value, '[[e:ggg111:002]]', '插到的不是「更多」那一組的第二顆');
});

test('🔴 tpl-editor.js 與 line-emoji.js 的全域不得重疊（welfare.html 會同頁載入）', () => {
  const fs = require('node:fs'), path = require('node:path');
  const A = path.join(__dirname, '..', 'assets');
  const g = (f) => globalsAddedBy(fs.readFileSync(path.join(A, f), 'utf8'), browserStub(), f);
  const mine = new Set(g('tpl-editor.js'));
  const clash = g('line-emoji.js').filter((n) => mine.has(n));
  assert.deepStrictEqual(clash, [], '同名全域，後載入者贏且零錯誤訊息：' + clash.join(', '));
});

test('🔴 line-emoji.js 也不得與 stats.html 已載入的九支重疊', () => {
  const fs = require('node:fs'), path = require('node:path');
  const A = path.join(__dirname, '..', 'assets');
  const ctx = browserStub();
  const theirs = new Set();
  LOADED_BEFORE_INLINE.forEach((f) => {
    globalsAddedBy(fs.readFileSync(path.join(A, f), 'utf8'), ctx, f).forEach((n) => theirs.add(n));
  });
  const clash = globalsAddedBy(
    fs.readFileSync(path.join(A, 'line-emoji.js'), 'utf8'), browserStub(), 'line-emoji.js')
    .filter((n) => theirs.has(n));
  assert.deepStrictEqual(clash, [], clash.join(', '));
});
