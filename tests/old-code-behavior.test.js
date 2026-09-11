const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 舊碼掃到現場會怎樣（2026-09-02 建；2026-09-11 改寫）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 **這支檔頭原本記載的是一個「已拍板接受的缺口」。那個缺口 2026-09-11 補掉了。**
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 原文（改寫不刪——刪掉會丟失它防過什麼）：
 *
 * > 兩種舊碼走的是不同的分支：跨場次的舊碼 → wrongAct → 「這是別場活動的碼」→ 看得懂；
 * > 同場次的員編舊碼 → unknown → 「無法辨識的碼」→ **跟陌生人的碼一樣**。
 * > 第二種是已拍板接受的缺口。接受的唯一理由是：部署時活動表裡沒有任何未來活動，
 * > 所以沒有人手上會有那場的碼。使用者 2026-09-02 知情後選了這條（甲案）。
 *
 * **為何推翻：** 使用者 2026-09-10 重新拍板做版本前綴（乙案）。他否掉「接受風險」的
 * 理由不是風險大小，是三種情況**畫面一模一樣而處置完全不同**——碼過期了／這個人根本
 * 不是公司的／系統壞了。現場承辦人分不出來，只能請人到旁邊等。
 *
 * **現在四種失敗各有各的臉**（這一支就是釘住這件事的地方）：
 *
 *   跨場次的碼        → wrongAct → 「這是別場活動的碼」
 *   舊版（CHK 前綴）  → legacy   → 「這是舊版的報到碼」→ 指示重新開啟通行證
 *   不是報到碼        → format   → 「無法辨識的碼」
 *   碼是新的、人不在  → unknown  → 「查無此人」
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
const SIG = 'SIGNATURE';   // 不透明——前端不驗它，只拿整串去算雜湊
const ID_A = 'JDC-BCDFGH';

/**
 * 組一張 QR 字串。
 *
 * 🔴 2026-09-02（外審第二輪 E）：**這裡刻意不重算 HMAC。**
 * 第一版把後端 `signEventCheckinCode` 的算式**在測試裡重寫了一份**——那是
 * 「測試自己造了受測物的供給端」的第三次（前兩次：CC_BOARD 由 CC_ROWS 生成、
 * 搜名表用手寫 fixture）。而這一種更隱蔽：它看起來像在測整合。
 * 後端的前綴或序列化一漂移，前端測試仍然全綠，實機全拒。
 *
 * 查證之後發現**根本不需要真的 HMAC**：前端從頭到尾不驗簽章。
 * `parseChkCode` 只看欄數、前綴與活動 ID；`applyScan` 拿**整串的 sha256**去查快照。
 * 簽章對前端而言就是一段不透明字串——所以這裡放一段不透明字串，
 * 反而比重算一份更誠實：**它明說「這一段的內容前端不在乎」。**
 *
 * ⚠️ 那前端與後端的耦合誰在守？在後端
 * （`jdc-line-gas` 的 status-wiring.test.js：「兩個發碼入口必須產生同一張碼」）。
 * 這裡守的是**格式**（四欄、版本前綴、第三格是身分），那才是前端真正依賴的東西。
 *
 * 🔴 `prefix` 2026-09-11 加：預設取**真貨**（`scan.CHK_PREFIX`），不是寫死的字面值。
 * 寫死的話，下次 bump 成 CHK3 時這支測試會整份繼續驗上一版，而且全綠。
 * 要組舊碼就明白傳 `'CHK'`——**舊碼在這支檔案裡是受測物，所以它才可以寫死**。
 */
function sign(actId, identity, opaqueSig, prefix) {
  return (prefix || scan.CHK_PREFIX) + '|' + actId + '|' + identity + '|' + (opaqueSig || 'SIGNATURE');
}
const V1 = 'CHK';   // 員編時代的前綴。受測物，刻意寫死。

/* ── Step 1／3：兩種舊碼各自落到哪個分支（必須一起跑）──────────────────── */

