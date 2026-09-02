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
    // 2026-09-02（外審 #5）：後端改成逐列回 writtenKeys，前端只移除真的寫進去的那幾列。
    flushing: false,
    lastSyncAt: '',
  };
  vm.createContext(ctx);
  // 共用模組載真貨，不 stub——這幾支正是「兩張頁面對同一件事給同一個答案」的那份判斷。
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'partial-failure.js'), 'utf8'),
                  ctx, { filename: 'partial-failure.js' });
  vm.runInContext([
    varSrc('DEMO_CODES = \\['), varSrc('DEMO_PEOPLE = \\['),
    fnSrc('readQueue'), fnSrc('loadQueue'), fnSrc('saveQueue'),
    fnSrc('quarantineRawQueue'), fnSrc('commitCheckin'),
    'var QUEUE_V = 2;',
    fnSrc('enqueue'), fnSrc('quarantineLegacyQueue'),
    fnSrc('rebuildEmpIndex'), fnSrc('tableOf'), fnSrc('isCheckedIn'),
    fnSrc('allPeople'), fnSrc('buildDemoSnapshot'), fnSrc('manualCheckin'),
    fnSrc('flush'), fnSrc('handle'), fnSrc('applySnapshotPayload'),
    fnSrc('updateQueueBadge'), fnSrc('quarantineRows'), fnSrc('quarantinedCount'),
    fnSrc('renderSkipped'),
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
  assert.equal(ctx.tableOf('JDC-DMBCDF'), '1');
  assert.equal(ctx.tableOf('JDC-DMRSTV'), '主桌');
  assert.equal(ctx.tableOf('JDC-NBDYZB'), '', '不在名單上的回空字串＝臨時出席');
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
  const qr = 'CHK|zzdemo2026|JDC-HJKMNP|sig';
  const h = await scan.sha256Hex(qr);
  ctx.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7', checked: false };
  ctx.rebuildEmpIndex();
  ctx.ready = true;

  await ctx.handle(qr, 0);
  const q = JSON.parse(ctx.localStorage.getItem('q'));
  assert.equal(q.length, 1, '掃成功卻沒有進佇列＝這個人的報到不會被寫進試算表');
  assert.equal(q[0].internalId, 'JDC-HJKMNP');
  assert.equal(q[0].v, 2, '沒有 v 的話，下一次換鑰匙時沒有人分得出這筆是舊是新');
  assert.equal(q[0].empNo, undefined, '舊欄名不可以還在');
  assert.equal(ctx.calls.cards[0].label, '已受理');
});

test('★掃碼報到：卡片上的桌次查得到（反查索引的鍵要跟快照一致）', async () => {
  const ctx = harness({});
  const qr = 'CHK|zzdemo2026|JDC-HJKMNP|sig';
  const h = await scan.sha256Hex(qr);
  ctx.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7', checked: false };
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
  ctx.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7' };
  ctx.nameTable = {
    甲: { internalId: 'JDC-HJKMNP', name: '甲', unit: '名冊寫的單位' },   // 重複，快照優先
    丙: { internalId: 'JDC-CCCCCC', name: '丙', unit: 'C部' },           // 只有名冊有
    無碼: { name: '無碼', unit: 'D部' },                                  // 沒有內部碼，不可報到
  };
  const ap = ctx.allPeople();
  assert.equal(ap.people.length, 2, '去重或聯集其中一邊壞了');
  assert.deepEqual(ap.collisions, [],
    '同一個人在快照與名冊各出現一次不是碰撞——把他判成碰撞會讓整份名單清空');
  const byId = {};
  ap.people.forEach((p) => { byId[p.internalId] = p; });
  assert.equal(byId['JDC-HJKMNP'].unit, 'A部', '快照的資料要蓋過名冊的');
  assert.ok(byId['JDC-CCCCCC'], '只在名冊裡的人要進得了搜名名單（臨時出席走這條）');
});

