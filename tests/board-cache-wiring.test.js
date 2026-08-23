const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 快取「接線」測試（2026-08-23）。
 *
 * 為何存在：board-cache.js 的純函式測試（nameOfSlice／cacheDrop／N.preview）再完整，
 * 也證明不了 stats.html 真的有去讀那些快取。這次改動的起因正好就是這種洞——
 * `listActivities` 的快取寫了兩個多月、**全站沒有一處讀它**，而 58 條純函式測試全綠。
 * 同型的紀錄見 tests/staff-loop-wiring.test.js 與 tests/pass-diag-wiring.test.js。
 *
 * 手法：把 stats.html 裡那幾支函式的原始碼抽下來，配最小替身在 vm 裡跑。
 * 快取相關的相依一律給**真貨**（board-cache.js），給假的就等於沒驗到接線。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');
const BC = require('../assets/board-cache.js');

/** 從 stats.html 抽一支頂層函式的原始碼。抽不到就是簽名被改了，測試要跟著改。 */
function grab(name) {
  const re = new RegExp('^function ' + name + '\\([^)]*\\) ?\\{[\\s\\S]*?^\\}', 'm');
  const m = HTML.match(re);
  assert.ok(m, `stats.html 找不到 function ${name}(...)——改了簽名就要同步改這支測試`);
  return m[0];
}

/** 最小的 DOM 替身：只認得 id，記下每個元素被寫進什麼。 */
function fakeDoc(ids) {
  const els = {};
  ids.forEach((id) => {
    els[id] = {
      id, value: '', innerHTML: '', textContent: '', className: '', disabled: false,
      readOnly: false, style: {}, dataset: {}, options: [], selectedIndex: -1,
      addEventListener() {}, querySelectorAll: () => [],
    };
  });
  return {
    els,
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
  };
}

// ── ① 活動列表：命中快取要秒顯，且重抓必須走 queueRead ────────────────────
function runLoadActs({ cachedRows, netRows }) {
  BC.__resetForTest();
  const doc = fakeDoc(['act-list']);
  const painted = [];
  const order = [];
  const ctx = {
    console, Promise, String, JSON, document: doc,
    CACHE_READY: Promise.resolve(),
    cacheGet: (name) => {
      order.push('cacheGet:' + name);
      return cachedRows ? { value: { ok: true, rows: cachedRows }, savedAt: 1 } : null;
    },
    cacheSave: (tok, name, obj) => { order.push('cacheSave:' + name); return Promise.resolve(); },
    N: BC.N,                       // 真貨：名稱算錯就抓得到
    queueRead: (fn) => { order.push('queueRead'); return BC.queueRead(fn); },   // 真貨
    q: () => 'tok',
    esc: (s) => String(s),
    paintActs: (r) => { painted.push(r.rows); },
    jsonp: () => { order.push('jsonp'); return Promise.resolve({ ok: true, rows: netRows }); },
  };
  vm.createContext(ctx);
  vm.runInContext(grab('loadActs'), ctx, { filename: 'stats.html-loadActs' });
  return ctx.loadActs().then(() => ({ painted, order, box: doc.els['act-list'] }));
}

test('活動列表：有快取 → 先用快取畫一次，網路回來再畫一次（秒顯）', async () => {
  const r = await runLoadActs({ cachedRows: [{ id: 'old' }], netRows: [{ id: 'new' }] });
  assert.equal(r.painted.length, 2, '兩段繪製：快取一次、網路一次');
  assert.deepEqual(r.painted[0], [{ id: 'old' }]);
  assert.deepEqual(r.painted[1], [{ id: 'new' }]);
  assert.ok(r.order.includes('cacheGet:listActivities'), '一定要真的去讀 listActivities 的快取');
});

test('活動列表：沒有快取 → 只畫一次，且中間顯示載入中', async () => {
  const r = await runLoadActs({ cachedRows: null, netRows: [{ id: 'new' }] });
  assert.equal(r.painted.length, 1);
  assert.deepEqual(r.painted[0], [{ id: 'new' }]);
});