test('★Step 1：跨場次的舊碼 → wrongAct（跟陌生人的碼分得開）', () => {
  const old = sign('nendkai2025', ID_A, SIG);        // 上一場的碼，身分是新的也一樣
  const r = scan.parseChkCode(old, ACT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrongAct');
});

test('★Step 1b：舊前綴＋跨場次，仍然報 wrongAct（版本前綴不吃掉既有那條）', () => {
  // 「這是別場活動的碼」2026-08-31 就在了，主視窗明令不重做。活動不符比版本更具體，
  // 現場承辦人拿它才知道是「上一場的」，所以它排在版本判斷前面。
  assert.equal(scan.parseChkCode(sign('nendkai2025', '00011', SIG, V1), ACT).reason, 'wrongAct');
});

test('★Step 3：同場次的員編舊碼，雜湊仍然查不到人（缺口的前半段沒變）', async () => {
  // 這一半沒變、也不該變：員編版的碼算出來的雜湊，不可能出現在用新前綴建的快照裡。
  // 變的是**查不到之後畫面說什麼**——見下面 Step 3b。
  const oldSameAct = sign(ACT, '00011', SIG, V1);    // 同一場、員編、舊前綴
  const parsed = scan.parseChkCode(oldSameAct, ACT);
  assert.equal(parsed.ok, true, '格式與活動都對，所以它過得了 parse 這一關');
  assert.equal(parsed.legacy, true, '但它帶著「這是舊版」的標記往下走');

  const snap = {};
  snap[await scan.sha256Hex(sign(ACT, ID_A, SIG))] =
    { internalId: ID_A, name: '甲', unit: 'A部', table: '1', checked: false };
  const hash = await scan.sha256Hex(oldSameAct);
  const out = scan.applyScan({ seen: {}, queue: [] }, hash, snap, Date.now());
  assert.equal(out.verdict.type, 'unknown', '雜湊對不上＝applyScan 這一層仍然是 unknown');
});

/* ══════════════════════════════════════════════════════════════════════
   🔴🔴 Step 3b：**這一條就是這次交付要買的東西本身。**

   使用者 2026-09-10 的原話：碼過期了／這個人根本不是公司的／系統壞了——
   三種情況畫面一模一樣而處置完全不同，現場承辦人分不出來，只能請人到旁邊等。
   ⇒ 驗收判準不是「有沒有做版本前綴」，是「**系統分得出舊碼與查無此人**」。

   所以這條斷言的核心不是某一句文案的字面，是**兩句文案不相等**。
   只斷言「舊碼那句是 X」的話，把另一支也改成 X 仍然全綠，而現場又分不出來了。
   ══════════════════════════════════════════════════════════════════════ */

test('🔴★Step 3b：舊版碼與查無此人，畫面上必須是兩句不同的話', async () => {
  const snap = {};
  snap[await scan.sha256Hex(sign(ACT, ID_A, SIG))] =
    { internalId: ID_A, name: '甲', unit: 'A部', table: '1', checked: false };

  // ① 員編時代的舊碼：格式對、活動對、雜湊查不到
  const legacyCalls = await runHandle(sign(ACT, '00011', SIG, V1), snap);
  // ② 陌生人：當下這一版的碼、活動也對，但這個人不在名單上
  const strangerCalls = await runHandle(sign(ACT, 'JDC-ZZZZZZ', SIG), snap);

  assert.equal(legacyCalls.notes.length, 1);
  assert.equal(strangerCalls.notes.length, 1);
  const legacyText = legacyCalls.notes[0].t;
  const strangerText = strangerCalls.notes[0].t;

  assert.notEqual(legacyText, strangerText,
    '🔴 兩種情況講同一句話＝這次交付什麼都沒買到。現場承辦人仍然分不出來。'
    + ' 舊碼說「' + legacyText + '」／陌生人說「' + strangerText + '」');
  assert.equal(legacyText, '這是舊版的報到碼');
  assert.equal(strangerText, '查無此人');
  assert.match(legacyCalls.notes[0].sub, /重新開啟通行證/,
    '光說「這是舊版」不夠——要告訴現場的人下一步做什麼，否則他還是只能請人到旁邊等');
});

test('🔴★Step 3c：連續三張查無此人 → 改口暗示是名單有問題（第三種情況）', async () => {
  // 三種情況的最後一種：不是碼過期、也不是陌生人，是**這台的名單壞了／是舊的**。
  // 它沒有專屬訊號，唯一免費的鑑別力是「連號」。只提示不阻擋。
  const ctx = mkHandleCtx({});
  const texts = ['JDC-ZZZZZA', 'JDC-ZZZZZB', 'JDC-ZZZZZC']
    .map((id) => sign(ACT, id, SIG));
  for (const t of texts) await ctx.handle(t, 0);

  assert.equal(ctx.calls.notes.length, 3);
  assert.equal(ctx.calls.notes[0].t, '查無此人', '第一張是偶發，不該立刻誣賴系統');
  assert.notEqual(ctx.calls.notes[2].t, ctx.calls.notes[0].t,
    '連續三張跟第一張講同一句話＝「系統壞了」這一格仍然沒有臉');
  assert.match(ctx.calls.notes[2].sub, /名單/, '要指向名單，不是指向這個人');
  assert.match(ctx.calls.notes[2].sub, /重新載入名單/, '要講得出下一步的動作');
  assert.match(ctx.calls.notes[2].sub, /訪客/,
    '只提示不阻擋——連續三張仍可能真的是三位訪客，那句話要留在卡片上');
});

test('★Step 3c 對照組：中間掃進去一個人，連續計數要歸零', async () => {
  // 沒有這條，「第三張永遠講升級版那句」也會讓上面通過，而那等於門檻根本沒作用。
  const good = sign(ACT, ID_A, SIG);
  const snap = {};
  snap[await scan.sha256Hex(good)] =
    { internalId: ID_A, name: '甲', unit: 'A部', table: '1', checked: false };
  const ctx = mkHandleCtx(snap);
  await ctx.handle(sign(ACT, 'JDC-ZZZZZA', SIG), 0);
  await ctx.handle(sign(ACT, 'JDC-ZZZZZB', SIG), 0);
  await ctx.handle(good, 0);                                  // 掃得進去＝名單是好的
  await ctx.handle(sign(ACT, 'JDC-ZZZZZC', SIG), 0);
  const last = ctx.calls.notes[ctx.calls.notes.length - 1];
  assert.equal(last.t, '查無此人', '歸零沒做＝第三張就開始誣賴一份其實沒問題的名單');
});

/* ── Step 2：UI 文案要真的映射對（只斷言 verdict 不夠）──────────────────── */

function mkHandleCtx(snapshot) {
  const calls = { notes: [], cards: [] };
  const ctx = {
    console, JSON, Date, String, Object, Promise, Math,
    ACT, ready: true, DEMO: false,
    snapshot: snapshot || {}, state: { seen: {}, queue: [] },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    QKEY: 'q', QUEUE_V: 2,
    parseChkCode: scan.parseChkCode, sha256Hex: scan.sha256Hex, applyScan: scan.applyScan,
    // 連續「查無此人」的計數（第三種情況：系統壞了）。常數取真貨，不在測試裡另寫一個。
    unknownStreak: 0, UNKNOWN_STREAK_HINT: scan.UNKNOWN_STREAK_HINT,
    note: (cls, t, sub) => calls.notes.push({ cls, t, sub }),
    personCard: (cls, label, p) => calls.cards.push({ cls, label, p }),
    flashFrame: () => {}, holdThenIdle: () => {}, saveSeen: () => {},
    // 這支 harness 只驗「失敗時畫面說什麼」，所以寫入端給一個恆成功的替身就夠。
    // 寫入真的失敗會怎樣（不可以說「已受理」）由 staff-identity-wiring 那支盯著。
    // ⚠️ 連續計數的歸零刻意排在 commitCheckin **之前**：人查得到＝名單是好的，
    //    就算儲存空間滿了寫不進去，也不該讓計數繼續累積去誣賴一份沒問題的名單。
    commitCheckin: () => true,
    enqueue: () => {}, navigator: {}, performance: { now: () => 0 },
    idToHash: {}, tableOf: () => '',
    // handle 的最後一行會寫診斷列。原本的 runHandle 沒有這個替身也全綠——因為那些
    // 案例全在 parse 那一關就 return 了，走不到這裡。**「沒用到」與「不需要」在綠燈下
    // 分不開**，而一旦有測試走完整條路，缺的那一格就會以 ReferenceError 現形。
    document: { getElementById: () => ({ innerHTML: '', className: '', textContent: '' }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(HTML, 'handle', 'staff.html'), ctx, { filename: 'staff.html-extract' });
  ctx.calls = calls;
  return ctx;
}

function runHandle(text, snapshot) {
  const ctx = mkHandleCtx(snapshot);
  return ctx.handle(text, 0).then(() => ctx.calls);
}

test('★Step 2：wrongAct 在畫面上是「這是別場活動的碼」，不是「查無此人」', async () => {
  // 只斷言 verdict 不夠：即使 html 把它錯映射成「無法辨識」，純函式測試仍然全綠。
  const calls = await runHandle(sign('nendkai2025', ID_A, SIG));
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
  const qr = sign(ACT, ID_A, SIG);
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
  const good = sign(ACT, ID_A, SIG);
  const sig = good.split('|')[3];
  const tampered = good.slice(0, good.length - sig.length)
    + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.notEqual(tampered, good, '前置條件：真的改到字了');

  const snap = {}; snap[await scan.sha256Hex(good)] = { internalId: ID_A, name: '甲', checked: false };
  const out = scan.applyScan({ seen: {}, queue: [] }, await scan.sha256Hex(tampered), snap, Date.now());
  assert.equal(out.verdict.type, 'unknown', '簽章被改過還放行＝任何人自製一張碼都掃得進去');
});

test('★Step 5 對照組：沒被改過的同一張碼要通過——證明拒的是簽章不是全拒', async () => {
  const good = sign(ACT, ID_A, SIG);
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
  storage.setItem('jdcPass:U1:midyear2026', JSON.stringify(rec));      // 最早期（無版本段）
  // 🔴 2026-09-11 補上 v2 這一把。原本這裡只存最早期那把鍵，於是**這條測試對
  //    「v2 → v3 有沒有 bump」完全沒有鑑別力**：把 PASS_CK 改回 v2，它照樣全綠
  //    （v2 讀不到無版本段的鍵，本來就是真的）。實測突變確認過。
  //    而 v2 正是這一次要失效的那一代——它存的是「CHK 前綴＋內部碼」的碼，
  //    手機拿它畫 QR 會被掃描站判成「這是舊版的報到碼」，然後叫他重新開啟通行證，
  //    而重新開啟走的就是這支 loader。**沒 bump 的話他拿到的是同一張舊碼。**
  storage.setItem('jdcPass:v2:U1:midyear2026', JSON.stringify(rec));   // 上一版

  const ctx = { console, JSON, String, localStorage: storage, passCacheKey: passCache.passCacheKey };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(INDEX, 'passCacheRead', 'index.html'), ctx, { filename: 'index.html-extract' });

  assert.equal(ctx.passCacheRead('U1', 'midyear2026'), null,
    '舊鍵還讀得到＝那支手機會一直拿舊版的碼畫 QR，而畫面叫他「重新開啟通行證」'
    + '這件事做了沒有用——假的處置比沒有處置更貴');

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
  storage.setItem('jdcPass:v2:U1:auto', JSON.stringify({ v: '', res: { published: true } }));
  const ctx = { console, JSON, String, localStorage: storage, passCacheKey: passCache.passCacheKey };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(INDEX, 'passCacheRead', 'index.html'), ctx, { filename: 'index.html-extract' });
  assert.equal(ctx.passCacheRead('U1', ''), null);
});

/* ── 前端真正依賴的是格式契約，不是簽章演算法 ─────────────────────────────── */

test('★格式契約：四欄、版本前綴、第三格是身分——前端依賴的就是這三件', () => {
  // 外審 E 指出「LIFF 測試自行重寫後端 signer」。查證後拿掉了那份重寫：
  // 前端不驗簽章，所以重算 HMAC 只是多一份會漂移的複本。
  // 但格式這三件**確實是**前端依賴的，所以要有東西守著。
  //
  // 🔴 2026-09-11：第二格的斷言原本寫死 `'CHK'`。改成取 `scan.CHK_PREFIX`——
  // 寫死的話，下次 bump 成 CHK3 時這條會紅在「測試自己的期望值」而不是真的缺陷，
  // 而修法會是「把字面值換掉」，那等於每次都要重新確認一次它到底在守什麼。
  // 前綴的**字面值**由 staff-scan.test.js 的跨 repo 契約那條單獨釘住，只釘一處。
  const qr = sign(ACT, ID_A, SIG);
  const parts = qr.split('|');
  assert.equal(parts.length, 4, '欄數變了 parseChkCode 直接判 format');
  assert.equal(parts[0], scan.CHK_PREFIX);
  assert.equal(parts[1], ACT);
  assert.equal(parts[2], ID_A);
  assert.equal(scan.parseChkCode(qr, ACT).internalId, ID_A);
});

test('對照組：欄數不對就被判 format——證明上面那條守的是真的約束', () => {
  assert.equal(scan.parseChkCode(scan.CHK_PREFIX + '|' + ACT + '|' + ID_A, ACT).reason, 'format');
  assert.equal(scan.parseChkCode(scan.CHK_PREFIX + '|' + ACT + '|' + ID_A + '|a|b', ACT).reason, 'format');
});
