const { test } = require('node:test');
const assert = require('node:assert');
const { CHK_PREFIX, CHK_LEGACY_PREFIXES, UNKNOWN_STREAK_HINT,
        parseChkCode, sha256Hex, applyScan, chunkByLen, searchNames,
        seenLoad, seenSave, seenMerge, shouldHandleCode,
        shouldScanNow, scanCanvasSize, SCAN_INTERVAL_MS, SCAN_MAX_W } = require('../assets/staff-scan.js');

test('parseChkCode：格式正確回內部碼', () => {
  assert.deepEqual(parseChkCode('CHK2|nendkai2026|JDC-NPQRST|abc123', 'nendkai2026'),
    { ok: true, internalId: 'JDC-NPQRST', legacy: false });
});

test('🔴CHK_PREFIX 的字面值就是跨 repo 契約（另一端是 gas 的 CHECKIN_CODE_PREFIX）', () => {
  // 兩個 repo 各自宣告一份、沒有共用層。這條釘住這一端的字面值，
  // 另一端由 jdc-line-gas 的 event-checkin.test.js 釘住同一個字串。
  // 分歧的症狀是「全場都掃不進去」——吵、看得見，所以接受這份重複。
  assert.equal(CHK_PREFIX, 'CHK2');
  assert.deepEqual(CHK_LEGACY_PREFIXES, ['CHK']);
  assert.equal(CHK_LEGACY_PREFIXES.indexOf(CHK_PREFIX), -1,
    '當下這一版跑進舊前綴清單＝每一張新碼都會被說成「舊版報到碼」');
});

test('🔴parseChkCode：舊前綴不判 format，要標 legacy 往下走', () => {
  // **這條就是「舊碼」與「查無此人」分得開的第一步。**
  // 舊寫法 `parts[0] !== 'CHK' → format` 之下，員編版舊碼是 ok（前綴一樣），
  // 一路走到雜湊才失敗、落進 unknown，畫面與陌生人的碼一字不差。
  //
  // ⚠️ 這裡回 ok:true 不是放行——真正的判定仍在雜湊。刻意「先查快照、查不到才問版本」，
  //    所以前端先上線、後端還在發舊碼的那 1–2 分鐘，舊碼仍然掃得進去，不會斷。
  const r = parseChkCode('CHK|nendkai2026|00011|abc123', 'nendkai2026');
  assert.equal(r.ok, true, '舊前綴被判成 format 的話，畫面會說「無法辨識的碼」而不是「舊版」');
  assert.equal(r.legacy, true);
  assert.equal(r.internalId, '00011', '第三格照原樣取出——不猜它是員編還是內部碼');
});

test('🔴parseChkCode：當下這一版不可以被標成 legacy', () => {
  // 對照組。少了它，「legacy 恆為 true」也會讓上面那條通過，
  // 而現場的每一張新碼都會被說成「這是舊版的報到碼」。
  assert.equal(parseChkCode('CHK2|a|JDC-NPQRST|sig', 'a').legacy, false);
});

test('parseChkCode：回傳的欄名必須是 internalId，不可以還叫 empNo', () => {
  // 這條擋的不是「值對不對」，是**名字騙人**：值換成內部碼了、欄名還留著叫員編，
  // 下一個讀的人會拿它去跟名冊的員編比對，而那永遠對不上、也不會報錯。
  const r = parseChkCode('CHK2|a|JDC-NPQRST|sig', 'a');
  assert.equal(r.internalId, 'JDC-NPQRST');
  assert.equal(r.empNo, undefined, '舊欄名不可以還存在——留著它等於兩種名字並存');
});

test('parseChkCode：活動不符拒絕', () => {
  assert.deepEqual(parseChkCode('CHK2|other2026|JDC-NPQRST|abc123', 'nendkai2026'),
    { ok: false, reason: 'wrongAct' });
});

test('parseChkCode：舊前綴＋別場活動，仍然先報 wrongAct（既有那條文案不被前綴吃掉）', () => {
  // 「這是別場活動的碼」2026-08-31 就在了。版本前綴不該把它吃掉——
  // 活動不符是比版本更具體的資訊，現場承辦人拿它才知道是「上一場的」。
  assert.equal(parseChkCode('CHK|other2026|00011|abc', 'nendkai2026').reason, 'wrongAct');
});

test('parseChkCode：不認得的前綴/欄數不對＝format', () => {
  assert.equal(parseChkCode('WIN|x|y|z', 'a').reason, 'format');
  assert.equal(parseChkCode('CHK3|a|b|c', 'a').reason, 'format', '還沒發明的版本也算不認得');
  assert.equal(parseChkCode('CHK2|only', 'a').reason, 'format');
  assert.equal(parseChkCode('CHK|only', 'a').reason, 'format');
  assert.equal(parseChkCode('', 'a').reason, 'format');
});