test('🔴★★兩個人共用一個內部碼 → 兩個都不進搜名名單，而且要具名講出來', () => {
  // 外審第五輪（同一形狀第三次）：舊寫法 first-write-wins ⇒ 後到的那個人
  // **在門口完全找不到**，而替留下的那位報到，寫進去的是一個指不出人的共享碼。
  // 挑任何一個都是猜，猜錯的後果是把 A 的報到記成 B。
  const ctx = harness({});
  ctx.nameTable = {
    甲: { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部' },
    乙: { internalId: 'JDC-HJKMNP', name: '乙', unit: 'B部' },   // 同碼、不同人
    丙: { internalId: 'JDC-CCCCCC', name: '丙', unit: 'C部' },
  };
  const ap = ctx.allPeople();
  assert.deepEqual(ap.people.map((p) => p.internalId), ['JDC-CCCCCC'],
    '碰撞的碼還留在名單裡＝有人會被當成另一個人報到');
  assert.equal(ap.collisions.length, 2, '兩個人都要具名，不是只講一句「有碰撞」');
  const names = ap.collisions.map((x) => x.name).sort();
  assert.deepEqual(names, ['乙', '甲']);
  assert.match(ap.collisions[0].why, /重複/);
});

test('★碰撞的人要出現在畫面上那塊展開區（不可以靜靜地少）', () => {
  // 拿掉他們是對的，**不講**就是靜默漏人——門口的人只會覺得「名單裡沒有這個人」。
  const r = renderSnapVer({ unusable: 0 }, {
    甲: { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部' },
    乙: { internalId: 'JDC-HJKMNP', name: '乙', unit: 'B部' },
  });
  assert.match(r.skip, /甲/, '實際：' + JSON.stringify(r.skip));
  assert.match(r.skip, /乙/);
  assert.match(r.skip, /重複/);
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
      { v: 2, internalId: 'JDC-HJKMNP', ts: 1, m: 'scan' },
      { v: 2, internalId: 'JDC-BBBBBB', ts: 2, m: 'manual' },
    ]),
  });
  const ctx = harness({ storage,
    jgetRes: { ok: true, written: 2, allChecked: ['JDC-HJKMNP', 'JDC-BBBBBB'] } });
  assert.equal(JSON.parse(ctx.localStorage.getItem('q')).length, 2, '前置條件：先要有兩筆');

  await ctx.flush();
  assert.deepEqual(JSON.parse(ctx.localStorage.getItem('q')), [],
    '送出成功卻移不掉＝無限重送。剩下的是：' + ctx.localStorage.getItem('q'));
});

/* 🔴 外審第三輪 #5：`ok:true` 只代表**請求完成**，不代表每一列都寫進試算表。
   舊寫法把整包移除 ⇒ 被拒絕的列連同被刪掉 ⇒ **那個人報到了、紀錄不見了、佇列也清了**，
   三個地方都查不到他。實測過。這是資料遺失，不是顯示問題。 */

test('🔴★後端只寫了一列時，另一列不可以被刪掉——要進隔離區', () => {
  const storage = fakeStorage({
    q: JSON.stringify([
      { v: 2, internalId: 'JDC-BCDFGH', ts: 1, m: 'scan' },
      { v: 2, internalId: 'JDC-JKMNPQ', ts: 2, m: 'scan' },
    ]),
  });
  const ctx = harness({ storage,
    jgetRes: { ok: true, written: 1, rejected: 1,
               writtenKeys: ['JDC-BCDFGH|1'], allChecked: ['JDC-BCDFGH'] } });
  return ctx.flush().then(() => {
    assert.deepEqual(JSON.parse(storage.getItem('q')), [], '寫進去的與已隔離的都該離開主佇列');
    const kept = JSON.parse(storage.getItem('q_rejected') || '[]');
    assert.equal(kept.length, 1, '沒寫進去的那列必須留著——刪了就永遠沒了');
    assert.equal(kept[0].internalId, 'JDC-JKMNPQ');
    const msg = ctx.calls.notes.map((n) => n.text).join('｜');
    assert.match(msg, /1 筆後端沒有寫入/, '實際訊息：' + msg);
  });
});

