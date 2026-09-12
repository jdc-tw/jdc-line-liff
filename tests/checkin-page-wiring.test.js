const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/source-scan.js');

/**
 * `checkin.html`（活動報到看板）的**前端接線**測試（2026-09-12，E1b 前置）。
 *
 * ══ 為何存在 ═══════════════════════════════════════════════════════════
 * 同一天在 `jdc-line-gas` 補了 12 條 `getEventCheckinStats` 的**後端** wiring 測試。
 * 那一輪自己標了最大的缺口仍然開著：**前端一條都沒釘**。
 * 實測到的定義域：`tests/` 裡讀 `board.html` 的測試有 11 支，
 * 讀 `checkin.html` 的是 **0 支**；而 `tests/page-load.test.js` 的頁面清單當時是
 * 手寫九頁、不含這一頁 ⇒ 連「頂層 JS 有沒有拋錯」都沒有人在看。
 *
 * ⚠️ `checkin` 在這套系統裡是**兩件不同的事**：
 *   `checkin.js`＝新人報到（人事流程）／`event-checkin.js`＝活動報到看板（掃碼）。
 *   本檔釘的是**後者的前端頁面** `checkin.html`。
 *
 * ══ 這支釘的是「現況」不是「應該」═════════════════════════════════════
 * characterization test：把今天真的會發生的行為寫下來。發現的缺陷**只報不改**。
 *
 * ══ 手法與既有 harness 的關係 ═══════════════════════════════════════════
 * 沿用 `tests/helpers/source-scan.js`（前端抽原始碼的唯一一支）取內嵌 script，
 * 再用 `board-cache-wiring.test.js` 的做法：配最小替身在 vm 裡跑。
 * 相依給**真貨**——`renderBoardHtml` 直接跑 `assets/checkin-board.js`，
 * 給假的就等於沒驗到接線。
 *
 * 🔴 **零外送**：context 裡只有 `fetch` 替身，`XMLHttpRequest`／`sendBeacon`／`navigator`
 *    一律不給（不是給假的，是**不存在**）⇒ 任何第二條出口都會當場 ReferenceError。
 *    這一點由「零外送」那一支測試本身釘住。
 *
 * ⚠️ 上限：DOM 是假的、CSS 不存在、瀏覽器差異驗不到。這支證明不了畫面長得對，
 *    只證明「這幾條路徑會走到哪裡、寫了什麼進去」。
 */

const ROOT = path.join(__dirname, '..');
const INLINE = S.scriptText('checkin.html');
const BOARD_JS = fs.readFileSync(path.join(ROOT, 'assets', 'checkin-board.js'), 'utf8');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'checkin.html'), 'utf8');

