const { test } = require('node:test');
const assert = require('node:assert');
const { esc, escAttrJs, listHtml, opinionsHtml, renderStatsHtml, pickDefaultActivity } = require('../assets/stats-view.js');

const OK = {
  ok: true, who: '王副總',
  activity: { id: 'A003', name: '2026 尾牙', status: '關閉', eventDate: '2026/01/20', deadlineText: '2026/01/05' },
  counts: { attend: 70, absent: 10, boundNoReply: 5, notBound: 15, total: 100, replied: 80, meat: 50, veg: 20 },
  opinions: [{ unit: '工務部', name: '王小明', attend: '參加', opinion: '希望早點結束' }],
  absentList: [{ unit: '工務部', name: '李小華' }],
  boundNoReply: [{ unit: '管理部', name: '陳小美' }],
  notBound: [{ unit: '管理部', name: '林小強' }],
};

test('esc 逸出角括號', () => {
  assert.equal(esc('<script>'), '&lt;script>');
  assert.equal(esc(null), '');
});

test('renderStatsHtml 產出三個數字與總計列', () => {
  const out = renderStatsHtml(OK, {});
  assert.equal(out.ok, true);
  assert.equal(out.actId, 'A003');
  assert.equal(out.titleText, '2026 尾牙');
  assert.match(out.bodyHtml, /">70<\/div><div class="cap">參加/);
  assert.match(out.bodyHtml, /">10<\/div><div class="cap">不參加/);
  assert.match(out.bodyHtml, /">20<\/div><div class="cap">未填/);   // boundNoReply 5 + notBound 15
  assert.match(out.bodyHtml, /全員 100・已回覆 80・葷 50／素 20/);
});

test('renderStatsHtml meta 含活動日期、截止、狀態與身分', () => {
  const out = renderStatsHtml(OK, {});
  assert.equal(out.metaText, '活動日期：2026/01/20　回覆截止：2026/01/05　狀態：關閉　（王副總）');
});

test('活動名稱為空時用 fallbackTitle（避免切換活動殘留上一場標題）', () => {
  const noName = JSON.parse(JSON.stringify(OK));
  noName.activity.name = '';
  assert.equal(renderStatsHtml(noName, { fallbackTitle: '活動紀錄看板' }).titleText, '活動紀錄看板');
  assert.equal(renderStatsHtml(noName, {}).titleText, '');
});

test('renderStatsHtml 意見區帶筆數', () => {
  assert.match(renderStatsHtml(OK, {}).bodyHtml, /意見（1）/);
});

// R21：extraAttend＝母數外但特許填答的留停者，「參加」已含他們但「已回覆」分母不含，
// 畫面要講清楚原因（否則像算錯）。三種情況：>0 顯示、0 不顯示、undefined（舊快取）不顯示。
test('R21：extraAttend > 0 時顯示留停特許填答說明與正確人數', () => {
  const withExtra = JSON.parse(JSON.stringify(OK));
  withExtra.counts.extraAttend = 3;
  const html = renderStatsHtml(withExtra, {}).bodyHtml;
  assert.match(html, /其中留停 3 人為特許填答（不列入回覆率分母）/);
});

test('R21：extraAttend 為 0 時不顯示留停特許填答說明', () => {
  const zeroExtra = JSON.parse(JSON.stringify(OK));
  zeroExtra.counts.extraAttend = 0;
  const html = renderStatsHtml(zeroExtra, {}).bodyHtml;
  assert.ok(!html.includes('特許填答'));
});

test('R21：extraAttend 缺席（舊快取）時不顯示、且不出現 undefined/NaN', () => {
  const noExtra = JSON.parse(JSON.stringify(OK));
  delete noExtra.counts.extraAttend;
  const html = renderStatsHtml(noExtra, {}).bodyHtml;
  assert.ok(!html.includes('特許填答'));
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('NaN'));
});

test('renderStatsHtml 失敗時只回錯誤訊息、titleText 留空', () => {
  const out = renderStatsHtml({ ok: false, msg: '無權限或連結已失效。' }, {});
  assert.equal(out.ok, false);
  assert.equal(out.titleText, '');
  assert.equal(out.metaText, '');
  assert.match(out.bodyHtml, /無權限或連結已失效。/);
});

test('renderStatsHtml 收到 null 給預設錯誤訊息', () => {
  assert.match(renderStatsHtml(null, {}).bodyHtml, /連結無效或已失效/);
});

test('名單為空顯示（無）不炸', () => {
  assert.match(listHtml([]), /（無）/);
  assert.match(opinionsHtml([]), /（無）/);
});

test('姓名與意見中的角括號被逸出（XSS 回歸）', () => {
  const html = opinionsHtml([{ unit: 'U', name: '<img src=x>', attend: '參加', opinion: '<b>粗體</b>' }]);
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<b>粗體'));
  assert.match(html, /&lt;img src=x>/);
});

test('listHtml 依單位分組並顯示人數', () => {
  const html = listHtml([{ unit: '甲部', name: 'A' }, { unit: '甲部', name: 'B' }, { unit: '乙部', name: 'C' }]);
  assert.match(html, /甲部<span class="cnt">2 人/);
  assert.match(html, /乙部<span class="cnt">1 人/);
});

// ── pickDefaultActivity：本案「不受活動開關影響」的落點 ──────────────────
const ROWS = [
  { id: 'A001', status: '關閉', open: false },
  { id: 'A002', status: '開放', open: true },
  { id: 'A003', status: '開放', open: false },   // 已過截止
];

test('網址帶 act 時直接用它（讓後端回報找不到）', () => {
  assert.equal(pickDefaultActivity(ROWS, 'A001'), 'A001');
  assert.equal(pickDefaultActivity(ROWS, 'A999'), 'A999');
});

test('沒帶 act 時取最新一場開放中的活動', () => {
  assert.equal(pickDefaultActivity(ROWS, ''), 'A002');
});

test('全部關閉或截止時取最新建立的一場（活動關掉照樣有東西看）', () => {
  const closed = [{ id: 'A001', status: '關閉', open: false }, { id: 'A002', status: '開放', open: false }];
  assert.equal(pickDefaultActivity(closed, ''), 'A002');
});

test('清單為空回空字串', () => {
  assert.equal(pickDefaultActivity([], ''), '');
  assert.equal(pickDefaultActivity(null, ''), '');
});

/* ═══ escAttrJs：把值放進屬性裡的 JS 字串（2026-09-02）═══════════════════════
   為何需要另一支：`esc()` 服務的是「顯示成文字內容」，而屬性裡的 JS 字串是**另一個
   問題**，兩者的正確逸出方式互相衝突——單引號要走反斜線（實體會被瀏覽器先解碼），
   雙引號要走實體（反斜線來不及，`"` 會先結束 HTML 屬性）。一把尺量不了兩個問題。

   ⚠️ 這一組守的是**規則**，不是「這個值目前沒事」。所以全部用負向案例：
   餵會壞的東西，看它有沒有被處理掉。正向案例證明不了約束存在。

   真瀏覽器（Chromium）已逐案驗過八種輸入，含屬性注入的負向案例。 */

const ATTR = (v) => 'onclick="rec(\'' + escAttrJs(v) + '\')"';
/** 瀏覽器解析屬性時，值到下一個雙引號就結束。被提早截斷＝後面會被當成新屬性。 */
const truncated = (attr) => attr.slice(9).indexOf('"') !== attr.length - 10;
/** onclick 的內容會被當成函式本體編譯——這是瀏覽器對那個屬性做的事。 */
const compiles = (body) => { try { new Function(body); return true; } catch (_) { return false; } };
const bodyOf = (attr) => attr.match(/^onclick="([^"]*)/)[1];

