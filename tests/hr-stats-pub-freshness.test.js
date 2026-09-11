/**
 * 公開聚合檔的「這份資料是哪天的」標記。
 *
 * 為何存在：上游斷掉時**畫面不會有任何異狀**——靜態檔停在舊資料，圖表照畫、
 * 數字照顯示、零錯誤訊息。排程那端的失敗通知擋不住「排程整支沒跑」那一半，
 * 這條文案是那一半唯一的出口。三種狀態很容易寫反，而寫反在畫面上不報錯。
 */
const { test } = require('node:test');
const assert = require('node:assert');
// 🔴 取函式本體走共用的 `helpers/source-scan.js`，不自己手寫數大括號那一套。
//    手寫的是**近似取法**：從 `function 名(` 數到括號閉合。它會在一行寫法的函式上
//    多吞下一支，而多吞得剛剛好的時候是**靜默**的——蓋掉測試種下去的替身、不報錯。
//    共用那支改走引擎剖析（把檔跑進 context、拿真函式的 `toString`），沒有這個失效方向。
//    ⬛ 2026-09-10 遷移當下量過：兩種取法對 `pubLabel` 都是 522 字元，這一支本來沒被吃到。
const { fnSrc, scriptText } = require('./helpers/source-scan.js');

const HTML = scriptText('hr-stats.html');

/** 門檻值也從原始碼取，不在測試裡另抄一份——抄了就會有兩個門檻各自漂移。 */
const HOURS = Number(/var PUB_STALE_HOURS = (\d+)/.exec(HTML)[1]);
// 那支函式讀外層的 PUB_STALE_HOURS，所以把**原始碼裡那一個**注進去；
// 測試不另抄一份門檻，抄了就是兩個門檻各自漂移。
const pubLabel = new Function('PUB_STALE_HOURS',
  'return (' + fnSrc('pubLabel', 'hr-stats.html') + ')')(HOURS);
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

test('⬛ 零點：這支函式真的被抓出來了，而且門檻是原始碼裡那個數字', () => {
  assert.equal(typeof pubLabel, 'function');
  assert.ok(HOURS > 0 && HOURS < 200, '門檻值取錯了：' + HOURS);
});

test('null → 不顯示（即時資料已經蓋上來了）', () => {
  assert.equal(pubLabel(null), null);
  assert.equal(pubLabel(undefined), null);
});

test("'unreachable' → 明說讀不到，不是靜靜留白", () => {
  assert.match(pubLabel('unreachable'), /讀不到/);
});

test('🔴 沒有時間戳 → 「資料日期不明」，不可以當成沒事', () => {
  // 分不出新舊這件事本身就要說出來。首次部署後、排程還沒跑過的那一份就是這樣。
  assert.equal(pubLabel('不是時間'), '資料日期不明');
  // 🔴 只有明確的 null／undefined 算「清掉」。空字串、0、NaN 一律算「不明」——
  //    讓任何 falsy 值都當成「沒事」正是 fail-open：時間戳寫空了，畫面看起來很健康。
  assert.equal(pubLabel(''), '資料日期不明');
});

test('新鮮的（門檻內）→ 不佔畫面', () => {
  assert.equal(pubLabel(ago(0)), null);
  assert.equal(pubLabel(ago(HOURS - 1)), null);
});

test('🔴 過了門檻 → 顯示資料日期', () => {
  const s = pubLabel(ago(HOURS + 1));
  assert.match(s, /資料為 \d+\/\d+，可能未更新/);
});

test('⬛ 對照組：門檻兩側必須不同——相同就代表這個門檻什麼都沒做', () => {
  assert.notEqual(pubLabel(ago(HOURS - 1)), pubLabel(ago(HOURS + 1)));
});

test('🔴 漏跑一整天（48h）一定要被標出來', () => {
  assert.match(pubLabel(ago(48)), /可能未更新/);
});
