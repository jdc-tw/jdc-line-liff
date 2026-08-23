const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 未送出警語的「排隊順序」測試（2026-08-23，T279）。
 *
 * 為何存在：`getUndelivered` 原本是頂層裸 jsonp，寫在首載批次之前。
 * 旗標是 false 的時候程式不跑，所以**量不到並行**——不是因為修好了。
 * 旗標一翻（stats.html 2026-08-23 已翻），重疊就回來：實測 bb72b32
 * getUndelivered 34→2135ms 與首載 batch 35→6034ms 重疊，
 * 違反本站「同頁任一時刻最多一支 /exec」。
 *
 * 這支測的是兩件靠讀程式碼看不出來的事：
 *   ① 呼叫排在第二發批次「之後」（second 沒 resolve 前不得送出請求）
 *   ② 呼叫包在 queueRead 裡（佇列前面還有人在飛時，它必須等）
 * queueRead 一律給**真貨**（board-cache.js），給假的等於沒驗到接線。
 *
 * ⚠️ 佔佇列的替身一定要 resolve。永不 resolve 的替身會卡住模組層級的
 * GAS_TAIL，讓同檔後面所有走佇列的測試靜默跑到逾時被砍（不是失敗）。
 */
const BC = require('../assets/board-cache.js');

const FILES = ['stats.html', 'board.html'];

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

/** 從頁面抽一支頂層函式的原始碼。抽不到就是簽名被改了，測試要跟著改。 */
function grab(html, file, name) {
  const re = new RegExp('^function ' + name + ' ?\\([^)]*\\) ?\\{[\\s\\S]*?^\\}', 'm');
  const m = html.match(re);
  assert.ok(m, `${file} 找不到 function ${name}(...)——改了簽名就要同步改這支測試`);
  return m[0];
}

/**
 * 在 vm 裡跑 wireUndeliveredAlert，回傳觀察得到的東西。
 * flag=false 時模擬「這一頁還沒上線」。
 */
function runWire(file, { flag, second, pending }) {
  const html = read(file);
  const src = grab(html, file, 'wireUndeliveredAlert');
  const calls = [];
  const bar = { textContent: '', style: { display: 'none' } };
  const ctx = {
    console, Promise, String, JSON,
    MSG_LOG_UI_ON: flag,
    queueRead: BC.queueRead,                 // 真貨
    jsonp: function (action) {
      calls.push(action);
      return Promise.resolve({ ok: true, pending: pending });
    },
    q: function () { return 'tok'; },        // stats.html 用 q('t')
    TOKEN: 'tok',                            // board.html 用 TOKEN
    document: { getElementById: function (id) { return id === 'alertBar' ? bar : null; } },
    __second: second,
  };
  vm.createContext(ctx);
  const done = vm.runInContext(src + '\nwireUndeliveredAlert(__second);', ctx);
  return { calls, bar, done };
}

/** 讓已排定的微工作跑完（不引入計時器，避免測試時間相依）。 */
function flush() {
  return new Promise(function (r) { setImmediate(r); });
}

for (const file of FILES) {
  test(`${file}：second 還沒 resolve 之前，不得送出 getUndelivered`, async () => {
    let release;
    const second = new Promise(function (r) { release = r; });
    const { calls, done } = runWire(file, { flag: true, second: second, pending: 0 });
    await flush();
    const duringSecond = calls.slice();     // 先取樣、後斷言（理由見下一支測試）
    release({ ok: true });
    await done;
    assert.deepStrictEqual(duringSecond, [], '第二發還在飛就送出請求＝回到重疊的老樣子');
    assert.deepStrictEqual(calls, ['getUndelivered']);
  });

  test(`${file}：佇列前面還有人在飛時要排隊（真 queueRead）`, async () => {
    let releasePrev;
    const prev = new Promise(function (r) { releasePrev = r; });
    const prevTask = BC.queueRead(function () { return prev; });   // 佔住佇列

    const { calls, done } = runWire(file, {
      flag: true, second: Promise.resolve({ ok: true }), pending: 0,
    });
    await flush();
    const duringPrev = calls.slice();

    // ⚠️ 先放行、後斷言。斷言失敗會 throw，寫在放行前面就會讓佔位的替身
    // 永遠不 resolve，卡住模組層級的 GAS_TAIL——同檔後面走佇列的測試全部
    // 跑到逾時被砍（不是失敗，是靜默掛住）。2026-08-23 做突變測試時當場踩到。
    releasePrev('前一支結束');
    await prevTask;
    await done;

    assert.deepStrictEqual(duringPrev, [], '前一支還在飛就送出＝沒包 queueRead');
    assert.deepStrictEqual(calls, ['getUndelivered']);
  });

  test(`${file}：second 收到 null（撤銷／離線）就不追加請求`, async () => {
    const { calls, done } = runWire(file, {
      flag: true, second: Promise.resolve(null), pending: 3,
    });
    await done;
    assert.deepStrictEqual(calls, []);
  });

  test(`${file}：旗標關著時完全不打網路`, async () => {
    const { calls, done } = runWire(file, {
      flag: false, second: Promise.resolve({ ok: true }), pending: 3,
    });
    await done;
    assert.deepStrictEqual(calls, []);
  });

  test(`${file}：pending>0 才顯示紅字`, async () => {
    const hit = runWire(file, { flag: true, second: Promise.resolve({ ok: true }), pending: 4 });
    await hit.done;
    assert.match(hit.bar.textContent, /有 4 則/);
    assert.strictEqual(hit.bar.style.display, 'block');

    const zero = runWire(file, { flag: true, second: Promise.resolve({ ok: true }), pending: 0 });
    await zero.done;
    assert.strictEqual(zero.bar.textContent, '');
    assert.strictEqual(zero.bar.style.display, 'none');
  });

  test(`${file}：呼叫點寫在 var SECOND 賦值之後`, () => {
    const html = read(file);
    const decl = html.indexOf('var SECOND=');
    const call = html.indexOf('wireUndeliveredAlert(SECOND)');
    assert.ok(decl > 0, `${file} 找不到 var SECOND=`);
    assert.ok(call > 0, `${file} 找不到 wireUndeliveredAlert(SECOND) 的呼叫點`);
    // var 會被 hoist 但賦值不會：寫在賦值之前＝呼叫當下 SECOND 是 undefined，
    // `undefined.then` 直接 TypeError。stats.html 的 previewPassBroadcast 踩過同一個坑。
    assert.ok(call > decl, `${file}：呼叫點在 var SECOND 賦值之前，第二發還沒建立`);
  });
}