// 抽取本身是近似（見 source-scan.js 檔頭：**少取跟「這頁沒有」一模一樣**）。
// 先把它釘住，否則下面每一支都可能在跑空字串而全綠。
//
// ⚠️ 這裡**不可以**用「原始碼裡有沒有 `function xxx` 這串字」來驗——
//    (1) 子字串比對分不出宣告與註解；
//    (2) `tests/source-scan-tripwire.test.js` 會把「字串字面量裡含 `function `」
//        判定成手寫抽取式而打紅（實測踩到：只跑自己那一檔是綠的，全庫才紅）。
//    改用 helper 的引擎剖析拿函式名單——規格保證逐字，而且順便驗了 hoisting。
test('⬛ 零點：內嵌 script 真的抽到了——抽空的話下面每一支都會變成裝飾品', () => {
  assert.ok(INLINE.length > 500, `只抽到 ${INLINE.length} 個字元`);
  const names = S.fnNames('checkin.html');
  for (const must of ['jget', 'load', 'paintError', 'paintStats', 'swrGet', 'swrSet', 'q', 'esc']) {
    assert.ok(names.includes(must), `checkin.html 的頂層函式裡找不到 ${must}——抽取壞了或改名了。現有：${names.join(', ')}`);
  }
  for (const must of ['getEventCheckinStats', 'setInterval', 'sessionStorage']) {
    assert.ok(INLINE.includes(must), `抽出來的內嵌 script 裡找不到 \`${must}\`——抽取壞了`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 替身
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 把 `assets/checkin-board.js` ＋ `checkin.html` 的內嵌 script 依序跑進一個 vm。
 *
 * 計時器是**虛擬**的：`advance(ms)` 才會走。用真計時器的話
 * (1) 15 秒輪詢會讓事件迴圈永遠不空（`page-load.test.js` 踩過這個），
 * (2) 逾時路徑得真的等 15 秒。
 */
function boot(opts) {
  opts = opts || {};
  const writes = [];        // 每一次寫進 DOM 的動作（含 id / 屬性 / 值）
  const listeners = [];     // addEventListener 註冊
  const intervals = [];     // setInterval 註冊（只記錄，不自己跑）
  const pendingTimeouts = new Map();
  const fetchCalls = [];
  let nextId = 1;
  let clock = 0;

  function mkEl(id) {
    const el = { id, addEventListener(type, fn) { listeners.push({ id, type, fn }); } };
    for (const prop of ['innerHTML', 'textContent']) {
      let v = '';
      Object.defineProperty(el, prop, {
        get() { return v; },
        set(nv) { v = String(nv); writes.push({ id, prop, value: v }); },
      });
    }
    return el;
  }
  const els = { meta: mkEl('meta'), content: mkEl('content'), updated: mkEl('updated'), refresh: mkEl('refresh') };
  const askedFor = [];
  // 不認得的 id 回 null（不是回一個萬用假元素）——頁面改了 id 就會當場 TypeError，
  // 而不是安靜地寫進一個沒人看的物件裡。
  const document = { getElementById(id) { askedFor.push(id); return els[id] || null; } };

  const store = Object.assign({}, opts.cache || {});
  const sessionStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };

  const neverResolves = () => new Promise(() => {});
  const fetchStub = (url, init) => {
    fetchCalls.push({ url: String(url), init: init });
    return (opts.fetchImpl || neverResolves)(String(url), init);
  };

  const ctx = {
    console,
    document,
    sessionStorage,
    location: { search: opts.search === undefined ? '' : opts.search },
    fetch: fetchStub,
    setTimeout(fn, ms) { const id = nextId++; pendingTimeouts.set(id, { fn, at: clock + (ms || 0), ms: ms || 0 }); return id; },
    clearTimeout(id) { pendingTimeouts.delete(id); },
    setInterval(fn, ms) { const id = nextId++; intervals.push({ id, fn, ms }); return id; },
    clearInterval(id) { for (let i = 0; i < intervals.length; i++) if (intervals[i].id === id) intervals.splice(i, 1); },
  };
  vm.createContext(ctx);
  vm.runInContext(BOARD_JS, ctx, { filename: 'assets/checkin-board.js' });
  vm.runInContext(opts.code === undefined ? INLINE : opts.code, ctx, { filename: 'checkin.html inline' });

  const h = {
    ctx, els, writes, listeners, intervals, fetchCalls, store, askedFor,
    get fetchCount() { return fetchCalls.length; },
    /** 只看 #content 的 innerHTML——那就是「畫了一次」。 */
    paints() { return writes.filter((w) => w.id === 'content' && w.prop === 'innerHTML'); },
    /** 走虛擬時鐘，回傳被觸發的計時器數。 */
    advance(ms) {
      clock += ms;
      let fired = 0;
      for (const [id, t] of Array.from(pendingTimeouts.entries())) {
        if (t.at <= clock) { pendingTimeouts.delete(id); t.fn(); fired++; }
      }
      return fired;
    },
    timeoutDelays() { return Array.from(pendingTimeouts.values()).map((t) => t.ms); },
    fire(id, type) { listeners.filter((l) => l.id === id && l.type === type).forEach((l) => l.fn()); },
    tick() { intervals.forEach((iv) => iv.fn()); },
  };
  return h;
}

/** 讓 promise 鏈跑完（jget 有 fetch→text→parse→then/catch 好幾跳）。 */
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

const jsonp = (obj) => () => Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(obj) + ');') });
const rawText = (s) => () => Promise.resolve({ text: () => Promise.resolve(s) });

const STATS_A = { total: 9, arrived: 5, walkins: 0, notArrived: 4, byUnit: { 工務: { arrived: 2, total: 4 } }, byStation: { S1: 5 }, notArrivedList: [{ name: '甲', unit: '工務' }] };
const STATS_B = { total: 9, arrived: 7, walkins: 1, notArrived: 2, byUnit: { 工務: { arrived: 4, total: 4 } }, byStation: { S1: 7 }, notArrivedList: [{ name: '乙', unit: '總務' }] };
const SEARCH = '?t=TOKEN123&act=A1';