test('🔴★隔離也失敗時，那幾列要留在主佇列——不可以兩邊都沒有', () => {
  // 留著至少還在，刪掉就永遠沒了。
  const store = { q: JSON.stringify([{ v: 2, internalId: 'JDC-JKMNPQ', ts: 2, m: 'scan' }]) };
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (k === 'q_rejected') throw new Error('QuotaExceededError'); store[k] = String(v); },
  };
  const ctx = harness({ storage, jgetRes: { ok: true, written: 0, writtenKeys: [], allChecked: [] } });
  return ctx.flush().then(() => {
    assert.equal(JSON.parse(store.q).length, 1, '隔離失敗還把它從主佇列刪掉＝兩邊都沒有了');
  });
});

test('對照組：後端把整包都寫進去時，主佇列清空、隔離區是空的', () => {
  const storage = fakeStorage({
    q: JSON.stringify([{ v: 2, internalId: 'JDC-BCDFGH', ts: 1, m: 'scan' }]),
  });
  const ctx = harness({ storage,
    jgetRes: { ok: true, written: 1, writtenKeys: ['JDC-BCDFGH|1'], allChecked: [] } });
  return ctx.flush().then(() => {
    assert.deepEqual(JSON.parse(storage.getItem('q')), []);
    assert.equal(storage.getItem('q_rejected'), null, '正常情況不該產生隔離區');
  });
});

test('★後端丟掉的列要講出來，而且那幾列要留著（不只是講一句）', async () => {
  // ⚠️ 這條的第一版**只斷言訊息裡有數字**，完全不驗那幾列還在不在——
  // 它的名字宣稱守「不可吞掉」，實際只守「有印一句話」。外審第三輪點出來的。
  // 這一輪第三次撞到「測試的名字不等於它實際讀的東西」。
  const storage = fakeStorage({
    q: JSON.stringify([
      { v: 2, internalId: 'JDC-HJKMNP', ts: 1, m: 'scan' },
      { v: 2, internalId: 'JDC-JKMNPQ', ts: 2, m: 'scan' },
    ]),
  });
  const ctx = harness({ storage,
    jgetRes: { ok: true, written: 1, rejected: 1,
               writtenKeys: ['JDC-HJKMNP|1'], allChecked: [] } });
  await ctx.flush();

  const msg = ctx.calls.notes.map((n) => n.text).join('｜');
  assert.match(msg, /1 筆後端沒有寫入/, '要講出來。實際訊息：' + msg);

  // 🔴 真正該守的：那一列還在不在
  const kept = JSON.parse(storage.getItem('q_rejected') || '[]');
  assert.equal(kept.length, 1, '講了一句但資料沒了＝還是吞掉了');
  assert.equal(kept[0].internalId, 'JDC-JKMNPQ');
});

test('對照組：後端回失敗時佇列原封不動（證明上面那條測的是「成功才移除」）', async () => {
  const storage = fakeStorage({ q: JSON.stringify([{ v: 2, internalId: 'JDC-HJKMNP', ts: 1, m: 'scan' }]) });
  const ctx = harness({ storage, jgetRes: { ok: false, msg: '系統忙碌' } });
  await ctx.flush();
  assert.equal(JSON.parse(ctx.localStorage.getItem('q')).length, 1,
    '失敗還把佇列清掉＝那個人的報到永遠不會被寫進去');
});

/* ── 後端跳過的人要一直看得到 ─────────────────────────────────────────────── */

