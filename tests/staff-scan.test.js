const { test } = require('node:test');
const assert = require('node:assert');
const { parseChkCode, sha256Hex, applyScan } = require('../assets/staff-scan.js');

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
