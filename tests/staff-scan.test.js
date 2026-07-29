const { test } = require('node:test');
const assert = require('node:assert');
const { parseChkCode, sha256Hex, applyScan, chunkByLen, searchNames } = require('../assets/staff-scan.js');

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
