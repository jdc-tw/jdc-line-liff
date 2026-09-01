const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

/**
 * 舊碼掃到現場會怎樣（2026-09-02，第三階段 Task 6）。
 *
 * **這一支驗的是現況，不是新功能。** QR 的字串格式不變、前綴不變，所以「換鑰匙」
 * 這件事對舊碼的影響全部落在「第三格的值對不對上」。兩種舊碼走的是**不同的分支**，
 * 而現場承辦人能不能處理，完全取決於落在哪一支：
 *
 *   跨場次的舊碼（上一場的碼）  → wrongAct → 畫面「這是別場活動的碼」→ 看得懂
 *   同場次的員編舊碼            → unknown  → 畫面「無法辨識的碼」→ 跟陌生人的碼一樣
 *
 * 第二種是**已拍板接受的缺口**。接受的唯一理由是：部署時活動表裡沒有任何未來活動，
 * 所以沒有人手上會有那場的碼。使用者 2026-09-02 知情後選了這條（甲案）。
 *
 * ⚠️ Step 1 與 Step 3 要一起跑。只驗其中一個的話，把解析改成恆拒或恆放，都會有一半通過。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
/**
 * 從 html 抽一支具名函式的原始碼。
 * ⚠️ 要吃得下**縮排**：staff.html 的函式頂格，index.html 的在 <script> 裡縮四格。
 * 只寫 `^function` 的話對後者完全抓不到——幸好它是紅的，訊息也講得清楚；
 * 危險的是抽取器悄悄抓到別的東西，那會讓整支測試變成空包彈。
 */
