const { test } = require('node:test');
const assert = require('node:assert');
const { gasCall } = require('../assets/gas-call.js');

// 🔴 四條原本寫在 welfare-client.test.js 的 gasCall 測試逐字搬過來，不重寫：
//    ① 第四個參數是毫秒數不是 options 物件
//    ② 傳輸失敗 → transport:true
//    ③ 伺服器說不行 → transport:false
//    ④ 永遠 resolve，不 reject
//
// ⚠️ 計畫（2026-08-24 phase1 plan 第 1607–1609 行）的搬移清單只列了三條，
//    漏掉 ②。而 ② 正是「傳輸失敗 vs 伺服器拒絕」這整個設計的核心斷言——
//    沒有它，`transport:true` 那條路徑一次都沒被測到。已補回。
// ⚠️ ① 原本讀的是 assets/welfare-client.js，但 gasCall 已搬到本檔對應的
//    assets/gas-call.js，路徑跟著改。

test('🔴 gasCall 的第四個參數是毫秒數，不是 options 物件', () => {
  // 傳物件的話 setTimeout 會把它轉成 NaN＝0ms ⇒ 請求立刻逾時，
  // 而既有 jsonp 把逾時 resolve 成 {ok:false}，所以症狀是「按了就說失敗」。
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'assets', 'gas-call.js'), 'utf8');
  assert.match(src, /setTimeout\([\s\S]{0,120}timeoutMs \|\| 30000\)/,
    'timeoutMs 沒有直接當毫秒數用');
});

test('對照組：上面那條抓得到「把 timeoutMs 當物件用」的寫法', () => {
  const bad = 'timer = setTimeout(fn, (opts && opts.timeout) || 30000);';
  assert.ok(!/setTimeout\([\s\S]{0,120}timeoutMs \|\| 30000\)/.test(bad),
    '判斷邏輯壞了：這種寫法應該被判為不合格');
});

test('🔴 傳輸失敗與伺服器拒絕要分得出來', async () => {
  // 對「寄驗證碼」這兩件事的處置完全相反：
  //   伺服器說不行 → 沒寄出，可以重按
  //   傳輸失敗     → 可能已經寄出，不可以說「失敗」
  const orig = global.fetch;
  global.fetch = () => Promise.reject(new Error('boom'));
  const r = await gasCall('https://x/', 'a', {}, 1000);
  global.fetch = orig;
  assert.equal(r.ok, false);
  assert.equal(r.transport, true, '傳輸失敗沒有標 transport:true');
});

test('🔴 伺服器回 ok:false 時 transport 不可為 true', async () => {
  const orig = global.fetch;
  global.fetch = () => Promise.resolve({ text: () => Promise.resolve('cb({"ok":false,"msg":"沒權限"})') });
  const r = await gasCall('https://x/', 'a', {}, 1000);
  global.fetch = orig;
  assert.equal(r.ok, false);
  // 🔴 **要 equal(false) 不是 notEqual(true)**——undefined 也會通過 notEqual，
  //    而契約寫的是 `transport:boolean`。（2026-08-25 第四輪審查抓到。）
  assert.equal(r.transport, false,
    '伺服器拒絕時 transport 不是 false——契約說它是 boolean，'
    + '留成 undefined 的話下一個照契約寫 `=== false` 的呼叫端會落不到那條分支');
});

test('🔴 gasCall 永遠 resolve，不 reject（呼叫端不該寫 .catch 當主要路徑）', async () => {
  const orig = global.fetch;
  global.fetch = () => Promise.reject(new Error('boom'));
  await assert.doesNotReject(() => gasCall('https://x/', 'a', {}, 1000));
  global.fetch = orig;
});
