/**
 * line-emoji.test.js — palette 資料的守門。
 *
 * 🔴 **挑錯不會報錯**：productId／emojiId 只要格式合法，圖就畫得出來，
 *    只是畫出來不是你想要的那一顆。所以下面守的是「能機械驗的那一半」：
 *    格式、重複、範圍、以及端午那五顆在不在。
 *    「這顆長得對不對」只有人看圖才知道（Task 16 的使用者閘門）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { LE_SYM, LE_HAND, LINE_EMOJI, LINE_EMOJI_GROUPS,
        LINE_EMOJI_GLOBALS } = require('../assets/line-emoji.js');
const { MIRROR_EMOJI_RE, renderMirrorHtml, registerPhSet,
        enableEmoji } = require('../assets/tpl-editor.js');

/** 端午範本實際用到的五顆（2026-08-25 使用者拍板，T298）。 */
const DUANWU = [
  [LE_SYM, '028'],   // (sparkle) 閃亮，出現兩處
  [LE_SYM, '006'],   // (red check mark) 紅勾
  [LE_SYM, '029'],   // (fire) 火
  [LE_SYM, '026'],   // (?) 紅問號
  [LE_HAND, '021'],  // (pointing right) 食指指向右
];

test('🔴 端午用到的五顆一定在常用一排裡（否則她想再插一次卻找不到）', () => {
  const have = new Set(LINE_EMOJI.map((e) => e.productId + ':' + e.emojiId));
  const missing = DUANWU.filter(([p, i]) => !have.has(p + ':' + i))
    .map(([p, i]) => p.slice(0, 6) + '…:' + i);
  assert.deepStrictEqual(missing, [], '常用一排少了這幾顆：' + missing.join(', '));
});

test('對照組：這個量法真的分得出「少了一顆」', () => {
  // 沒有這條的話，上面那條在 DUANWU 寫錯時會恆綠而什麼都沒測到。
  const have = new Set(LINE_EMOJI.map((e) => e.productId + ':' + e.emojiId));
  assert.ok(!have.has(LE_SYM + ':999'), '999 不該存在卻說有——集合建錯了');
  assert.ok(have.has(LE_SYM + ':028'), '028 該存在卻說沒有——集合建錯了');
});

test('🔴 每一顆的格式都要能被鏡像層的 regex 認得', () => {
  // 格式不合的話，承辦人點了插進去，鏡像層卻只顯示 [[e:...]] 的字面
  registerPhSet('zz-emoji', []);
  enableEmoji('zz-emoji', LINE_EMOJI);
  const bad = LINE_EMOJI.filter((e) => {
    MIRROR_EMOJI_RE.lastIndex = 0;
    const mark = '[[e:' + e.productId + ':' + e.emojiId + ']]';
    return renderMirrorHtml(mark, 'zz-emoji').indexOf('<img') < 0;
  });
  assert.deepStrictEqual(bad.map((e) => e.productId + ':' + e.emojiId), [],
    '這幾顆的格式鏡像層認不得');
});

test('🔴 常用一排沒有重複（重複只是佔位置，但會讓人以為有兩顆不同的）', () => {
  const keys = LINE_EMOJI.map((e) => e.productId + ':' + e.emojiId);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepStrictEqual(dup, [], '重複：' + dup.join(', '));
});

test('每一顆都有 label（title 提示；沒有的話滑過去看不出是什麼）', () => {
  const noLabel = LINE_EMOJI.filter((e) => !e.label);
  assert.deepStrictEqual(noLabel.map((e) => e.emojiId), []);
});

test('常用一排的數量在合理範圍（一排太少會逼人一直開「更多」）', () => {
  assert.ok(LINE_EMOJI.length >= 30 && LINE_EMOJI.length <= 60,
    '目前 ' + LINE_EMOJI.length + ' 顆');
});

test('🔴 常用一排的每一顆，「更多」也翻得到（productId 在完整清單裡）', () => {
  // 翻不到的話，承辦人在「更多」裡找不到剛用過的那顆，會以為是自己記錯。
  const known = new Set(LINE_EMOJI_GROUPS.map((g) => g.productId));
  const orphan = LINE_EMOJI.filter((e) => !known.has(e.productId));
  assert.deepStrictEqual(orphan.map((e) => e.productId), [],
    '這幾顆的組別不在完整清單裡');
});

test('🔴 常用一排的 emojiId 不超過該組的顆數（超過就是 404 破圖）', () => {
  const count = {};
  LINE_EMOJI_GROUPS.forEach((g) => { count[g.productId] = g.count; });
  const over = LINE_EMOJI.filter((e) => Number(e.emojiId) > count[e.productId]);
  assert.deepStrictEqual(over.map((e) => e.productId.slice(0, 6) + '…:' + e.emojiId), [],
    '這幾顆的編號超過該組的顆數');
});

test('完整清單有 45 組、合計 9,175 顆（二分探測實測值）', () => {
  assert.equal(LINE_EMOJI_GROUPS.length, 45);
  assert.equal(LINE_EMOJI_GROUPS.reduce((n, g) => n + g.count, 0), 9175);
});

test('完整清單沒有重複的組', () => {
  const ids = LINE_EMOJI_GROUPS.map((g) => g.productId);
  assert.equal(new Set(ids).size, ids.length);
});

test('符號組與手勢組的常數，指到完整清單裡真的存在的組', () => {
  const byId = {};
  LINE_EMOJI_GROUPS.forEach((g) => { byId[g.productId] = g; });
  assert.ok(byId[LE_SYM], '符號組不在清單裡');
  assert.ok(byId[LE_HAND], '手勢組不在清單裡');
  assert.equal(byId[LE_SYM].count, 239);
  assert.equal(byId[LE_HAND].count, 222);
});

test('🔴 LINE_EMOJI_GLOBALS 與實際新增的全域完全一致', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const ctx = vm.createContext({});
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'assets', 'line-emoji.js'), 'utf8'),
    ctx, { filename: 'line-emoji.js' });
  const added = Object.getOwnPropertyNames(ctx).filter((n) => !before.has(n));
  assert.deepStrictEqual(added.slice().sort(), LINE_EMOJI_GLOBALS.slice().sort());
});