/* ══════════════════════════════════════════════════════════════════════
 * 量法先驗過再用
 * ════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：頁面那段程式碼沒跑的話，所有計數都是 0——證明下面的斷言分得開', () => {
  // 「那段程式碼根本沒被執行到」也會通過的假通過情境長這樣：斷言 `paints.length >= 0`、
  // 斷言「沒有錯誤」、斷言 innerHTML 不含某個字串。以下三個計數在頁面沒跑時**全是 0**，
  // 所以下面那些要求 >0 的斷言確實在量東西。
  const blank = boot({ code: '', search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  assert.equal(blank.paints().length, 0, '沒跑頁面卻畫了東西 ⇒ 是替身自己畫的，整支測試作廢');
  assert.equal(blank.fetchCount, 0, '沒跑頁面卻送了請求 ⇒ 同上');
  assert.equal(blank.listeners.length, 0);
  assert.equal(blank.intervals.length, 0);

  // 同一組計數，跑真的頁面 ⇒ 全部非 0。差異只來自「有沒有跑那段程式碼」。
  const real = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  assert.ok(real.fetchCount > 0, '計數器量不到非 0 的話，「零外送」那條就是永遠的綠燈');
  assert.ok(real.listeners.length > 0);
  assert.ok(real.intervals.length > 0);
});

test('🔴 零外送：context 裡除了 fetch 替身沒有第二條出口，且送出的都經過計數器', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  // 替身身分：頁面拿到的就是我這一支
  assert.equal(typeof h.ctx.fetch, 'function');
  // 第二條出口一律不存在（給假的會讓「沒用到」與「用了但我沒看」長得一樣）
  for (const way of ['XMLHttpRequest', 'navigator', 'WebSocket', 'EventSource', 'importScripts']) {
    assert.equal(h.ctx[way], undefined, `context 裡不該有 ${way}——有的話就有一條我沒在計數的出口`);
  }
  assert.equal(h.fetchCount, 1, '這一輪只該有一次請求，而且它被計數器攔下來了');
  assert.ok(h.fetchCalls[0].url.startsWith('https://script.google.com/macros/s/'),
    '請求的去向：' + h.fetchCalls[0].url);
});

/* ══════════════════════════════════════════════════════════════════════
 * ① 缺參數：init 的早退
 * ════════════════════════════════════════════════════════════════════ */

