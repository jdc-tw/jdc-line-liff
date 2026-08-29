const { test } = require('node:test');
const assert = require('node:assert');
const { dlDoneMsg_ } = require('../assets/roster-dl.js');

// dlDoneMsg_(active, onLeave, total)：active＝非離職（含留停，見 filterRosterExport JSDoc），
// 第一段＝active-onLeave；留停／離職為 0 時該段不出現（Ruling R14：別再把留停併進「在職」的數字）。
//
// ⚠️ 2026-08-28（M3／R20）改文案：第一段的字從「在勤」改成「在職」，數字不動。
// 舊文案錯在哪：同一個數字在這裡叫「在勤」、在名冊看板（board.html paintRoster）叫「在職」，
// 同一個人開兩處會看到同一件事有兩個名字。裁決是面向使用者一律「在職／留停／離職」，
// 跟隨名冊看板既有文案；程式內部變數名（onDuty）不受此限。

test('三段全有：在職／留停／含離職都印出', () => {
  // active=5（3在職+2留停）、total=7（另有2離職）
  assert.strictEqual(dlDoneMsg_(5, 2, 7), '已下載 ✅（在職 3 人，留停 2 人，含離職 2 人）');
});

test('無留停：不印留停那段', () => {
  // active=3（全在職）、total=4（1離職）
  assert.strictEqual(dlDoneMsg_(3, 0, 4), '已下載 ✅（在職 3 人，含離職 1 人）');
});

test('無離職（total===active）：不印含離職那段', () => {
  assert.strictEqual(dlDoneMsg_(5, 2, 5), '已下載 ✅（在職 3 人，留停 2 人）');
});

test('全在職、無留停無離職：只印在職人數', () => {
  assert.strictEqual(dlDoneMsg_(4, 0, 4), '已下載 ✅（在職 4 人）');
});

test('M3／R20：三段用語與名冊看板一致，不得再出現「在勤」', () => {
  // 為何存在：這條釘住「用語統一」這個裁決本身。文案改回「在勤」時，
  // 上面四條會紅在字串比對，但那讀起來像是有人改了數字；這條讀起來就是「用語又分岔了」。
  const all = [dlDoneMsg_(5, 2, 7), dlDoneMsg_(3, 0, 4), dlDoneMsg_(4, 0, 4)].join('\n');
  assert.ok(all.indexOf('在勤') < 0, '面向使用者的文案又出現「在勤」＝同一個數字再度有兩個名字');
  assert.ok(all.indexOf('在職') >= 0);
});
