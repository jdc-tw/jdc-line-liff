const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 通行證「收場」的接線測試（2026-08-28）。
 *
 * 為何存在：使用者要求「QR 沒出現前，動畫不要結束」。做法是把關掉 #loading 從
 * startPass 進場搬到 QR 真的 appendChild 之後。
 *
 * ⚠️ 這個改動的危險不在它要做的事，在它**沒做到的地方**：startPass/renderPass 合起來
 *    有六條出口，其中四條**永遠不會出現 QR**——
 *      ② GAS 回失敗（查無員編）  ③ 網路錯誤  ④ 桌次未發佈（快取命中與打 GAS 兩條都走這裡）
 *    只把收場放在「QR 畫完」那條，那四條會**永遠停在轉圈**，而且連錯誤訊息都看不到
 *    （訊息畫在還沒顯示的 #main 裡）。那比原本「動畫太早結束」嚴重得多。
 *
 * 所以這支測的不是「成功那條有沒有收場」，是「**每一條**有沒有收場」。
 */
function extractFn(name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = src.match(new RegExp('^    function ' + name + '\\([\\s\\S]*?^    }', 'm'));
  assert.ok(m, `index.html 裡找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

const RES = { ok: true, published: true, code: 'CHK|midyear2026|A001|sig', name: '王瑩', table: '8',
              actId: 'midyear2026', activity: { name: '2026 年中聚餐' } };

/* ═══════════ startPass 的三條出口（②③ ＋ 保險絲）═══════════ */

function runStart(opt, mutate) {
  opt = opt || {};
  const events = [], timers = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, textContent: '', innerHTML: '', appendChild() {} });
  const ctx = {
    console,
    lg: () => {},
    document: { getElementById: el },
    show: () => {}, escHtml: (s) => s,
    showMsg: () => events.push('showMsg'),
    getAct: () => '', getParam: () => '',
    passCacheRead: () => (Object.prototype.hasOwnProperty.call(opt, 'cache') ? opt.cache : null),
    passCacheUsable: () => !!opt.cacheUsable,
    passCacheMissReason: () => '無快取',
    passToday: () => '2026/08/28',
    passCacheWrite: () => {}, passCacheClear: () => {},
    renderPass: () => events.push('renderPass'),
    loadLottery: () => {},
    passDone_: () => events.push('passDone_'),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    jsonp: () => (opt.gas instanceof Error ? Promise.reject(opt.gas) : Promise.resolve(opt.gas)),
  };
  let src = extractFn('startPass');
  if (mutate) { const out = mutate(src); assert.notStrictEqual(out, src, '突變沒注入成功——先確認真的改到字了'); src = out; }
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.startPass('U1ea95744');
  return { events, timers };
}

test('保險絲有裝，而且是 10 秒——任何沒列到的路徑最壞退回改動前的行為，不會卡死', () => {
  const { timers } = runStart({ gas: RES });
  assert.strictEqual(timers.length, 1, '沒有保險絲＝有一條路徑卡住就永遠卡住');
  assert.strictEqual(timers[0].ms, 10000);
});

test('★出口②　GAS 回失敗（例：查無員編）→ 必須收場，否則永遠轉圈', async () => {
  const { events } = runStart({ gas: { ok: false, msg: '查無您的員編，請先完成綁定' } });
  await new Promise((r) => setImmediate(r));
  assert.ok(events.includes('passDone_'), '這條永遠不會有 QR，不自己收場就是永遠轉圈');
});

test('★出口②　收場要排在 showMsg 之前——訊息畫在還沒顯示的 #main 裡等於沒顯示', async () => {
  const { events } = runStart({ gas: { ok: false, msg: 'x' } });
  await new Promise((r) => setImmediate(r));
  assert.ok(events.indexOf('passDone_') < events.indexOf('showMsg'),
    `順序錯了：${JSON.stringify(events)}——使用者會看到一片空白而不是錯誤訊息`);
});

test('★出口③　網路錯誤 → 必須收場', async () => {
  const { events } = runStart({ gas: new Error('timeout') });
  await new Promise((r) => setImmediate(r));
  assert.ok(events.includes('passDone_'));
  assert.ok(events.indexOf('passDone_') < events.indexOf('showMsg'));
});

test('對照組：把出口②的 passDone_ 拿掉，★那兩條必須翻紅', async () => {
  const { events } = runStart(
    { gas: { ok: false, msg: 'x' } },
    (s) => s.replace(/passDone_\(\);\s*\/\/ 出口②[^\n]*\n/, ''));
  await new Promise((r) => setImmediate(r));
  assert.ok(!events.includes('passDone_'),
    '拿掉之後仍然有人收場 ⇒ ★那兩條抓不到「這條路徑忘了收場」');
});

/* ═══════════ renderPass 的三條出口（①④⑤）═══════════ */

function runRender(res, opt, mutate) {
  opt = opt || {};
  const events = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    style: {}, textContent: '', innerHTML: '',
    appendChild() { events.push('appendChild'); },
  });
  const ctx = {
    console,
    lg: () => {},
    document: { getElementById: el },
    passDone_: () => events.push('passDone_'),
    qrBadgeReady: () => (opt.badgeFails ? Promise.reject(new Error('logo 拿不到')) : Promise.resolve()),
    qrBadgeCanvas: () => ({ style: {} }),
    qrcode: () => ({ addData() {}, make() {}, createImgTag: () => '<img>' }),
  };
  let src = extractFn('renderPass');
  if (mutate) { const out = mutate(src); assert.notStrictEqual(out, src, '突變沒注入成功'); src = out; }
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.renderPass(res);
  return { events };
}

test('★出口④　桌次未發佈 → 必須收場（這條永遠不會有 QR，是最容易漏的一條）', () => {
  const { events } = runRender({ published: false, activity: { name: '年中聚餐' } });
  assert.ok(events.includes('passDone_'),
    '忘了這條，「還沒公布桌次」的人會永遠看轉圈，連那句說明都看不到');
});

test('★出口①　QR 畫完才收場——而且要在 appendChild 之後，這就是本次改動的目的', async () => {
  const { events } = runRender(RES);
  await new Promise((r) => setImmediate(r));
  assert.ok(events.includes('appendChild'), 'QR 沒畫進去，這條測試本身就沒測到東西');
  assert.ok(events.indexOf('appendChild') < events.indexOf('passDone_'),
    `順序錯了：${JSON.stringify(events)}——先收場再畫 QR 等於沒改`);
});

test('★出口⑤　膠囊版失敗退陽春版，那也是 QR，一樣要收場', async () => {
  const { events } = runRender(RES, { badgeFails: true });
  await new Promise((r) => setImmediate(r));
  assert.ok(events.includes('passDone_'), 'logo 拿不到就永遠轉圈＝比沒有膠囊嚴重得多');
});

test('對照組：把出口④的 passDone_ 拿掉，★那條必須翻紅', () => {
  const { events } = runRender(
    { published: false, activity: {} },
    null,
    (s) => s.replace(/passDone_\(\);\s*\/\/ 出口④[^\n]*\n/, ''));
  assert.ok(!events.includes('passDone_'),
    '拿掉之後仍然有人收場 ⇒ ★出口④那條抓不到');
});

test('對照組：把出口①的 passDone_ 拿掉，★那條必須翻紅', async () => {
  const { events } = runRender(RES, null,
    (s) => s.replace(/passDone_\(\);\s*\/\/ 出口①[^\n]*\n/, ''));
  await new Promise((r) => setImmediate(r));
  assert.ok(events.includes('appendChild'), '突變不該影響畫 QR 本身');
  assert.ok(!events.includes('passDone_'),
    '拿掉之後仍然有人收場 ⇒ ★出口①那條抓不到');
});