test('缺參數：畫錯誤訊息、一則請求都不送', async () => {
  const h = boot({ search: '', fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  assert.equal(h.fetchCount, 0, '缺參數還去打 GAS ⇒ 一路打 token=\'\'&act=\'\'');
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('連結缺少參數'), h.paints()[0].value);
  assert.equal(h.els.meta.textContent, '', 'paintError 會把 meta 清空');
});

test('缺參數：輪詢與手動刷新也都不送（load() 自己有早退，不是只靠 init）', async () => {
  const h = boot({ search: '?t=ONLY_TOKEN', fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  assert.equal(h.fetchCount, 0);
  h.tick();                 // 15 秒到了
  h.fire('refresh', 'click');   // 使用者按了刷新
  await flush();
  assert.equal(h.fetchCount, 0, 'load() 的早退不見了 ⇒ 每 15 秒打一發空參數請求');
});

/* ══════════════════════════════════════════════════════════════════════
 * ② 請求形狀（只有一支 action）
 * ════════════════════════════════════════════════════════════════════ */

test('請求形狀：只打 getEventCheckinStats 一支 action，帶 token／act／callback=cb、credentials 匿名', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  const call = h.fetchCalls[0];
  assert.ok(call.url.includes('action=getEventCheckinStats'), call.url);
  assert.ok(call.url.includes('&token=TOKEN123'), call.url);
  assert.ok(call.url.includes('&act=A1'), call.url);
  assert.ok(call.url.includes('&callback=cb'), 'GAS 回的是 JSONP，少了 callback 就 parse 不出來');
  // 匿名帶 session：半殘 Google 登入態的電腦會被擋（頁面註解寫的是刻意的，這裡釘住）
  assert.equal(call.init && call.init.credentials, 'omit');
  assert.equal(call.init && call.init.redirect, 'follow');

  // 全頁的 action 清單（定義域小到列得完就直接全列）
  const actions = (INLINE.match(/jget\('([^']+)'/g) || []).map((s) => s.slice(6, -1));
  assert.deepEqual(actions, ['getEventCheckinStats'], '這一頁多打了別支 action：' + actions.join(', '));
});

/* ══════════════════════════════════════════════════════════════════════
 * ③ SWR：先畫快取、網路回來再覆蓋
 * ════════════════════════════════════════════════════════════════════ */

test('SWR：有快取 → 網路還沒回來就先畫一次，回來後再畫第二次', async () => {
  let resolveFetch;
  const h = boot({
    search: SEARCH,
    cache: { 'swr:checkin:A1': JSON.stringify(STATS_A) },
    fetchImpl: () => new Promise((r) => { resolveFetch = r; }),
  });
  // 第一段：完全同步，不等網路
  assert.equal(h.paints().length, 1, '有快取卻沒有秒顯 ⇒ SWR 沒接上');
  assert.ok(h.paints()[0].value.includes('已到 5 / 9'), h.paints()[0].value);
  assert.equal(h.fetchCount, 1, '畫了快取就不重抓的話，畫面會一直是舊的');

  // 第二段：網路回來覆蓋
  resolveFetch({ text: () => Promise.resolve('cb(' + JSON.stringify({ ok: true, stats: STATS_B }) + ')') });
  await flush();
  assert.equal(h.paints().length, 2, '網路回來沒有第二段繪製 ⇒ 校正不會發生');
  assert.ok(h.paints()[1].value.includes('已到 7 / 9'), h.paints()[1].value);
  assert.ok(h.paints()[1].value.includes('臨時 1'));
});

test('SWR：沒有快取 → 只畫一次（網路回來那一次）', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_B }) });
  assert.equal(h.paints().length, 0, '沒有快取卻畫了東西 ⇒ 畫的是憑空生出來的資料');
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('已到 7 / 9'));
  assert.equal(h.els.meta.textContent, '活動 A1');
  assert.ok(h.els.updated.textContent.startsWith('最後更新：'), h.els.updated.textContent);
});

test('SWR：成功的結果寫回 sessionStorage，鍵名依活動分開（不同活動不會互相汙染）', async () => {
  const h1 = boot({ search: '?t=T&act=A1', fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  assert.deepEqual(JSON.parse(h1.store['swr:checkin:A1']), STATS_A);
  assert.equal(Object.keys(h1.store).length, 1, '寫了別的鍵：' + Object.keys(h1.store).join(', '));

  const h2 = boot({ search: '?t=T&act=B2', fetchImpl: jsonp({ ok: true, stats: STATS_B }) });
  await flush();
  assert.ok(Object.prototype.hasOwnProperty.call(h2.store, 'swr:checkin:B2'),
    '鍵名沒帶活動 id ⇒ 換一場活動會先秒顯上一場的數字');
});

test('SWR：重抓失敗但有舊快取 → 畫面不動，錯誤訊息不蓋掉上一次成功結果', async () => {
  const h = boot({
    search: SEARCH,
    cache: { 'swr:checkin:A1': JSON.stringify(STATS_A) },
    fetchImpl: jsonp({ ok: false, msg: '伺服器忙碌' }),
  });
  await flush();
  assert.equal(h.paints().length, 1, '失敗把舊畫面蓋掉了 ⇒ 現場會突然一片空白');
  assert.ok(h.paints()[0].value.includes('已到 5 / 9'));
  assert.ok(!h.els.content.innerHTML.includes('伺服器忙碌'));
});

test('SWR：壞掉的快取（不是合法 JSON）→ 當成沒有快取，不讓整頁掛掉', async () => {
  const h = boot({ search: SEARCH, cache: { 'swr:checkin:A1': '{壞掉的' }, fetchImpl: jsonp({ ok: true, stats: STATS_B }) });
  assert.equal(h.paints().length, 0);
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('已到 7 / 9'));
});

/* ══════════════════════════════════════════════════════════════════════
 * ④ paintError 的分支
 * ════════════════════════════════════════════════════════════════════ */

test('paintError：後端回 ok:false 且沒有快取 → 顯示後端的 msg（並逸出 HTML）', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: false, msg: '連結已被<撤銷>' }) });
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('連結已被&lt;撤銷&gt;'), h.paints()[0].value);
  assert.ok(!h.paints()[0].value.includes('<撤銷>'), '後端字串沒逸出就直接進 innerHTML');
});