function renderSnapVer(res, nameTable) {
  let text = '';
  const els = { snapskip: { innerHTML: '' } };
  const ctx = harness({});
  ctx.setTopbar = () => {};
  ctx.esc = (s) => String(s == null ? '' : s);
  // buildPicker 給真貨——碰撞是它算出來的，stub 掉就測不到那條路。
  ctx.jdcGroupedOptions = () => '';
  // ⚠️ 不能設 ctx.nameTable——applySnapshotPayload 第一件事就是用 res.nameTable 蓋掉它。
  //    要從 payload 進去，才是生產路徑走的那條。
  ctx.document = { getElementById: (id) => els[id]
    || ({ set textContent(v) { text = v; }, innerHTML: '' }) };
  vm.runInContext([fnSrc('applySnapshotPayload'), fnSrc('buildPicker'),
                   'var peopleByUnit = {};'].join('\n'),
                  ctx, { filename: 'staff.html-extract' });
  ctx.applySnapshotPayload(Object.assign({ snapshot: {}, nameTable: nameTable || {},
                                           snapshotVersion: 1,
                                           generatedAt: '2026-09-02 10:00' }, res));
  return { text: text, skip: els.snapskip.innerHTML };
}

test('★後端說它跳過了 N 個人，畫面上要一直看得到（不是閃一下的訊息）', () => {
  // 這幾個人現場一定掃不進去，而掃描站是唯一看得到這件事的地方。
  // 用 note() 的話會被下一次判定卡蓋掉；長駐在名單版本那一行才留得住。
  const t = renderSnapVer({ unusable: 3 }).text;
  assert.match(t, /3 人/, '實際文字：' + t);
  assert.match(t, /無法掃碼/);
});

test('★★接線：applySnapshotPayload 要真的把清單交給 renderSkipped', () => {
  // 🔴 為何是分開的一條：另一支測試直接呼叫 renderSkipped，**繞過了這個接縫**。
  // 把 applySnapshotPayload 裡那一行拿掉，那支測試照樣全綠——實測過。
  // 門口的人看得到什麼，取決於這一行有沒有被呼叫，不是那支函式寫得對不對。
  const r = renderSnapVer({ unusable: 2, skippedPeople: [
    { name: '乙', unit: 'A部', internalId: '', why: '缺內部碼' },
    { name: '丙', unit: 'B部', internalId: 'JDC-JKMNPQ', why: '名冊查無此碼' },
  ] });
  assert.match(r.skip, /丙/, '展開區沒有內容＝接線斷了。實際：' + JSON.stringify(r.skip));
  assert.match(r.skip, /名冊查無此碼/);
  assert.match(r.text, /2 人/, '數字那一行也要留著');
});

test('對照組：正常情況（0 人）一個字都不多——會吵的告警會被訓練成無視', () => {
  const r0 = renderSnapVer({ unusable: 0 });
  assert.equal(r0.text, '名單版本：2026-09-02 10:00');
  assert.equal(r0.skip, '', '沒有人被跳過卻長出一個展開區＝下次沒有人會點它');
  assert.equal(renderSnapVer({}).text, '名單版本：2026-09-02 10:00', '後端沒回這個欄位也不可以吵');
});

/* ── ⑤ 舊格式佇列：隔離、不丟、講一句 ─────────────────────────────────────── */

