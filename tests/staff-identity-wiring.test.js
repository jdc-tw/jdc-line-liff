const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 掃描站的身分接線測試（2026-09-02，第三階段 Task 5）。
 *
 * 為何存在：`staff.html` 有 27 處以員編為鍵，這次全部換成內部碼。純函式測試證明不了
 * 它們有沒有真的接上——**漏改的每一種都零錯誤訊息**：
 *   - 佇列帶錯欄位 → 送出成功、卻從佇列移不掉 ⇒ 每 15 秒重送一次，永遠不停
 *   - 反查索引帶錯鍵 → 桌次一律顯示「臨時出席」，而人明明在名單上
 *   - 示範模式的假資料沒跟著換 → 承辦人唯一的練習管道整個壞掉
 *
 * 手法沿用 staff-loop-wiring：抽 staff.html 的原始碼下來跑，配最小替身，不另抄一份等價的。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8');
function fnSrc(name) {
  // ⚠️ `async function` 也要吃得下——第一版只寫 `^function`，抽不到 buildDemoSnapshot／
  //    flush／handle 三支，而症狀是「11 條全紅、訊息說找不到函式」。
  //    幸好它是紅的；如果抽取器悄悄抓到別的東西，這一整支測試就會變成空包彈。
  const m = HTML.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^\\}', 'm'));
  assert.ok(m, `staff.html 找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}
function varSrc(decl) {
  const m = HTML.match(new RegExp('^var ' + decl + '[\\s\\S]*?;$', 'm'));
  assert.ok(m, `staff.html 找不到 var ${decl}`);
  return m[0];
}

const scan = require('../assets/staff-scan.js');

/** 最小的 localStorage 替身（真 storage 的語意：只存字串）。 */
function fakeStorage(init) {
  const map = Object.assign({}, init);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    __map: map,
  };
}

function harness(opt) {
  opt = opt || {};
  const calls = { notes: [], cards: [], jget: [] };
  const ctx = {
    console, JSON, Date, Number, String, Object, Array, Promise, Math,
    localStorage: opt.storage || fakeStorage({}),
    DEMO: !!opt.DEMO,
    QKEY: 'q',
    SEEN_KEY: 'seen',
    TOKEN: 'tok',
    ACT: 'zzdemo2026',
    snapshot: {},
    nameTable: {},
    state: { seen: {}, queue: [] },
    ready: false,
    esc: (s) => String(s == null ? '' : s),
    show: () => {},
    note: (cls, text, sub) => calls.notes.push({ cls, text, sub }),
    personCard: (cls, label, p) => calls.cards.push({ cls, label, p }),
    flashFrame: () => {},
    holdThenIdle: () => {},
    resetPicker: () => {},
    confirm: () => true,
    navigator: {},
    updateQueueBadge: () => {},
    saveSeen: () => {},
    seenMerge: scan.seenMerge,
    sha256Hex: scan.sha256Hex,
    parseChkCode: scan.parseChkCode,
    applyScan: scan.applyScan,
    chunkByLen: scan.chunkByLen,
    performance: { now: () => 0 },
    setTimeout: (f) => { void f; return 0; },
    document: { getElementById: () => ({ innerHTML: '', className: '', textContent: '' }) },
    jget: async (action, params) => { calls.jget.push({ action, params }); return opt.jgetRes; },
    flushing: false,
    lastSyncAt: '',
  };
  vm.createContext(ctx);
  vm.runInContext([
    varSrc('DEMO_CODES = \\['), varSrc('DEMO_PEOPLE = \\['),
    fnSrc('loadQueue'), fnSrc('saveQueue'),
    'var QUEUE_V = 2;',
    fnSrc('enqueue'), fnSrc('quarantineLegacyQueue'),
    fnSrc('rebuildEmpIndex'), fnSrc('tableOf'), fnSrc('isCheckedIn'),
    fnSrc('allPeople'), fnSrc('buildDemoSnapshot'), fnSrc('manualCheckin'),
    fnSrc('flush'), fnSrc('handle'),
    'var idToHash = {};',
  ].join('\n'), ctx, { filename: 'staff.html-extract' });
  ctx.calls = calls;
  return ctx;
}

/* ── ① 示範模式 ───────────────────────────────────────────────────────────── */

test('★示範模式：五張假 QR 各自對到一個人，桌次也查得到', async () => {
  // 漏改的症狀是示範模式整個壞掉——而那是承辦人唯一的練習管道，
  // 通常在活動前一晚才被打開，那時沒有人有空修。
  const ctx = harness({ DEMO: true });
  await ctx.buildDemoSnapshot();
  assert.equal(Object.keys(ctx.snapshot).length, 5, '五張碼要對到五個人，不是互相蓋掉');
  const people = Object.values(ctx.snapshot);
  assert.equal(new Set(people.map((p) => p.internalId)).size, 5);
  assert.equal(ctx.tableOf('JDC-DEMOAA'), '1');
  assert.equal(ctx.tableOf('JDC-DEMODD'), '主桌');
  assert.equal(ctx.tableOf('JDC-NOBODY'), '', '不在名單上的回空字串＝臨時出席');
});

test('★示範模式：假 QR 的第三格與假名單的內部碼一致（不一致就掃不進去）', async () => {
  const ctx = harness({ DEMO: true });
  await ctx.buildDemoSnapshot();
  for (const code of ctx.DEMO_CODES) {
    const p = scan.parseChkCode(code, 'zzdemo2026');
    assert.equal(p.ok, true);
    const h = await scan.sha256Hex(code);
    assert.ok(ctx.snapshot[h], '這張示範碼在快照裡查不到：' + code);
    assert.equal(ctx.snapshot[h].internalId, p.internalId,
      '碼裡的身分與快照裡的身分對不起來：' + code);
  }
});

/* ── ② 掃碼報到 ───────────────────────────────────────────────────────────── */

test('★掃碼報到：進佇列的是內部碼，而且帶格式版本 v', async () => {
  const ctx = harness({});
  ctx.snapshot = {};
  const qr = 'CHK|zzdemo2026|JDC-AAAAAA|sig';
  const h = await scan.sha256Hex(qr);
  ctx.snapshot[h] = { internalId: 'JDC-AAAAAA', name: '甲', unit: 'A部', table: '7', checked: false };
  ctx.rebuildEmpIndex();
  ctx.ready = true;

  await ctx.handle(qr, 0);
  const q = JSON.parse(ctx.localStorage.getItem('q'));
  assert.equal(q.length, 1, '掃成功卻沒有進佇列＝這個人的報到不會被寫進試算表');
  assert.equal(q[0].internalId, 'JDC-AAAAAA');
  assert.equal(q[0].v, 2, '沒有 v 的話，下一次換鑰匙時沒有人分得出這筆是舊是新');
  assert.equal(q[0].empNo, undefined, '舊欄名不可以還在');
  assert.equal(ctx.calls.cards[0].label, '已受理');
});

test('★掃碼報到：卡片上的桌次查得到（反查索引的鍵要跟快照一致）', async () => {
  const ctx = harness({});
  const qr = 'CHK|zzdemo2026|JDC-AAAAAA|sig';
  const h = await scan.sha256Hex(qr);
  ctx.snapshot[h] = { internalId: 'JDC-AAAAAA', name: '甲', unit: 'A部', table: '7', checked: false };
  ctx.rebuildEmpIndex();
  ctx.ready = true;
  await ctx.handle(qr, 0);
  assert.equal(ctx.tableOf(ctx.calls.cards[0].p.internalId), '7',
    '反查索引的鍵跟快照對不上，桌次會一律顯示「臨時出席」而人明明在名單上');
});

/* ── ③ 人工搜名報到 ───────────────────────────────────────────────────────── */

test('★人工搜名報到：進佇列的也是內部碼，方式標 manual', () => {
  const ctx = harness({});
  ctx.manualCheckin({ internalId: 'JDC-BBBBBB', name: '乙', unit: 'B部' });
  const q = JSON.parse(ctx.localStorage.getItem('q'));
  assert.equal(q.length, 1);
  assert.equal(q[0].internalId, 'JDC-BBBBBB');
  assert.equal(q[0].m, 'manual');
  assert.equal(q[0].v, 2);
});

test('★搜名名單：快照與名冊聯集，以內部碼去重，參加者優先（它才有桌次）', async () => {
  const ctx = harness({});
  const h = await scan.sha256Hex('x');
  ctx.snapshot[h] = { internalId: 'JDC-AAAAAA', name: '甲', unit: 'A部', table: '7' };
  ctx.nameTable = {
    甲: { internalId: 'JDC-AAAAAA', name: '甲', unit: '名冊寫的單位' },   // 重複，快照優先
    丙: { internalId: 'JDC-CCCCCC', name: '丙', unit: 'C部' },           // 只有名冊有
    無碼: { name: '無碼', unit: 'D部' },                                  // 沒有內部碼，不可報到
  };
  const list = ctx.allPeople();
  assert.equal(list.length, 2, '去重或聯集其中一邊壞了');
  const byId = {};
  list.forEach((p) => { byId[p.internalId] = p; });
  assert.equal(byId['JDC-AAAAAA'].unit, 'A部', '快照的資料要蓋過名冊的');
  assert.ok(byId['JDC-CCCCCC'], '只在名冊裡的人要進得了搜名名單（臨時出席走這條）');
});

/* ── ④ 送出成功後佇列真的變空 ─────────────────────────────────────────────── */

test('★送出成功後佇列真的變空（移除用的組合鍵要跟佇列項目一致）', async () => {
  // 🔴 這是這一組裡最惡性的一種：送出成功、後端也寫進去了，但組合鍵對不上
  //    ⇒ 從佇列移不掉 ⇒ 每 15 秒重送一次，永遠不會停，而畫面上待送筆數一直不歸零。
  // ⚠️ 不用 enqueue 來鋪資料：enqueue 內部會 fire-and-forget 呼叫 flush，
  //    兩次 enqueue 會跟這裡的 await flush 搶，測試變成競態（實測會偶發留下一筆）。
  //    佇列項目的形狀由上面②③兩條守著，這裡只驗「送出成功之後移不移得掉」。
  const storage = fakeStorage({
    q: JSON.stringify([
      { v: 2, internalId: 'JDC-AAAAAA', ts: 1, m: 'scan' },
      { v: 2, internalId: 'JDC-BBBBBB', ts: 2, m: 'manual' },
    ]),
  });
  const ctx = harness({ storage,
    jgetRes: { ok: true, written: 2, allChecked: ['JDC-AAAAAA', 'JDC-BBBBBB'] } });
  assert.equal(JSON.parse(ctx.localStorage.getItem('q')).length, 2, '前置條件：先要有兩筆');

  await ctx.flush();
  assert.deepEqual(JSON.parse(ctx.localStorage.getItem('q')), [],
    '送出成功卻移不掉＝無限重送。剩下的是：' + ctx.localStorage.getItem('q'));
});

test('★後端丟掉的列要講出來，不可以靜靜吞掉', async () => {
  const storage = fakeStorage({ q: JSON.stringify([{ v: 2, internalId: 'JDC-AAAAAA', ts: 1, m: 'scan' }]) });
  const ctx = harness({ storage, jgetRes: { ok: true, written: 1, rejected: 2, allChecked: [] } });
  await ctx.flush();
  const msg = ctx.calls.notes.map((n) => n.text).join('｜');
  assert.match(msg, /2 筆/, '後端說它丟了 2 筆，畫面上要看得到。實際訊息：' + msg);
});

test('對照組：後端回失敗時佇列原封不動（證明上面那條測的是「成功才移除」）', async () => {
  const storage = fakeStorage({ q: JSON.stringify([{ v: 2, internalId: 'JDC-AAAAAA', ts: 1, m: 'scan' }]) });
  const ctx = harness({ storage, jgetRes: { ok: false, msg: '系統忙碌' } });
  await ctx.flush();
  assert.equal(JSON.parse(ctx.localStorage.getItem('q')).length, 1,
    '失敗還把佇列清掉＝那個人的報到永遠不會被寫進去');
});

/* ── ⑤ 舊格式佇列：隔離、不丟、講一句 ─────────────────────────────────────── */

test('★舊格式（v1，帶員編）的殘留：挑出來、留著、在畫面上講一句', () => {
  const storage = fakeStorage({
    q: JSON.stringify([
      { empNo: '00011', ts: 1, m: 'scan' },                    // 舊格式：沒有 v
      { v: 1, empNo: '00012', ts: 2, m: 'scan' },              // 舊格式：v 太小
      { v: 2, internalId: 'JDC-AAAAAA', ts: 3, m: 'scan' },    // 新格式
    ]),
  });
  const ctx = harness({ storage });
  const n = ctx.quarantineLegacyQueue();
  assert.equal(n, 2);

  const left = JSON.parse(storage.getItem('q'));
  assert.equal(left.length, 1, '新格式的那筆要留在佇列裡繼續送');
  assert.equal(left[0].internalId, 'JDC-AAAAAA');

  const kept = JSON.parse(storage.getItem('q_v1'));
  assert.equal(kept.length, 2, '舊的要被留著——丟掉等於「有人報到過但紀錄不見了」');

  const msg = ctx.calls.notes.map((n2) => n2.text).join('｜');
  assert.match(msg, /2 筆舊格式/, '要在畫面上講一句，不然沒有人知道。實際訊息：' + msg);
});

test('對照組：佇列全是新格式時，一句話都不會多講', () => {
  const storage = fakeStorage({
    q: JSON.stringify([{ v: 2, internalId: 'JDC-AAAAAA', ts: 1, m: 'scan' }]),
  });
  const ctx = harness({ storage });
  assert.equal(ctx.quarantineLegacyQueue(), 0);
  assert.equal(ctx.calls.notes.length, 0, '正常情況不該有任何訊息——會吵的告警會被訓練成無視');
  assert.equal(JSON.parse(storage.getItem('q')).length, 1);
});