test('paintError：後端回 ok:false 但沒給 msg → 用預設的「連結無效或已失效」', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: false }) });
  await flush();
  assert.ok(h.paints()[0].value.includes('連結無效或已失效'), h.paints()[0].value);
});

/* ══════════════════════════════════════════════════════════════════════
 * ⑤ jget 的逾時與壞回應
 * ════════════════════════════════════════════════════════════════════ */

test('jget 逾時：預設 15 秒，逾時前不動畫面、逾時後顯示「連線逾時」', async () => {
  const h = boot({ search: SEARCH });   // fetch 永不 resolve
  await flush();
  assert.deepEqual(h.timeoutDelays(), [15000], '逾時長度不是 15000：' + h.timeoutDelays().join(','));

  assert.equal(h.advance(14999), 0);
  await flush();
  assert.equal(h.paints().length, 0, '還沒到 15 秒就放棄了');

  assert.equal(h.advance(1), 1);
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('連線逾時'), h.paints()[0].value);
  assert.ok(h.paints()[0].value.includes('伺服器喚醒中'), h.paints()[0].value);
});

test('jget 逾時：有快取時逾時不蓋畫面（逾時走的是與 ok:false 同一條匯流）', async () => {
  const h = boot({ search: SEARCH, cache: { 'swr:checkin:A1': JSON.stringify(STATS_A) } });
  assert.equal(h.paints().length, 1);
  h.advance(15000);
  await flush();
  assert.equal(h.paints().length, 1, '逾時把快取畫面蓋掉了');
  assert.ok(h.els.content.innerHTML.includes('已到 5 / 9'));
});

test('jget：回的不是 JSONP（沒有括號）→「連線失敗」，不是整頁拋錯', async () => {
  const h = boot({ search: SEARCH, fetchImpl: rawText('Moved Temporarily') });
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('連線失敗'), h.paints()[0].value);
});

test('jget：括號裡不是合法 JSON → 一樣是「連線失敗」', async () => {
  const h = boot({ search: SEARCH, fetchImpl: rawText('cb(這不是 JSON)') });
  await flush();
  assert.ok(h.paints()[0].value.includes('連線失敗'), h.paints()[0].value);
});

/**
 * 🔴 這一條是突變測試逼出來的（2026-09-12）。
 *
 * 第一版只用「`Moved Temporarily`」當壞回應，結果把
 * `if(a===-1||b===-1)throw new Error('bad');` 整行拿掉 **21 發突變裡唯一全綠的那一發**。
 * 原因：沒有括號時 `t.slice(-1+1, -1)` ＝ `t.slice(0,-1)`，那段還是不合法的 JSON
 * ⇒ `JSON.parse` 自己拋 ⇒ 走同一個 catch ⇒ **訊息一字不差**。
 * 也就是說，那個輸入對這一行**零鑑別力**，而我拿到的是一支綠燈。
 *
 * 分得開的輸入長這樣：**裸 JSON 加一個尾字元**。
 * `slice(0,-1)` 剛好把尾字元切掉、剩下合法 JSON ⇒ 少了那道守門就會被當成**成功回應**。
 */
test('jget：回的是裸 JSON（沒有 JSONP 包裝）→ 仍然算連線失敗，不會被當成成功資料', async () => {
  const h = boot({ search: SEARCH, fetchImpl: rawText(JSON.stringify({ ok: true, stats: STATS_B }) + '\n') });
  await flush();
  assert.equal(h.paints().length, 1);
  assert.ok(h.paints()[0].value.includes('連線失敗'),
    '沒有 JSONP 括號的回應被當成成功了：' + h.paints()[0].value);
  assert.ok(!h.paints()[0].value.includes('已到 7 / 9'));
  assert.equal(Object.keys(h.store).length, 0, '還把它寫進快取了 ⇒ 下次開頁會秒顯一份來路不明的數字');
});