test('★舊格式（v1，帶員編）的殘留：挑出來、留著、在畫面上講一句', () => {
  const storage = fakeStorage({
    q: JSON.stringify([
      { empNo: '00011', ts: 1, m: 'scan' },                    // 舊格式：沒有 v
      { v: 1, empNo: '00012', ts: 2, m: 'scan' },              // 舊格式：v 太小
      { v: 2, internalId: 'JDC-HJKMNP', ts: 3, m: 'scan' },    // 新格式
    ]),
  });
  const ctx = harness({ storage });
  const n = ctx.quarantineLegacyQueue();
  assert.equal(n, 2);

  const left = JSON.parse(storage.getItem('q'));
  assert.equal(left.length, 1, '新格式的那筆要留在佇列裡繼續送');
  assert.equal(left[0].internalId, 'JDC-HJKMNP');

  const kept = JSON.parse(storage.getItem('q_v1'));
  assert.equal(kept.length, 2, '舊的要被留著——丟掉等於「有人報到過但紀錄不見了」');

  // 🔴 外審第二輪 C：這句原本用 note() 講，而 note() 是判定卡——開頁流程接著就被
  // loadSnapshot 的「名單載入中」蓋掉，工作人員來不及看到。改成長駐在佇列徽章上。
  let badge = '';
  ctx.document = { getElementById: () => ({ set innerHTML(v) { badge = v; }, set className(v) {} }) };
  ctx.updateQueueBadge();
  assert.match(badge, /2<\/span> 筆送不出去/,
    '筆數要長駐在徽章上。實際內容：' + badge);
  assert.match(badge, /工務管理組/, '要講出該找誰');
});

/* 🔴 外審第三輪 #2：那個數字原本存在模組變數裡（本次移出幾筆）
   ⇒ **第二次開頁時它是 0**，隔離區明明還有資料而畫面一個字都不說。
   訊息只在「發生的當下」存在，而現場的人多半不是在那一刻看畫面的。 */

test('🔴★重新開頁後，隔離區的筆數仍然看得到（數字要從 storage 讀）', () => {
  const storage = fakeStorage({ q: '[]', q_v1: JSON.stringify([{ empNo: '00011', ts: 1 }]) });
  const ctx = harness({ storage });
  ctx.quarantineLegacyQueue();   // 第二次開頁：主佇列已無舊格式，這支會回 0
  let badge = '';
  ctx.document = { getElementById: () => ({ set innerHTML(v) { badge = v; }, set className(v) {} }) };
  ctx.updateQueueBadge();
  assert.match(badge, /1<\/span> 筆送不出去/,
    '重載後就不講了＝那批資料從此沒有人知道。實際內容：' + badge);
});

test('🔴★備份寫不進去時，舊格式那幾列要留在主佇列——不可以兩邊都沒有', () => {
  // 原本是 try{寫備份}catch(_){} 然後**無條件**移除主佇列
  // ⇒ 備份失敗時那幾列同時不在主佇列、也不在備份。實測過。
  const store = { q: JSON.stringify([{ empNo: '00011', ts: 1, m: 'scan' }]) };
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (k === 'q_v1') throw new Error('QuotaExceededError'); store[k] = String(v); },
  };
  const ctx = harness({ storage });
  const n = ctx.quarantineLegacyQueue();
  assert.equal(n, 0, '沒有真的搬走就不可以回報搬走了幾筆');
  assert.equal(JSON.parse(store.q).length, 1, '搬不走就要留著——留著至少還在');
  const msg = ctx.calls.notes.map((x) => x.text).join('｜');
  assert.match(msg, /無法備份/, '要講出來。實際訊息：' + msg);
});

test('對照組：沒有舊格式時，徽章一個字都不多（會吵的告警會被訓練成無視）', () => {
  const storage = fakeStorage({
    q: JSON.stringify([{ v: 2, internalId: 'JDC-HJKMNP', ts: 1, m: 'scan' }]),
  });
  const ctx = harness({ storage });
  let badge = '';
  ctx.document = { getElementById: () => ({ set innerHTML(v) { badge = v; }, set className(v) {} }) };
  ctx.quarantineLegacyQueue();
  ctx.updateQueueBadge();
  assert.ok(badge.indexOf('舊格式') < 0, '實際內容：' + badge);
});

