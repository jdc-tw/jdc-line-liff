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

// 假的 localStorage：Node 沒有它，用最小實作換掉
function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); }
  };
}

test('cacheSave → cacheBootstrap：存得進去、讀得回來，且磁碟上是亂碼', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'getRosterList', { ok: true, rows: ['王小明'] });

  const raw = st.getItem(st.key(0));
  assert.ok(raw.indexOf('王小明') === -1, '明文姓名不得出現在 localStorage');
  assert.ok(st.key(0).indexOf('jdcBoard:v1:') === 0, '鍵要帶版本');

  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map.getRosterList.value.rows, ['王小明']);
  assert.equal(typeof map.getRosterList.savedAt, 'number');
  BC.__resetForTest();
});

test('cacheSave：ok!==true 不寫入，且不覆蓋既有的成功快取', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'good' });
  await BC.cacheSave('tok-A', 'listOptions', { ok: false, msg: '無權限或連結已失效。' });

  const map = await BC.cacheBootstrap('tok-A');
  assert.equal(map.listOptions.value.v, 'good', '成功那筆必須還在');
  BC.__resetForTest();
});

test('不同 token 的快取互不干擾，cacheClear 只清當前指紋', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'A' });
  await BC.cacheSave('tok-B', 'listOptions', { ok: true, v: 'B' });
  await BC.cacheClear('tok-B');

  const a = await BC.cacheBootstrap('tok-A');
  const b = await BC.cacheBootstrap('tok-B');
  assert.equal(a.listOptions.value.v, 'A', 'A 的快取不該被 B 的撤銷清掉');
  assert.equal(b.listOptions, undefined);
  BC.__resetForTest();
});

test('bootstrap：過期的鍵會被讀掉並從磁碟刪除', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'old' });
  const before = st.length;
  assert.equal(before, 1);

  // 把時鐘往後推 8 天
  const map = await BC.cacheBootstrap('tok-A', Date.now() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(map.listOptions, undefined);
  assert.equal(st.length, 0, '過期的鍵要順手刪掉，不留殘骸');
  BC.__resetForTest();
});

test('bootstrap：解不開／缺 savedAt 的鍵當成沒有，並刪除', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  const k = st.key(0);
  st.setItem(k, 'this-is-not-valid-ciphertext');

  const map = await BC.cacheBootstrap('tok-A');
  assert.equal(map.listOptions, undefined);
  assert.equal(st.length, 0);
  BC.__resetForTest();
});

test('cacheRevoke 之後：cacheGet 恆回 null、cacheSave 變空操作', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  await BC.cacheBootstrap('tok-A');
  assert.ok(BC.cacheGet('listOptions'), '撤銷前讀得到');

  BC.cacheRevoke();
  assert.equal(BC.cacheGet('listOptions'), null);
  await BC.cacheSave('tok-A', 'listHrNotices', { ok: true, v: 'y' });
  assert.equal(BC.cacheGet('listHrNotices'), null);
  BC.__resetForTest();
});

test('localStorage 滿額（setItem 拋錯）→ 靜默略過，不影響流程', async () => {
  const st = fakeStore();
  st.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });   // 不得拋出
  BC.__resetForTest();
});

test('沒有 store（隱私模式）→ 整個模組退化成「永遠沒有快取」', async () => {
  BC.__setStoreForTest(null);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map, {});
  BC.__resetForTest();
});