test('活動列表：重抓要走 queueRead，並把結果存回快取', async () => {
  const r = await runLoadActs({ cachedRows: null, netRows: [{ id: 'a' }] });
  assert.ok(r.order.indexOf('queueRead') >= 0, '裸 jsonp 會與第二發批次並行，違反同頁單一 /exec');
  assert.ok(r.order.indexOf('queueRead') < r.order.indexOf('jsonp'), 'jsonp 必須在佇列之內');
  assert.ok(r.order.includes('cacheSave:listActivities'), '不存回去的話下次開頁還是白等');
});

// ── ② 報到碼通知：磁碟快取要在「等第二發」之前就畫出來 ────────────────────
function runBundle({ tpl, previewCached, secondDone, previewSlice }) {
  BC.__resetForTest();
  const doc = fakeDoc(['bc-tpl', 'st-list', 'bc-msg']);
  const rendered = [];
  let waited = false;
  const ctx = {
    console, Promise, String, JSON, document: doc,
    CACHE_READY: Promise.resolve(),
    cacheGet: (name) => {
      if (name === BC.N.preview('A')) return previewCached ? { value: previewCached } : null;
      return null;
    },
    N: BC.N,
    planCheckinBundle: BC.planCheckinBundle,     // 真貨
    isRevoked: () => false,
    LAST_VERDICT: 'ok',
    SECOND_DONE: secondDone,
    SECOND: new Promise(() => {}),               // 永遠不 resolve：模擬第二發還在飛
    _previewSlice: previewSlice || null,
    _previewActId: previewSlice ? 'A' : '',
    _previewUsed: false,
    renderStations: () => {},
    renderPreview: (r) => { rendered.push(r); },
    queueRead: BC.queueRead,
    q: () => 'tok',
    jsonp: () => new Promise(() => {}),
    setMsg: () => {},
    cacheVerdict: BC.cacheVerdict,
    persistBatchSlices: BC.persistBatchSlices,
    nameOfSlice: BC.nameOfSlice,
  };
  vm.createContext(ctx);
  vm.runInContext(grab('loadCheckinBundle'), ctx, { filename: 'stats.html-loadCheckinBundle' });
  ctx.loadCheckinBundle('A', tpl);
  // 讓 CACHE_READY.then 那一圈跑完；SECOND 永不 resolve，所以之後不會再有動作。
  return new Promise((res) => setTimeout(res, 10)).then(() => ({ rendered, waited }));
}

test('報到碼通知：第二發還在飛、但磁碟有快取 → 立刻畫出來，不必等', async () => {
  // 這就是使用者回報的症狀的反面：改動前這裡是 0，整塊要等兩趟 GAS 才出現。
  const r = await runBundle({ tpl: '', previewCached: { ok: true, willSend: 137 }, secondDone: false });
  assert.equal(r.rendered.length, 1, '磁碟快取必須在 plan.wait 早退之前就畫');
  assert.equal(r.rendered[0].willSend, 137);
});

test('報到碼通知：沒有快取 → 維持原行為（等第二發，畫面先空著）', async () => {
  const r = await runBundle({ tpl: '', previewCached: null, secondDone: false });
  assert.equal(r.rendered.length, 0);
});

test('報到碼通知：使用者正在改草稿（tpl 非空）→ 不得用快取覆寫他的畫面', async () => {
  const r = await runBundle({ tpl: '改到一半的範本', previewCached: { ok: true, willSend: 137 }, secondDone: false });
  assert.equal(r.rendered.length, 0, '帶 tpl 的呼叫一律即時查詢，不碰快取');
});

test('報到碼通知：本次開頁的第二發切片優先於磁碟（它比較新）', async () => {
  const r = await runBundle({
    tpl: '', previewCached: { ok: true, willSend: 1 }, secondDone: true,
    previewSlice: { ok: true, willSend: 999 },
  });
  assert.equal(r.rendered[0].willSend, 999);
});

