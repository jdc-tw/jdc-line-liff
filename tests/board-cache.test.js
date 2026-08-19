const { test } = require('node:test'); const assert = require('node:assert');
const BC = require('../assets/board-cache.js');

test('cacheExpired：剛好 7 天不算過期，多一毫秒才算', () => {
  const t0 = 1000000;
  assert.equal(BC.cacheExpired(t0, t0 + BC.CACHE_TTL_MS), false);
  assert.equal(BC.cacheExpired(t0, t0 + BC.CACHE_TTL_MS + 1), true);
});

test('cacheExpired：savedAt 缺漏或不是數字 → 一律當過期', () => {
  assert.equal(BC.cacheExpired(undefined, Date.now()), true);
  assert.equal(BC.cacheExpired(null, Date.now()), true);
  assert.equal(BC.cacheExpired('1000', Date.now()), true);
  assert.equal(BC.cacheExpired(NaN, Date.now()), true);
});

// 全站四種實際字串，逐檔查證過（attend:82 / stats:602 / board:241,253 / hr-stats:73）
test('cacheVerdict：四種離線字串全部要判成 offline（禁用完全相等比對）', () => {
  [
    '連線逾時（伺服器喚醒中），請重新整理再試。',
    '連線逾時，請重新整理。',
    '連線失敗，請重新整理。',
    '連線失敗',
  ].forEach((msg) => {
    assert.equal(BC.cacheVerdict({ ok: false, msg: msg }), 'offline', msg);
  });
});

test('cacheVerdict：token 失效 → revoked；角色不符與不明訊息 → ok（不得清快取）', () => {
  assert.equal(BC.cacheVerdict({ ok: false, msg: '無權限或連結已失效。' }), 'revoked');
  assert.equal(BC.cacheVerdict({ ok: false, msg: '此連結非您的權限範圍。' }), 'ok');
  assert.equal(BC.cacheVerdict({ ok: false, msg: '找不到員工名冊' }), 'ok');
  assert.equal(BC.cacheVerdict({ ok: true }), 'ok');
});

test('cacheVerdict：外層 ok、results 內某支無權限 → 仍是 ok', () => {
  const env = { ok: true, results: { getRosterList: { ok: false, msg: '無權限或連結已失效。' } } };
  assert.equal(BC.cacheVerdict(env), 'ok');
});

test('nameOfSlice：無參數的 action 用自己的名字', () => {
  assert.equal(BC.nameOfSlice('getRosterList', { ok: true }, {}), 'getRosterList');
  assert.equal(BC.nameOfSlice('listHrNotices', { ok: true }, {}), 'listHrNotices');
  assert.equal(BC.nameOfSlice('listOptions', { ok: true }, {}), 'listOptions');
  assert.equal(BC.nameOfSlice('getHrStats', { ok: true }, {}), 'getHrStats');
});

test('nameOfSlice：名稱一律由「送出的參數」算，不從回應反推', () => {
  const slice = { ok: true, activity: { id: 'WRONG' } };
  assert.equal(BC.nameOfSlice('getSeatingBoard', slice, { actId: 'midyear2026' }),
    'getSeatingBoard:midyear2026');
  assert.equal(BC.nameOfSlice('listStaffStations', slice, { actId: 'yearend2026' }),
    'listStaffStations:yearend2026');
  assert.equal(BC.nameOfSlice('getSeniorNotice', { ok: true, year: 2099 }, { year: 2026 }),
    'getSeniorNotice:2026');
});

test('nameOfSlice：getActivityStats 的 act 為空時，名稱結尾就是冒號', () => {
  assert.equal(BC.nameOfSlice('getActivityStats', { ok: true }, { act: '' }), 'getActivityStats:');
  assert.equal(BC.nameOfSlice('getActivityStats', { ok: true }, {}), 'getActivityStats:');
});

test('nameOfSlice：previewPassBroadcast 恆回 null（不分 tpl 空不空，永不落地）', () => {
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { tpl: '' }), null);
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { tpl: '改過的範本' }), null);
});

test('nameOfSlice：不認得的 action 回 null（fail-safe，不存看不懂的東西）', () => {
  assert.equal(BC.nameOfSlice('somethingNew', { ok: true }, {}), null);
});