test('★escAttrJs：單引號走反斜線（HTML 實體會被瀏覽器先解碼，等於沒逸出）', () => {
  assert.equal(escAttrJs("歐'布萊恩"), "歐\\'布萊恩");
  assert.ok(compiles(bodyOf(ATTR("歐'布萊恩"))));
});

test('★escAttrJs：雙引號走 HTML 實體（反斜線來不及，" 會先結束屬性）', () => {
  assert.equal(escAttrJs('大"順"營造'), '大&quot;順&quot;營造');
  const a = ATTR('大"順"營造');
  assert.ok(!truncated(a), '屬性被提早截斷＝後面的內容會被當成新屬性解析');
  assert.ok(compiles(bodyOf(a)));
});

test('★escAttrJs：結尾反斜線（它會把後面那個結束引號吃掉）', () => {
  const v = '甲乙' + String.fromCharCode(92);
  assert.ok(compiles(bodyOf(ATTR(v))), '產出：' + ATTR(v));
});

test('★escAttrJs：換行（屬性裡的真換行 = JS 字串常值裡的換行 = SyntaxError）', () => {
  assert.equal(escAttrJs('第一行\n第二行'), '第一行\\n第二行');
  assert.ok(compiles(bodyOf(ATTR('第一行\n第二行'))));
});

test('★escAttrJs：& 要最先逸出——否則資料裡本來就有的 &#39; 會被解成單引號', () => {
  // 這一條是順序的守門。&#39; 是使用者資料裡可能出現的六個字元，
  // 不先擋掉的話瀏覽器解碼後就變成一個真的單引號。
  assert.equal(escAttrJs('甲&#39;乙'), '甲&amp;#39;乙');
});

test('★escAttrJs：自己涵蓋 <，呼叫端不必再套一層 esc', () => {
  // 疊成 esc(escAttrJs(x)) 會讓兩把尺又黏在一起，而那正是這個缺陷的成因。
  assert.equal(escAttrJs('<b>x</b>'), '&lt;b>x&lt;/b>');
});

test('★escAttrJs：屬性注入不成立（負向案例）', () => {
  const a = ATTR('x" onmouseover="alert(1)');
  assert.ok(!truncated(a), '屬性被截斷 ⇒ onmouseover 會變成一個真的屬性。產出：' + a);
});

test('對照組：正常值一個字都不會被改壞', () => {
  assert.equal(escAttrJs('年中聚餐'), '年中聚餐');
  assert.equal(escAttrJs(null), '');
  assert.equal(escAttrJs(undefined), '');
  assert.equal(escAttrJs(123), '123');
});

test('對照組：現行的 esc 沒有被動到（它服務的是另一個問題）', () => {
  assert.equal(esc('<script>'), '&lt;script>');
  assert.equal(esc("歐'布萊恩"), "歐'布萊恩", 'esc 不該逸出單引號——那會讓文字內容多出反斜線');
});
