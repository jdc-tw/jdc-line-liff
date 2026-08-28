const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 通行證飛行紀錄的「接線」測試（2026-08-21）。
 *
 * 為何存在：8/21 實機實測證明 localStorage 沒被清（`?diag=1` 面板六輪紀錄都在、
 * 跨度 87 秒），而 LIFF 握手只花 247–413ms——兩個原本的假設都被排除。但當時
 * **紀錄停在「③ getProfile OK」**：startPass 從頭到尾一行 lg() 都沒有，於是
 * 「慢在快取沒命中／慢在 GAS／慢在畫 QR」看不出來。這幾行就是補那一段。
 *
 * 而它的價值全在「快取命中那條路真的沒去打 GAS，且有留下紀錄」——
 * 那是控制流，純函式測不到。手法：從 index.html 抽 startPass 原始碼配 stub 跑。
 */
function extractFn(name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = src.match(new RegExp('^    function ' + name + '\\([\\s\\S]*?^    }', 'm'));
  assert.ok(m, `index.html 裡找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

const { passCacheKey, passCacheUsable, passCacheMissReason, passToday } = require('../assets/pass-cache.js');

const RES = { ok: true, published: true, code: 'CHK|midyear2026|A001|sig', name: '洪炫佑', table: '21',
              actId: 'midyear2026', activity: { name: '2026 年中聚餐' } };

/** @param {{cache?:object, urlV?:string, gas?:object}} opt */
function run(opt) {
  opt = opt || {};
  const log = [], gasCalls = [], writes = [], clears = [];
  // 2026-08-28 起 startPass 會裝一支保險絲並在各出口呼叫 passDone_。
  // setTimeout 用**假的**（只記不跑）：真的排一支 10 秒計時器會讓 node --test 空等，
  // 而且 passDone_ 被 stub 掉之後真正的 clearTimeout 也不會執行。
  const doneCalls = [], timers = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, textContent: '', innerHTML: '', appendChild() {} });
  const ctx = {
    console, passCacheKey, passCacheUsable, passCacheMissReason, passToday,
    lg: (m) => log.push(m),
    document: { getElementById: el },
    show: () => {},
    passDone_: () => doneCalls.push(1),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    showMsg: () => {},
    escHtml: (s) => s,
    getAct: () => (opt.act || ''),
    getParam: () => (opt.urlV || ''),
    passCacheRead: () => (Object.prototype.hasOwnProperty.call(opt, 'cache') ? opt.cache : null),
    passCacheWrite: (u, a, v) => writes.push({ u, a, v }),
    passCacheClear: (u, a) => clears.push({ u, a }),
    renderPass: () => {},
    loadLottery: () => {},
    jsonp: (action, params) => {
      gasCalls.push({ action, params });
      return opt.gas === undefined
        ? Promise.resolve(RES)
        : (opt.gas instanceof Error ? Promise.reject(opt.gas) : Promise.resolve(opt.gas));
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('startPass'), ctx);
  ctx.startPass('U73069bf');
  return { log, gasCalls, writes, clears, doneCalls, timers };
}

test('★快取命中：一次 GAS 都不打，而且紀錄留得下來', async () => {
  const { log, gasCalls } = run({ cache: { v: '', res: RES } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(gasCalls.length, 0, '命中還打 GAS＝快取形同虛設');
  assert.deepStrictEqual(log, ['⑤ pass 快取命中 → 0 次 GAS'],
    '沒有這行，?diag=1 就分不出「命中所以快」還是「根本沒走到」');
});

test('沒有快取：紀錄要寫出原因，並打 GAS', async () => {
  const { log, gasCalls } = run({ cache: null });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(gasCalls.length, 1);
  assert.strictEqual(gasCalls[0].action, 'getEventCheckinPass');
  assert.strictEqual(log[0], '⑤ pass 快取未命中（無快取）→ 打 GAS');
  assert.strictEqual(log[1], '⑥ getEventCheckinPass 回 ok=true published=true');
});

test('存到的是未發佈那份：原因要說得出是這一種（三種原因修法不同）', async () => {
  const { log } = run({ cache: { v: '', res: { published: false } } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(log[0], '⑤ pass 快取未命中（存的是未發佈那份）→ 打 GAS');
});

test('桌次動過（v 不同）：原因要指出是 v', async () => {
  const { log } = run({ cache: { v: '21', res: RES }, urlV: '25' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(log[0], '⑤ pass 快取未命中（v 不同(桌次動過)）→ 打 GAS');
});

test('GAS 掛掉：catch 也要留紀錄，否則畫面報錯而紀錄一片空白', async () => {
  const { log } = run({ cache: null, gas: new Error('timeout') });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(log[1], '⑥ getEventCheckinPass catch: timeout');
});

test('passCacheMissReason 與 passCacheUsable 不得分歧（自我對照）', () => {
  const cases = [null, { v: '', res: RES }, { v: '21', res: RES }, { v: '', res: { published: false } }, { res: null }];
  for (const rec of cases) {
    for (const urlV of ['', '21', '25']) {
      if (passCacheUsable(rec, urlV)) continue;
      assert.notStrictEqual(passCacheMissReason(rec, urlV), '（其實可用）',
        `兩支判斷分歧：rec=${JSON.stringify(rec)} urlV=${urlV}`);
    }
  }
});

test('對照組：把命中那行 lg 拿掉，★那條必須翻紅', () => {
  const mutated = extractFn('startPass').replace(/lg\('⑤ pass 快取命中 → 0 次 GAS'\);/, '');
  assert.ok(!mutated.includes('⑤ pass 快取命中'), '突變沒注入成功——先確認真的改到字了');
  const log = [];
  const els = {};
  const ctx = {
    console, passCacheKey, passCacheUsable, passCacheMissReason, passToday,
    lg: (m) => log.push(m),
    document: { getElementById: (id) => (els[id] = els[id] || { style: {}, textContent: '', innerHTML: '' }) },
    show: () => {}, showMsg: () => {}, escHtml: (s) => s,
    getAct: () => '', getParam: () => '',
    passCacheRead: () => ({ v: '', res: RES }),
    passCacheWrite: () => {}, passCacheClear: () => {},
    renderPass: () => {}, loadLottery: () => {},
    jsonp: () => Promise.resolve(RES),
    passDone_: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(mutated, ctx);
  ctx.startPass('U73069bf');
  assert.deepStrictEqual(log, [],
    '拿掉那行後紀錄是空的 ⇒ ★那條斷言確實抓得到「儀器又變回盲的」');
});

/* ═══════════ 兩個入口共用同一份快取（2026-08-22）═══════════
 * 通知連結帶 `&act=`、圖文選單不帶 ⇒ 快取鍵不同。8/27 中午暖機、8/28 按圖文選單
 * 報到的計畫，成敗全在這幾條。
 */

test('★真實情境：act=midyear2026 進來，auto 鍵也要被寫', async () => {
  const { writes } = run({ cache: null, urlV: '21', act: 'midyear2026',
    gas: { ...RES, published: true, isDefaultAct: true } });
  await new Promise((r) => setImmediate(r));
  const keys = writes.map((w) => w.a);
  assert.ok(keys.includes('midyear2026'), '連結自己那把鍵要寫');
  assert.ok(keys.includes(''), 'auto 鍵沒寫 ⇒ 8/27 暖的機，8/28 按圖文選單一次都不命中');
  assert.strictEqual(writes.length, 2);
});

test('不是預設場次：只寫自己那把，不得污染 auto（別場桌號比慢更糟）', async () => {
  const { writes } = run({ cache: null, act: 'yearend2026',
    gas: { ...RES, published: true, isDefaultAct: false } });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(writes.map((w) => w.a), ['yearend2026']);
});

test('圖文選單進來（act 空）：只有一把鍵，不重複寫', async () => {
  const { writes } = run({ cache: null, gas: { ...RES, published: true, isDefaultAct: true } });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(writes.map((w) => w.a), ['']);
});

test('取消發佈：兩把鍵都要清，否則圖文選單那把還留著舊 QR', async () => {
  const { writes, clears } = run({ cache: null, act: 'midyear2026',
    gas: { ...RES, published: false, isDefaultAct: true } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(writes.length, 0, '未發佈不留快取');
  assert.deepStrictEqual(clears.map((c) => c.a), ['midyear2026', '']);
});

test('對照組：把「多寫 auto 鍵」那行拿掉，★那條必須翻紅', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = src.match(/^    function startPass\([\s\S]*?^    }/m);
  const mutated = m[0].replace(/\n\s*if \(act && res\.isDefaultAct\) passCacheWrite\(userId, '', urlV, res\);/, '');
  assert.notStrictEqual(mutated, m[0], '突變沒注入成功——先確認真的改到字了');
  assert.ok(!mutated.includes("passCacheWrite(userId, '', urlV, res)"));
});

test('★過期的快取：startPass 必須真的把今天傳進去（漏傳會靜默關掉整個到期判斷）', async () => {
  const stale = { v: '', res: { ...RES, activity: { name: '2020 尾牙', eventDate: '2020/01/10' } } };
  const { log, gasCalls } = run({ cache: stale, gas: { ...RES, isDefaultAct: true } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(gasCalls.length, 1,
    '過期快取仍被當成命中 ⇒ startPass 沒把 today 傳給 passCacheUsable');
  assert.strictEqual(log[0], '⑤ pass 快取未命中（活動已過去）→ 打 GAS');
});

test('對照組：把 today 從呼叫裡拿掉，★那條必須翻紅', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = src.match(/^    function startPass\([\s\S]*?^    }/m);
  const mutated = m[0].replace('passCacheUsable(cached, urlV, today)', 'passCacheUsable(cached, urlV)');
  assert.notStrictEqual(mutated, m[0], '突變沒注入成功——先確認真的改到字了');
  const stale = { v: '', res: { ...RES, activity: { name: '2020 尾牙', eventDate: '2020/01/10' } } };
  const gasCalls = [];
  const els = {};
  const ctx = {
    console, passCacheKey, passCacheUsable, passCacheMissReason, passToday,
    lg: () => {},
    document: { getElementById: (id) => (els[id] = els[id] || { style: {}, textContent: '', innerHTML: '' }) },
    show: () => {}, showMsg: () => {}, escHtml: (s) => s,
    getAct: () => '', getParam: () => '',
    passCacheRead: () => stale,
    passCacheWrite: () => {}, passCacheClear: () => {},
    renderPass: () => {}, loadLottery: () => {},
    jsonp: () => { gasCalls.push(1); return Promise.resolve(RES); },
    passDone_: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(mutated, ctx);
  ctx.startPass('U73069bf');
  assert.strictEqual(gasCalls.length, 0,
    '漏傳 today 之後過期快取又被當成命中 ⇒ ★那條斷言確實抓得到');
});