test('jget：逾時的計時器在成功回應後要被清掉（否則每次刷新都留一顆 15 秒的計時器）', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  assert.deepEqual(h.timeoutDelays(), [15000]);
  await flush();
  assert.deepEqual(h.timeoutDelays(), [], '成功之後還留著逾時計時器');
});

/* ══════════════════════════════════════════════════════════════════════
 * ⑥ 15 秒輪詢與手動刷新
 * ════════════════════════════════════════════════════════════════════ */

test('輪詢：註冊一顆 15 秒的 setInterval，而且它跑的真的是 load（會再送一發）', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  assert.equal(h.intervals.length, 1, '輪詢註冊了 ' + h.intervals.length + ' 顆');
  assert.equal(h.intervals[0].ms, 15000, '輪詢間隔是 ' + h.intervals[0].ms);
  assert.equal(h.fetchCount, 1);
  h.tick();
  await flush();
  assert.equal(h.fetchCount, 2, '輪詢觸發後沒有再送 ⇒ setInterval 掛的不是 load');
  assert.equal(h.paints().length, 2, '輪詢回來要重畫');
});

test('立即刷新：#refresh 的 click 接上 load，按一次送一發', async () => {
  const h = boot({ search: SEARCH, fetchImpl: jsonp({ ok: true, stats: STATS_A }) });
  await flush();
  const clicks = h.listeners.filter((l) => l.id === 'refresh' && l.type === 'click');
  assert.equal(clicks.length, 1, '#refresh 沒有接上 click（頁面上那顆按鈕會變成裝飾品）');
  h.fire('refresh', 'click');
  await flush();
  assert.equal(h.fetchCount, 2);
});

/* ══════════════════════════════════════════════════════════════════════
 * ⑦ SWR 覆蓋範圍裡有沒有輸入欄位
 *
 * 為何釘這一條：2026-08-20 的誤發事故有一半成因是
 * 「先畫快取、網路回來再覆蓋」套在**含輸入欄位**的區塊上——第二段繪製
 * 靜默抹掉使用者剛取消的勾選，18 人被勾回去、19 人誤收。
 * `checkin.html` 今天的 SWR 覆蓋範圍（#content / #meta / #updated）**沒有**
 * 任何輸入欄位，所以那個形狀今天不成立。這一條把「今天是 0」釘住：
 * 日後有人往看板加輸入欄位，這裡會紅，並且該回頭重新評估 SWR。
 * ════════════════════════════════════════════════════════════════════ */

test('SWR 覆蓋範圍：整頁沒有任何輸入欄位（釘現況；日後加了要重新評估覆蓋繪製）', () => {
  const inputs = PAGE_HTML.match(/<(input|textarea|select)\b/gi) || [];
  assert.deepEqual(inputs, [], 'checkin.html 出現輸入欄位：' + inputs.join(', '));
  // 被覆蓋的那塊是 renderBoardHtml 的產出——它自己也不能長出輸入欄位
  const html = new vm.Script('renderBoardHtml(' + JSON.stringify(STATS_B) + ')');
  const ctx = vm.createContext({});
  vm.runInContext(BOARD_JS, ctx);
  const rendered = html.runInContext(ctx);
  assert.deepEqual(rendered.match(/<(input|textarea|select)\b/gi) || [], [], rendered);
  assert.ok(!/contenteditable/i.test(rendered));
  // ⬛ 零點：這個量法分得出「有」——拿一段真的含輸入欄位的字串跑同一條判準
  assert.deepEqual('<div><input id="x"></div>'.match(/<(input|textarea|select)\b/gi), ['<input'],
    '判準連明擺著的 <input> 都抓不到 ⇒ 上面三條全是裝飾品');
});

/* ══════════════════════════════════════════════════════════════════════
 * ⑧ 這一頁被哪些測試覆蓋（把「0 支」這個事實釘住，不讓它再回去）
 * ════════════════════════════════════════════════════════════════════ */

test('這一頁不再是測試的空白區：至少有一支測試會讀 checkin.html', () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js'));
  const hit = files.filter((f) => fs.readFileSync(path.join(__dirname, f), 'utf8').includes('checkin.html'));
  assert.ok(hit.length >= 1, '讀 checkin.html 的測試檔：' + hit.join(', '));
  assert.ok(hit.includes('checkin-page-wiring.test.js'));
});