test('對照組：佇列全是新格式時，一句話都不會多講', () => {
  const storage = fakeStorage({
    q: JSON.stringify([{ v: 2, internalId: 'JDC-HJKMNP', ts: 1, m: 'scan' }]),
  });
  const ctx = harness({ storage });
  assert.equal(ctx.quarantineLegacyQueue(), 0);
  assert.equal(ctx.calls.notes.length, 0, '正常情況不該有任何訊息——會吵的告警會被訓練成無視');
  assert.equal(JSON.parse(storage.getItem('q')).length, 1);
  let badge = '';
  ctx.document = { getElementById: () => ({ set innerHTML(v) { badge = v; }, set className(v) {} }) };
  ctx.updateQueueBadge();
  assert.ok(badge.indexOf('送不出去') < 0, '徽章也不該多講。實際內容：' + badge);
});

/* ══ A1／A2：入列成功才可以說「已受理」，讀不到不可以當成沒有 ══════════════
   2026-09-02 自查。兩件是同一條路上的兩處，一起修、一起測：
   A1＝`loadQueue` 壞 JSON 回 []，而呼叫端讀-改-寫 ⇒ 整份待送報到被覆蓋消滅
   A2＝掃碼路徑「先顯示綠燈 → saveSeen → enqueue」，寫入失敗時
       操作員看到綠燈、seen 已落地、那筆從未進佇列
       ⇒ 這個人永遠不會被記錄，而系統會堅稱他報到過。 */

/** 寫入會失敗的 storage：setItem 靜靜不寫（配額滿在某些瀏覽器就是這個樣子，不拋錯）。 */
function brokenStorage(init, failKeyPrefix) {
  const s = fakeStorage(init);
  const realSet = s.setItem;
  s.setItem = (k, v) => { if (String(k).indexOf(failKeyPrefix) === 0) return; realSet(k, v); };
  return s;
}

test('★readQueue：「本來就沒有」與「讀不到」要分得開', () => {
  const ctx = harness({ storage: fakeStorage({}) });
  assert.deepEqual(ctx.readQueue(), { ok: true, rows: [] }, '沒有這個鍵＝真的沒有東西');
  ctx.localStorage.setItem('q', '');
  assert.equal(ctx.readQueue().ok, true, '空字串也是「真的沒有」');
  ctx.localStorage.setItem('q', '{壞掉的 JSON');
  assert.equal(ctx.readQueue().ok, false, '解析不出來卻說 ok＝呼叫端會拿空陣列蓋掉它');
  ctx.localStorage.setItem('q', '{"not":"array"}');
  assert.equal(ctx.readQueue().ok, false, '不是陣列也算讀不到');
});

test('🔴★A1：佇列讀不到時，原始值要先留一份，不可以直接被蓋掉', () => {
  const storage = fakeStorage({ q: '[{"v":2,"internalId":"JDC-HJKMNP"' });   // 截斷的 JSON
  const ctx = harness({ storage, jgetRes: { ok: true, writtenKeys: [] } });
  assert.equal(ctx.enqueue('JDC-BCDFGH', 'scan'), true, '隔離成功後應該可以重新開始');
  const kept = storage.getItem('q_unreadable');
  assert.ok(kept && kept.indexOf('JDC-HJKMNP') >= 0,
    '讀不到的原始值沒有留下來＝那些人的報到永遠消失了。實際：' + JSON.stringify(kept));
  assert.equal(JSON.parse(storage.getItem('q')).length, 1, '新的那一筆要進得去');
});

test('🔴★A1：連隔離都失敗時，enqueue 要回 false 且不覆蓋原始值', () => {
  // 留著至少還在，蓋掉就永遠沒了——所以隔離不成功就整筆失敗。
  const storage = brokenStorage({ q: '[{壞掉' }, 'q_unreadable');
  const ctx = harness({ storage });
  assert.equal(ctx.enqueue('JDC-BCDFGH', 'scan'), false);
  assert.equal(storage.getItem('q'), '[{壞掉', '原始值被動過了＝兩邊都沒有');
});

