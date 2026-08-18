const { test } = require('node:test'); const assert = require('node:assert');
const { passCacheKey, passCacheUsable } = require('../assets/pass-cache.js');

const OK = { v: '21', res: { published: true, code: 'CHK|a|1|s', table: '21' } };

test('passCacheKey：以「人＋活動」分開；act 省略時歸 auto，不會跟指定場次互相污染', () => {
  assert.equal(passCacheKey('U1', 'midyear2026'), 'jdcPass:U1:midyear2026');
  assert.equal(passCacheKey('U1', ''), 'jdcPass:U1:auto');
  assert.notEqual(passCacheKey('U1', 'a'), passCacheKey('U2', 'a'));
});

test('沒帶 v（圖文選單常駐鈕）→ 有快取就用，永不重抓', () => {
  assert.equal(passCacheUsable(OK, ''), true);
});

test('帶的 v 與存下來的相同（同一則通知重複點開）→ 用快取', () => {
  assert.equal(passCacheUsable(OK, '21'), true);
});

test('帶的 v 不同（桌次改了、承辦人補發）→ 不能用，要重抓', () => {
  assert.equal(passCacheUsable(OK, '25'), false);
});

test('未發佈的快取一律不算數——否則發佈後那支手機會一直吃到「還沒公布」那份', () => {
  assert.equal(passCacheUsable({ v: '', res: { published: false } }, ''), false);
});

test('沒有快取、或形狀壞掉 → 一律當作沒有，去打 GAS（不要拿 undefined 去畫 QR）', () => {
  assert.equal(passCacheUsable(null, ''), false);
  assert.equal(passCacheUsable({}, ''), false);
  assert.equal(passCacheUsable({ v: '21' }, '21'), false);
});