test('UNKNOWN_STREAK_HINT：是個具名門檻，且落在講得出理由的範圍', () => {
  // 不釘死成 3——現場回報會讓它調整（判準寫在 staff-scan.js 那支常數的標頭）。
  // 釘的是「它存在、是數字、而且不是 1」：設成 1 等於第一個訪客就誣賴系統。
  assert.equal(typeof UNKNOWN_STREAK_HINT, 'number');
  assert.ok(UNKNOWN_STREAK_HINT >= 2 && UNKNOWN_STREAK_HINT <= 6,
    '超出這個範圍就不是「偶發 vs 系統」的判斷了：實際值 ' + UNKNOWN_STREAK_HINT);
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
  const snap = {}; snap[h] = { empNo: '002', name: '呂華', unit: '施工部', table: '1', checked: true };
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
  const t = { '王大明':{empNo:'1',name:'王大明',unit:'A'}, '呂小文':{empNo:'2',name:'呂小文',unit:'B'} };
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

// ── 停留期間該不該吃這張碼（2026-08-21，修一個我自己引入的靜默失敗）──────────
// 原本寫成「停留期間整個不讀影格」，於是 3 秒內下一位的碼被丟掉、畫面毫無反應。
// 操作員沒盯著螢幕就會以為掃過了走人——那個人沒報到，也沒有任何地方留下痕跡。

const HOLD_END = 10000;   // 假設停留到 t=10000

test('停留中：不同的碼要放行——下一位到了就該立刻接手', () => {
  assert.equal(shouldHandleCode('CHK|a|00002|s', 'CHK|a|00001|s', 9000, HOLD_END, 9500), true);
});

test('停留中：同一張碼要略過——人還站在鏡頭前，不該重複觸發', () => {
  assert.equal(shouldHandleCode('CHK|a|00001|s', 'CHK|a|00001|s', 9000, HOLD_END, 9500), false);
});

test('沒解到碼一律不處理（空字串／null 都是）', () => {
  assert.equal(shouldHandleCode('', 'x', 0, 0, 5000), false);
  assert.equal(shouldHandleCode(null, 'x', 0, 0, 5000), false);
});

test('不在停留中：同一張碼未滿 2.5 秒仍擋（原有的防連發沒被改壞）', () => {
  assert.equal(shouldHandleCode('CHK|a|00001|s', 'CHK|a|00001|s', 9000, 0, 11000), false);
});

test('不在停留中：同一張碼超過 2.5 秒放行（重掃要看得到已報到過）', () => {
  assert.equal(shouldHandleCode('CHK|a|00001|s', 'CHK|a|00001|s', 9000, 0, 11600), true);
});

test('對照組：把「停留中一律不讀」的舊行為寫出來，跟現行必須不同', () => {
  const 舊行為 = (data, lastText, lastAt, holdUntil, now) =>
    now < holdUntil ? false : !!data && (data !== lastText || now - lastAt > 2500);
  const 下一位 = ['CHK|a|00002|s', 'CHK|a|00001|s', 9000, HOLD_END, 9500];
  assert.equal(舊行為(...下一位), false, '舊行為會吞掉下一位');
  assert.equal(shouldHandleCode(...下一位), true, '現行必須放行——這一條就是修正本身');
});

// ── 掃描節流與解碼縮圖（2026-08-21）───────────────────────────────────────
// 實測：全解析度 + 無節流 ＝ 每秒 546ms 的 JS 工作，手機持續滿載、發燙耗電。

test('節流：間隔未到不解碼', () => {
  assert.equal(shouldScanNow(1000, 950, 80), false);
});

test('節流：間隔到了就解碼（用 >= 而非 >，剛好等於也算）', () => {
  assert.equal(shouldScanNow(1080, 1000, 80), true);
  assert.equal(shouldScanNow(1079, 1000, 80), false);
});

test('節流：開頁第一格一定放行——lastScanAt=0 配真實的 epoch 時間', () => {
  // ⚠️ 這裡要用真實的 Date.now() 量級。第一版我寫 shouldScanNow(1, 0, 80) 而它回 false，
  // 但那個情境在瀏覽器不存在（now 恆為一兆多的 epoch，減 0 必然遠大於 80）。
  // 拿不實際的測資去逼程式加一條永遠走不到的分支，是把測試的假設寫進產品裡。
  assert.equal(shouldScanNow(Date.now(), 0, 80), true);
});

test('節流：預設間隔換算下來要落在 10–20 次/秒（太密沒必要、太疏會漏掃）', () => {
  const fps = 1000 / SCAN_INTERVAL_MS;
  assert.ok(fps >= 10 && fps <= 20, `實際 ${fps} 次/秒`);
});

test('縮圖：超過上限就等比縮，長寬比不變（壓扁的 QR 解不出來）', () => {
  const r = scanCanvasSize(1280, 720, 640);
  assert.deepEqual(r, { w: 640, h: 360 });
});

test('縮圖：相機本來就比上限小就照原樣，不放大', () => {
  assert.deepEqual(scanCanvasSize(480, 360, 640), { w: 480, h: 360 });
});

test('縮圖：直式畫面也要維持比例', () => {
  assert.deepEqual(scanCanvasSize(720, 1280, 640), { w: 640, h: 1138 });
});

test('縮圖：影格還沒準備好（0 或 NaN）回 0，呼叫端據此整格略過', () => {
  assert.deepEqual(scanCanvasSize(0, 0, 640), { w: 0, h: 0 });
  assert.deepEqual(scanCanvasSize(undefined, undefined, 640), { w: 0, h: 0 });
});

test('對照組：預設上限確實會讓 1280 被縮小，否則上面的縮圖測試等於沒測', () => {
  assert.ok(SCAN_MAX_W < 1280);
  assert.equal(scanCanvasSize(1280, 720).w, SCAN_MAX_W);
});
