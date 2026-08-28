const { test } = require('node:test');
const assert = require('node:assert');
const { dlDoneMsg_ } = require('../assets/roster-dl.js');

// dlDoneMsg_(active, onLeave, total)：active＝非離職（含留停，見 filterRosterExport JSDoc），
// 在勤＝active-onLeave；留停／離職為 0 時該段不出現（Ruling R14：別再把留停併進「在職」文案）。

test('三段全有：在勤／留停／含離職都印出', () => {
  // active=5（3在勤+2留停）、total=7（另有2離職）
  assert.strictEqual(dlDoneMsg_(5, 2, 7), '已下載 ✅（在勤 3 人，留停 2 人，含離職 2 人）');
});

test('無留停：不印留停那段', () => {
  // active=3（全在勤）、total=4（1離職）
  assert.strictEqual(dlDoneMsg_(3, 0, 4), '已下載 ✅（在勤 3 人，含離職 1 人）');
});

test('無離職（total===active）：不印含離職那段', () => {
  assert.strictEqual(dlDoneMsg_(5, 2, 5), '已下載 ✅（在勤 3 人，留停 2 人）');
});

test('全在勤、無留停無離職：只印在勤人數', () => {
  assert.strictEqual(dlDoneMsg_(4, 0, 4), '已下載 ✅（在勤 4 人）');
});