// ── ③ 重繪保留：沒動過要更新，動過要保留 ─────────────────────────────────
function runRenderPreview({ dirty, existingValue, template }) {
  const doc = fakeDoc(['bc-tpl', 'bc-edit', 'bc-preview', 'bc-send', 'bc-mirror', 'bc-phs', 'bc-msg']);
  doc.els['bc-tpl'].value = existingValue;
  const ctx = {
    console, String, document: doc,
    BC: null, BC_DEFAULT_TPL: '',
    watchDirty: () => {},
    isDirty: (id) => (id === 'bc-tpl' ? dirty : false),
    renderPhs: () => {}, paintMirror: () => {}, bcRenderSched: () => {},
    bcFillOne: () => {}, setMsg: () => {}, esc: (s) => String(s),
  };
  vm.createContext(ctx);
  vm.runInContext(grab('renderPreview'), ctx, { filename: 'stats.html-renderPreview' });
  ctx.renderPreview({ ok: true, template, defaultTemplate: template, published: true,
    willSend: 1, unbound: [], sample: 'x', tplHasUrl: true, people: [] });
  return doc.els['bc-tpl'].value;
}

test('重繪保留：使用者沒動過 → 第二段繪製用伺服器的新範本覆寫', () => {
  // 舊護欄 `if(!tplEl.value)` 會讓這一格停在快取那份舊範本，永遠不更新、且零徵兆。
  assert.equal(runRenderPreview({ dirty: false, existingValue: '七天前那份', template: '伺服器上的新版' }),
    '伺服器上的新版');
});

test('重繪保留：使用者打過字 → 保留他的內容，不被第二段繪製抹掉', () => {
  // 2026-08-20 資深通知誤發事故的同一種形狀（勾選被重繪蓋回去）。
  assert.equal(runRenderPreview({ dirty: true, existingValue: '我正在改的內容', template: '伺服器上的新版' }),
    '我正在改的內容');
});

// ── ④ bcInvalidate：五個異動點共用的失效入口 ─────────────────────────────
// 這一條驗的不只是邏輯，還有**它依賴的三個名字在瀏覽器裡真的存在**。
// board-cache.js 是傳統 script，頂層 function 才會變成全域；
// 只在 Node 用 require 測的話，「忘了加進 module.exports」與「瀏覽器裡是 undefined」
// 兩種錯都看不出來。所以這裡照瀏覽器的方式跑：同一個 context，先載模組再載函式。
test('bcInvalidate：cacheDrop／N.preview／clearDirty 在頁面的作用域裡真的取得到', async () => {
  const store = (() => {
    const m = new Map();
    return { get length() { return m.size; }, key: (i) => Array.from(m.keys())[i],
             getItem: (k) => (m.has(k) ? m.get(k) : null),
             setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  })();
  const ctx = {
    console, Promise, String, JSON, Date, Math, Map, Set, Uint8Array, Object,
    TextEncoder, TextDecoder, crypto: require('node:crypto').webcrypto,
    localStorage: store,
    document: { getElementById: () => ({ value: 'A', style: {}, addEventListener() {} }) },
  };
  vm.createContext(ctx);
  // ① 先跑模組本體（＝瀏覽器的 <script src="assets/board-cache.js">）
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'board-cache.js'), 'utf8'),
    ctx, { filename: 'board-cache.js' });
  // ② 再跑頁面裡那一段（＝inline script）
  vm.runInContext('var _previewUsed=false;\nvar q=function(){return "tok";};\n'
    + 'var ckActId=function(){return "A";};\n' + grab('bcInvalidate'),
    ctx, { filename: 'stats.html-bcInvalidate' });

  await vm.runInContext('cacheSave("tok", N.preview("A"), {ok:true, willSend:137})', ctx);
  assert.ok(vm.runInContext('cacheGet(N.preview("A"))', ctx), '前置：快取要先存得進去');

  await ctx.bcInvalidate();

  assert.equal(vm.runInContext('cacheGet(N.preview("A"))', ctx), null, '失效後不該再讀得到');
  assert.equal(ctx._previewUsed, true, '記憶體那份切片也要標成用過');
  assert.equal(vm.runInContext('isDirty("bc-tpl")', ctx), false);
});
