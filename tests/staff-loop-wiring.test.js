const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 掃描迴圈的「接線」測試（2026-08-21）。
 *
 * 為何存在：shouldHandleCode 的純函式測試再完整，也證明不了 staff.html 的 loop()
 * 真的有呼叫它。實測過——把那個判斷換回 `if (code && code.data)`，23 條純函式測試
 * 與 9 頁載入測試**全綠**，而現場行為已經退回「停留中吞掉下一位」。
 * 今天同一種洞踩到第三次（另兩處：報到閘的 published、報到紀錄的時間格式），
 * 所以這裡照同一手法：抽 staff.html 裡 loop() 的原始碼下來跑，配最小替身。
 *
 * ⚠️ 驗的是「loop 有沒有依 shouldHandleCode 決定要不要送去 handle」，
 * 不是相機、不是 jsQR 的辨識率——那兩件只有真機測得到。
 */
function runLoopOnce({ codeData, lastText, lastAt, holdUntil, now }) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8');
  const m = html.match(/^function loop\(video, ctx, cv\) \{[\s\S]*?^\}/m);
  assert.ok(m, 'staff.html 找不到 function loop(video, ctx, cv)——改了簽名就要同步改這支測試');

  const handled = [];
  const ctx = {
    console,
    jsQR: () => (codeData ? { data: codeData } : null),
    shouldHandleCode: require('../assets/staff-scan.js').shouldHandleCode,
    handle: (text) => { handled.push(text); },
    lastText, lastAt, holdUntil,
    Date: { now: () => now },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,   // 不真的排下一格，否則測試會無限跑
  };
  vm.createContext(ctx);
  vm.runInContext(m[0], ctx, { filename: 'staff.html-loop' });
  const video = { readyState: 4, HAVE_ENOUGH_DATA: 4, videoWidth: 2, videoHeight: 2 };
  const cv = { width: 0, height: 0 };
  const c2d = { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }) };
  ctx.loop(video, c2d, cv);
  return handled;
}

test('停留中掃到「不同」的碼 → 仍會送去 handle（下一位不能被吞掉）', () => {
  const h = runLoopOnce({ codeData: 'CHK|a|00002|s', lastText: 'CHK|a|00001|s',
    lastAt: 9000, holdUntil: 10000, now: 9500 });
  assert.deepEqual(h, ['CHK|a|00002|s']);
});

test('停留中掃到「同一張」碼 → 不送（人還站在鏡頭前）', () => {
  const h = runLoopOnce({ codeData: 'CHK|a|00001|s', lastText: 'CHK|a|00001|s',
    lastAt: 9000, holdUntil: 10000, now: 9500 });
  assert.deepEqual(h, []);
});

test('沒解到碼 → 不送', () => {
  assert.deepEqual(runLoopOnce({ codeData: null, lastText: '', lastAt: 0, holdUntil: 0, now: 1 }), []);
});

test('對照組：不在停留中、全新的碼 → 一定要送，否則上面兩條驗的是「永遠不送」', () => {
  const h = runLoopOnce({ codeData: 'CHK|a|00003|s', lastText: '', lastAt: 0, holdUntil: 0, now: 1 });
  assert.deepEqual(h, ['CHK|a|00003|s']);
});