test('🔴★A2：寫入失敗時，掃碼路徑不可以說「已受理」', async () => {
  const storage = brokenStorage({}, 'q');
  const ctx = harness({ storage });
  const h = await scan.sha256Hex('CHK|zzdemo2026|JDC-HJKMNP|SIG');
  ctx.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7' };
  ctx.ready = true;
  await ctx.handle('CHK|zzdemo2026|JDC-HJKMNP|SIG', 0);
  const okCards = ctx.calls.cards.filter((c) => c.cls === 'ok');
  assert.equal(okCards.length, 0,
    '沒存起來卻顯示綠燈＝操作員以為他報到了，而那筆從未進佇列。實際卡片：'
    + JSON.stringify(ctx.calls.cards.map((c) => c.label)));
  const bad = ctx.calls.notes.filter((n) => n.cls === 'bad');
  assert.equal(bad.length, 1, '也要真的講出來，不是靜靜地什麼都不做');
  assert.match(bad[0].text, /沒有存起來/);
});

test('🔴★A2：寫入失敗時 seen 要收回去——否則再掃一次會說「已報到過」', async () => {
  const storage = brokenStorage({}, 'q');
  const ctx = harness({ storage });
  const h = await scan.sha256Hex('CHK|zzdemo2026|JDC-HJKMNP|SIG');
  ctx.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7' };
  ctx.ready = true;
  await ctx.handle('CHK|zzdemo2026|JDC-HJKMNP|SIG', 0);
  assert.equal(!!ctx.state.seen[h], false,
    'seen 還記著他＝同一個謊換個地方講：再掃會被判「已報到過」，而他其實沒被記錄');
});

test('🔴★★兩條路徑（掃碼／手動）在寫入失敗時的行為必須一致', async () => {
  // 這一條綁兩個入口。分開各測一條的話，下次它們還是可以各自漂走
  // ——順序原本就是這樣漂掉的（掃碼先顯示、手動先入列）。
  const mk = () => brokenStorage({}, 'q');
  const c1 = harness({ storage: mk() });
  const h = await scan.sha256Hex('CHK|zzdemo2026|JDC-HJKMNP|SIG');
  c1.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7' };
  c1.ready = true;
  await c1.handle('CHK|zzdemo2026|JDC-HJKMNP|SIG', 0);

  const c2 = harness({ storage: mk() });
  c2.manualCheckin({ internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部' });

  const okOf = (c) => c.calls.cards.filter((x) => x.cls === 'ok').length;
  const badOf = (c) => c.calls.notes.filter((x) => x.cls === 'bad').length;
  assert.equal(okOf(c1), okOf(c2), '一條說已受理、另一條說失敗＝同一個判斷又分歧了');
  assert.equal(okOf(c1), 0, '兩條都不可以說已受理');
  assert.equal(badOf(c1), badOf(c2), '講不講出來也要一致');
  assert.equal(badOf(c1), 1);
});

test('對照組：寫得進去時兩條路徑都說「已受理」，且各自都真的入列了', async () => {
  // 沒有這條，上面那些也可能只是「它永遠說失敗」。
  const c1 = harness({ storage: fakeStorage({}), jgetRes: { ok: true, writtenKeys: [] } });
  const h = await scan.sha256Hex('CHK|zzdemo2026|JDC-HJKMNP|SIG');
  c1.snapshot[h] = { internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', table: '7' };
  c1.ready = true;
  await c1.handle('CHK|zzdemo2026|JDC-HJKMNP|SIG', 0);
  assert.equal(c1.calls.cards.filter((x) => x.cls === 'ok').length, 1);
  assert.equal(!!c1.state.seen[h], true, '成功時 seen 要記著');

  const c2 = harness({ storage: fakeStorage({}), jgetRes: { ok: true, writtenKeys: [] } });
  c2.manualCheckin({ internalId: 'JDC-BCDFGH', name: '乙', unit: 'B部' });
  assert.equal(c2.calls.cards.filter((x) => x.cls === 'ok').length, 1);
  assert.equal(JSON.parse(c2.localStorage.getItem('q'))[0].internalId, 'JDC-BCDFGH');
});
