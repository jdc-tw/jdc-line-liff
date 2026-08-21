const { test } = require('node:test');
const assert = require('node:assert');
const { parseChkCode, sha256Hex, applyScan, chunkByLen, searchNames,
        seenLoad, seenSave, seenMerge } = require('../assets/staff-scan.js');

test('parseChkCode：格式正確回員編', () => {
  assert.deepEqual(parseChkCode('CHK|nendkai2026|00011|abc123', 'nendkai2026'),
    { ok: true, empNo: '00011' });
});

test('parseChkCode：活動不符拒絕', () => {
  assert.deepEqual(parseChkCode('CHK|other2026|00011|abc123', 'nendkai2026'),
    { ok: false, reason: 'wrongAct' });
});

test('parseChkCode：非 CHK 前綴/欄數不對＝format', () => {
  assert.equal(parseChkCode('WIN|x|y|z', 'a').reason, 'format');
  assert.equal(parseChkCode('CHK|only', 'a').reason, 'format');
  assert.equal(parseChkCode('', 'a').reason, 'format');
});

test('sha256Hex：已知向量', async () => {
  assert.equal(await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('applyScan：命中→ok＋入佇列；重複→dup 不重複入列；查無→unknown', async () => {
  const h = await sha256Hex('CHK|act|001|sig');
  const snap = {}; snap[h] = { empNo: '001', name: '王小明', unit: '管理部', table: '3', checked: false };
  let s = { seen: {}, queue: [] };
  let r1 = applyScan(s, h, snap, 1000);
  assert.equal(r1.verdict.type, 'ok');
  assert.equal(r1.verdict.person.name, '王小明');
  assert.equal(r1.state.queue.length, 1);
  let r2 = applyScan(r1.state, h, snap, 2000);
  assert.equal(r2.verdict.type, 'dup');
  assert.equal(r2.state.queue.length, 1);
  let r3 = applyScan(r2.state, 'nohash', snap, 3000);
  assert.equal(r3.verdict.type, 'unknown');
});

test('applyScan：快照標已報到（別台機器掃過）→dup', async () => {
  const h = await sha256Hex('CHK|act|002|sig');
  const snap = {}; snap[h] = { empNo: '002', name: '李四', unit: '施工部', table: '1', checked: true };
  const r = applyScan({ seen: {}, queue: [] }, h, snap, 1000);
  assert.equal(r.verdict.type, 'dup');
  assert.equal(r.state.queue.length, 0);
});

test('chunkByLen：以 URL 編碼後長度為準、涵蓋全部', () => {
  const rows = Array.from({length:10}, (_,i)=>({empNo:String(i),ts:i}));
  const packs = chunkByLen(rows, 200);
  assert.ok(packs.every(p => encodeURIComponent(JSON.stringify(p)).length <= 200));
  assert.equal(packs.reduce((n,p)=>n+p.length,0), 10);
});

test('chunkByLen：中文編碼膨脹也不超限（編碼後 ~9 倍）', () => {
  const rows = [{empNo:'測試甲',ts:1},{empNo:'測試乙',ts:2},{empNo:'測試丙',ts:3}];
  const packs = chunkByLen(rows, 120);
  assert.ok(packs.every(p => encodeURIComponent(JSON.stringify(p)).length <= 120));
  assert.equal(packs.reduce((n,p)=>n+p.length,0), 3);
});

test('searchNames：姓名子字串命中（name 表）', () => {
  const t = { '王大明':{empNo:'1',name:'王大明',unit:'A'}, '李小華':{empNo:'2',name:'李小華',unit:'B'} };
  const r = searchNames(t, '王');
  assert.equal(r.length, 1);
  assert.equal(r[0].empNo, '1');
});

// ── 已掃名單的持久化（2026-08-21 修 Q8）─────────────────────────────────────
// 缺陷長相：重新整理後 state.seen 歸零、快照的 checked 又是凍結值，於是同一個人
// 再掃一次被判成 ok，畫面顯示「已受理」＝看起來像剛剛才報到成功。

/** 極小的 localStorage 替身。 */
function fakeStore() {
  var m = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
  };
}

test('seenLoad：沒存過回空物件，不是 null（呼叫端會直接對它取索引）', () => {
  assert.deepEqual(seenLoad(fakeStore(), 'k'), {});
});

test('seenLoad：壞 JSON 回空物件，不讓整頁掛掉', () => {
  const st = fakeStore(); st.setItem('k', '{壞掉的');
  assert.deepEqual(seenLoad(st, 'k'), {});
});

test('seenLoad：存到陣列或 null 也要回空物件（型別不是物件就不能用）', () => {
  const st = fakeStore();
  st.setItem('k', '[1,2]'); assert.deepEqual(seenLoad(st, 'k'), {});
  st.setItem('k', 'null');  assert.deepEqual(seenLoad(st, 'k'), {});
});

test('重整後同一個人再掃＝已報到過，不是已受理（這條就是 Q8 本身）', () => {
  const st = fakeStore(), KEY = 'evtchk_seen_midyear2026';
  const HASH = 'aabbcc', snap = { aabbcc: { empNo: '00011', name: '甲', unit: 'A', checked: false } };

  // 第一次掃：seen 空 → ok
  let state = { seen: seenLoad(st, KEY), queue: [] };
  let r = applyScan(state, HASH, snap, 1);
  assert.equal(r.verdict.type, 'ok', '前置條件：第一次必須是 ok，否則後面驗的是別的東西');
  seenSave(st, KEY, r.state.seen);

  // 重新整理：記憶體全丟，只剩 storage；快照的 checked 仍是凍結的 false
  const reloaded = { seen: seenLoad(st, KEY), queue: [] };
  assert.equal(snap[HASH].checked, false, '前置條件：快照必須仍是 false，否則不是重現這個缺陷');
  assert.equal(applyScan(reloaded, HASH, snap, 2).verdict.type, 'dup');
});

test('對照組：seen 沒被存下來的話，重整後會判成 ok——證明上一條真的靠持久化', () => {
  const HASH = 'aabbcc', snap = { aabbcc: { empNo: '00011', name: '甲', unit: 'A', checked: false } };
  const r = applyScan({ seen: {}, queue: [] }, HASH, snap, 1);
  assert.equal(r.verdict.type, 'ok');
  assert.equal(applyScan({ seen: {}, queue: [] }, HASH, snap, 2).verdict.type, 'ok');
});

test('seenMerge：後端回的全場已報到員編併進來（跨站防重）', () => {
  const out = seenMerge({ h1: true }, ['00011', '00022'], { '00011': 'h1', '00022': 'h2' });
  assert.deepEqual(out, { h1: true, h2: true });
});

test('seenMerge：查不到 hash 的員編略過，不塞進對不上快照的鍵', () => {
  const out = seenMerge({}, ['00099'], { '00011': 'h1' });
  assert.deepEqual(out, {});
});

test('seenMerge：不就地改動傳進來的 seen（呼叫端會比較新舊）', () => {
  const before = {};
  seenMerge(before, ['00011'], { '00011': 'h1' });
  assert.deepEqual(before, {});
});
