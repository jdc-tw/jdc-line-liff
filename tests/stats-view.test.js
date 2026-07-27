const { test } = require('node:test');
const assert = require('node:assert');
const { esc, listHtml, opinionsHtml, renderStatsHtml, pickDefaultActivity } = require('../assets/stats-view.js');

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