function fnSrc(src, name, what) {
  const m = src.match(new RegExp(
    '^([ \\t]*)(?:async )?function ' + name + '\\([\\s\\S]*?^\\1\\}', 'm'));
  assert.ok(m, `${what} 找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

const scan = require('../assets/staff-scan.js');
const passCache = require('../assets/pass-cache.js');

const ACT = 'midyear2026';
const SECRET = 'sec';
const ID_A = 'JDC-BCDFGH';

/** 後端 signEventCheckinCode 的等價算式（event-checkin.js 與 token.js 的 hmac_）。 */
function sign(actId, identity, secret) {
  const body = 'CHK|' + actId + '|' + identity;
  return body + '|' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

/* ── Step 1／3：兩種舊碼各自落到哪個分支（必須一起跑）──────────────────── */

test('★Step 1：跨場次的舊碼 → wrongAct（跟陌生人的碼分得開）', () => {
  const old = sign('nendkai2025', ID_A, SECRET);        // 上一場的碼，身分是新的也一樣
  const r = scan.parseChkCode(old, ACT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrongAct');
});

test('★Step 3：同場次的員編舊碼 → unknown（已知接受的缺口）', async () => {
  // 接受理由＝部署前活動表裡沒有任何未來活動，所以沒有人手上會有這場的員編版碼。
  // 使用者 2026-09-02 知情後拍板（甲案）。這條測試存在是為了**把那個缺口寫在原地**，
  // 不是為了證明它沒問題——它有問題，只是我們接受了。
  const oldSameAct = sign(ACT, '00011', SECRET);        // 同一場、但第三格是員編
  const parsed = scan.parseChkCode(oldSameAct, ACT);
  assert.equal(parsed.ok, true, '格式與活動都對，所以它過得了 parse 這一關');

  const snap = {};
  snap[await scan.sha256Hex(sign(ACT, ID_A, SECRET))] =
    { internalId: ID_A, name: '甲', unit: 'A部', table: '1', checked: false };
  const hash = await scan.sha256Hex(oldSameAct);
  const out = scan.applyScan({ seen: {}, queue: [] }, hash, snap, Date.now());
  assert.equal(out.verdict.type, 'unknown',
    '它落在 unknown＝畫面顯示「無法辨識的碼」，跟一個陌生人的碼一模一樣');
});

/* ── Step 2：UI 文案要真的映射對（只斷言 verdict 不夠）──────────────────── */

function runHandle(text, snapshot) {
  const calls = { notes: [], cards: [] };
  const ctx = {
    console, JSON, Date, String, Object, Promise, Math,
    ACT, ready: true, DEMO: false,
    snapshot: snapshot || {}, state: { seen: {}, queue: [] },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    QKEY: 'q', QUEUE_V: 2,
    parseChkCode: scan.parseChkCode, sha256Hex: scan.sha256Hex, applyScan: scan.applyScan,
    note: (cls, t, sub) => calls.notes.push({ cls, t, sub }),
    personCard: (cls, label, p) => calls.cards.push({ cls, label, p }),
    flashFrame: () => {}, holdThenIdle: () => {}, saveSeen: () => {},
    enqueue: () => {}, navigator: {}, performance: { now: () => 0 },
    idToHash: {}, tableOf: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(HTML, 'handle', 'staff.html'), ctx, { filename: 'staff.html-extract' });
  return ctx.handle(text, 0).then(() => calls);
}

test('★Step 2：wrongAct 在畫面上是「這是別場活動的碼」，不是「查無此人」', async () => {
  // 只斷言 verdict 不夠：即使 html 把它錯映射成「無法辨識」，純函式測試仍然全綠。
  const calls = await runHandle(sign('nendkai2025', ID_A, SECRET));
  assert.equal(calls.notes.length, 1);
  assert.equal(calls.notes[0].t, '這是別場活動的碼');
});

test('★Step 2 對照組：格式壞掉的字串走另一句文案——證明兩種失敗分得開', () => {
  return runHandle('這根本不是 QR').then((calls) => {
    assert.equal(calls.notes[0].t, '無法辨識的碼');
  });
});

/* ── Step 4：對照組——同場次的新碼走完整條鏈必須 ok ─────────────────────── */

test('★Step 4：同場次的內部碼新碼，sign → parse → sha256 → applyScan 全走完必須 ok', async () => {
  const qr = sign(ACT, ID_A, SECRET);
  const parsed = scan.parseChkCode(qr, ACT);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.internalId, ID_A);

  const hash = await scan.sha256Hex(qr);
  const snap = {}; snap[hash] = { internalId: ID_A, name: '甲', unit: 'A部', table: '1', checked: false };
  const out = scan.applyScan({ seen: {}, queue: [] }, hash, snap, Date.now());
  assert.equal(out.verdict.type, 'ok');
  assert.equal(out.verdict.person.name, '甲');
});

// 📌「兩個發碼入口產生同一張 QR」在後端驗（jdc-line-gas 的 status-wiring.test.js：
//   「批次下載走的是共用 signer，不是自己手寫的 HMAC」）。這裡驗不到——前端沒有 signer，
//   在這邊自己再算一份等於拿抄本比抄本。

/* ── Step 5：負向簽章案例（正向案例抓不到「拿掉簽章驗證」）─────────────── */

test('★Step 5：活動與內部碼都對，只改 HMAC 一個字元 → 必須被拒', async () => {
  // ⚠️ 突變方向：拿掉簽章／雜湊約束會**擴大**接受範圍 ⇒ 合法碼照樣通過 ⇒
  //    正向測試不會紅。要抓這種退化只能用負向案例。
  const good = sign(ACT, ID_A, SECRET);
  const sig = good.split('|')[3];
  const tampered = good.slice(0, good.length - sig.length)
    + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.notEqual(tampered, good, '前置條件：真的改到字了');

  const snap = {}; snap[await scan.sha256Hex(good)] = { internalId: ID_A, name: '甲', checked: false };
  const out = scan.applyScan({ seen: {}, queue: [] }, await scan.sha256Hex(tampered), snap, Date.now());
  assert.equal(out.verdict.type, 'unknown', '簽章被改過還放行＝任何人自製一張碼都掃得進去');
});

test('★Step 5 對照組：沒被改過的同一張碼要通過——證明拒的是簽章不是全拒', async () => {
  const good = sign(ACT, ID_A, SECRET);
  const snap = {}; snap[await scan.sha256Hex(good)] = { internalId: ID_A, name: '甲', checked: false };
  const out = scan.applyScan({ seen: {}, queue: [] }, await scan.sha256Hex(good), snap, Date.now());
  assert.equal(out.verdict.type, 'ok');
});

/* ── Step 6：舊鍵讀不到，要走真的 storage loader ─────────────────────────── */

test('★Step 6：舊鍵存的通行證，用新鍵讀回來是 null（前端一部署就會自己重抓）', () => {
  // ⚠️ **不可以把 record 直接餵給 passCacheUsable**——它不讀 storage、也不接受 key，
  //    舊鍵存的有效 record 傳進去它會回 true，那是假綠。失效發生在「用新 key 去讀」那一步。
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const rec = { v: '21', res: { published: true, code: 'CHK|midyear2026|00011|sig', table: '21' } };
  storage.setItem('jdcPass:U1:midyear2026', JSON.stringify(rec));   // 舊鍵（沒有版本段）

  const ctx = { console, JSON, String, localStorage: storage, passCacheKey: passCache.passCacheKey };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(INDEX, 'passCacheRead', 'index.html'), ctx, { filename: 'index.html-extract' });

  assert.equal(ctx.passCacheRead('U1', 'midyear2026'), null,
    '舊鍵還讀得到＝那支手機會一直拿員編版的碼畫 QR，到現場才掃不進去');

  // 對照組：同一支 loader 用新鍵存的就讀得回來 ⇒ 證明「讀不到」不是 loader 壞掉
  storage.setItem(passCache.passCacheKey('U1', 'midyear2026'), JSON.stringify(rec));
  assert.deepEqual(ctx.passCacheRead('U1', 'midyear2026'), rec);
});

test('★Step 6：圖文選單那把 auto 鍵也一樣（它才是「永不重抓」的那一把）', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  storage.setItem('jdcPass:U1:auto', JSON.stringify({ v: '', res: { published: true } }));
  const ctx = { console, JSON, String, localStorage: storage, passCacheKey: passCache.passCacheKey };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(INDEX, 'passCacheRead', 'index.html'), ctx, { filename: 'index.html-extract' });
  assert.equal(ctx.passCacheRead('U1', ''), null);
});
