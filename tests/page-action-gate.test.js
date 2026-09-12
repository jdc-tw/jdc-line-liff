/**
 * 🔴 **頁面打的 action ↔ 後端的身分矩陣，必須相容。**
 *
 * ══ 這一檔是哪一次故障生出來的（2026-09-12，線 X）═══════════════════════
 *
 * `attend.html`（副總的活動出席唯讀看板）**對 `view` 身分打不開**，蓋上全螢幕
 * 「連結已失效／這條看板連結已經停用」。**線上已壞約 3.5 週（起算 2026-08-19），
 * 而這個 repo 的 875 條測試全綠。**
 *
 * 鏈條（每一節都一手查過）：
 *   ① `attend.html` 開頁第一發是 `jsonp('batch', {list:[listActivities, getActivityStats]})`
 *   ② 後端 `roles.js` 把 `batch` 註冊成 `'any'`，而 `'any'` 實際是「任何**看板**身分」
 *      ⇒ view 走不到 `gateAction` 的 view 分支，落到 board 分支 ⇒ `token_invalid`
 *   ③ `assets/board-cache.js` 看到「無權限或連結已失效」開頭 ⇒ 判 `revoked`
 *   ④ 清快取 ＋ 蓋整頁覆蓋層
 *
 * 🔴 **成因不是②那一行寫錯，是沒有任何東西在問「這一頁打的 action，
 *    這一頁的身分打不打得到」。** 後端 `ci/roles-matrix/baseline.md` 白紙黑字
 *    記著 `batch | any | … view ·`——**資訊一直在，只是沒有人拿它跟頁面對照。**
 *
 * ══ 「那一頁的身分是誰」怎麼表達——**刻意不另立一張表** ═════════════════
 *
 * 最直覺的做法是寫一張「頁面 → 身分」的宣告表。**否決，理由是它腐爛時沒有東西會紅**：
 * 這個 repo 現成就有兩具屍體——
 *   · `tests/page-load.test.js` 的 `PAGES` 是手維護的；2026-09-12 有人加了一頁，
 *     加進清單前後測試數都是 906 ⇒ 新頁面沒有任何載入防護且**零訊號**。
 *   · 後端 `ci/roles-matrix/snapshot.js --check` 算得出漂移，但**沒有被掛進任何地方**；
 *     2026-09-12 在乾淨 HEAD 上跑它就是紅的（漂了 2 支新 action、10 支改了宣告宣告欄）。
 * 兩顆都是「資訊一直在、沒有強制點」——跟本檔要修的那顆同一種病。
 *
 * ⇒ **改成問一個不需要知道使用者是誰的問題**：
 *
 *   🔴 `batch` 是**轉派器，不是授權邊界**。`runBatch_` 對每一支子 action
 *      重跑一次**同一支** `gateAction`（`Code.js`；`batch.js` 的 `buildBatchResults`
 *      逐支呼叫 `ctx.gate`）。所以外層那道門只會**減**、不會加。
 *      ⇒ **外層的身分集合，不得比它所轉派的任何一支子 action 更窄。**
 *      更窄的那些身分，本來直接打得到那支 action，改走 batch 之後卻收到
 *      「無權限或連結已失效」——而前端把那句話翻譯成「整頁停用」。
 *
 *   這個判準**完全由頁面自己的子項清單推出來**，不必宣告受眾，
 *   所以沒有第二張表要維護，也就沒有腐爛的那一格。
 *
 * ⚠️ **public 的子項不參與聯集**：`'public'` 的語意是「不需要身分」，
 *    它不對呼叫者是誰做任何主張。算進去的話 `board.html` 會因為批了
 *    `getCheckinOptions`（public）而要求 `batch` 對匿名訪客開放——那是假警報。
 *    ⚠️ 判斷 public 走矩陣裡的 `roles` 欄，**不可以用「九種身分全中」反推**：
 *    日後多一種身分，反推的結果會靜默改變（用位置代替身分）。
 *
 * ══ 這道檢查抓不到什麼（寫在這裡，不要讓下一個人以為它守得更寬）═════════
 *
 * ⚠️ 它只管**走 batch 的**那條路。一頁若直接呼叫一支它的使用者打不到的 action，
 *    本檔**不會紅**——那需要「頁面 → 身分」的宣告，而那正是上面否決掉的東西。
 * ⚠️ 動態組出來的子項（`plan.send.map(a => ({a:a}))`，stats.html 報到分頁）抽不到。
 * ⚠️ 矩陣副本 `tests/fixtures/action-roles.json` 是**後端產的**（`jdc-line-gas`
 *    的 `ci/roles-matrix/export-json.js`，與 `roles-matrix.test.js` 共用同一份 fixture）。
 *    它與後端漂移時，本檔只抓得到「出現了副本裡沒有的 action 名」這個方向（見下面的絆線）；
 *    「既有 action 的身分被改窄」這個方向本 repo 看不見。**那一格今天沒有守門**，
 *    處置建議寫在交接文裡（由後端 CI 比對公開的這一份），不要假裝它被守著。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./helpers/action-scan.js');

const M = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'action-roles.json'), 'utf8'));
const FIX = 'tests/fixtures/action-scan-cases.fixture.html';

const known = (a) => Object.prototype.hasOwnProperty.call(M.actions, a);
const isPublic = (a) => M.actions[a].roles.indexOf('public') >= 0;
const who = (a) => M.actions[a].who;

/** 一頁的 batch 子項裡，會對「呼叫者是誰」提出要求的那些身分的聯集。 */
function demandedIdentities(subs) {
  const out = new Set();
  subs.filter((a) => known(a) && !isPublic(a)).forEach((a) => who(a).forEach((i) => out.add(i)));
  return [...out].sort();
}

/* ════════════════════════════════════════════════════════════════════════
 * 一、零點：沒有這幾格，下面每一條都可能在空集合上恆真
 * ════════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：矩陣副本讀得到，而且是這個系統的量級', () => {
  assert.ok(Object.keys(M.actions).length > 80,
    '矩陣副本只有 ' + Object.keys(M.actions).length + ' 支 action ⇒ 副本壞了或產錯了');
  assert.ok(M.identities.length >= 9, '身分只有 ' + M.identities.length + ' 種');
  assert.ok(known('batch'), '副本裡沒有 batch ⇒ 這一檔整份失去意義');
  assert.ok(M.batchAllowed.length > 5, 'batchAllowed 只有 ' + M.batchAllowed.length + ' 支');
  // 🔴 矩陣要真的在分辨身分，不是每一格都相同（否則聯集比較恆真）
  assert.notDeepStrictEqual(who('batch'), who('getActivityStats'),
    'batch 與 getActivityStats 的身分集合相同 ⇒ 這份副本沒有鑑別力');
});

test('⬛ 零點：頁面母體是掃出來的，而且掃得到東西', () => {
  const ps = S.pages();
  assert.ok(ps.length >= 10, '只掃到 ' + ps.length + ' 頁 ⇒ 母體抽法壞了');
  assert.ok(ps.indexOf('attend.html') >= 0, '母體裡沒有 attend.html');
  // 母體是 readdir 現掃的，所以「有人加了一頁卻忘了加進清單」這件事不可能發生。
  const 實際 = fs.readdirSync(S.ROOT).filter((f) => /\.html$/i.test(f)).sort();
  assert.deepStrictEqual(ps, 實際);
});

test('⬛ 零點：batch 子項真的抽得到（抽法退化成 0 會在這裡紅）', () => {
  const 有子項的頁 = S.pages().map(S.scanPage).filter((r) => r.subs.some(known));
  assert.ok(有子項的頁.length >= 3,
    '只有 ' + 有子項的頁.length + ' 頁抽得到 batch 子項 ⇒ 抽法退化了');
  const a = S.scanPage('attend.html');
  assert.deepStrictEqual(a.subs.filter(known), ['getActivityStats', 'listActivities'],
    'attend.html 的兩支首載子項抽不到 ⇒ 本檔對它形同不存在');
  assert.equal(a.callsBatch, true, 'attend.html 打的是 batch，這一格認不出來就整條斷掉');
});

/* ════════════════════════════════════════════════════════════════════════
 * 二、對照組：證明掃描器分得出「呼叫」與「只是提到」
 *     🔴 這三格是本檔唯一能證明主斷言不是裝飾品的東西。
 * ════════════════════════════════════════════════════════════════════════ */

test('⬛ 對照組：board-cache.js 滿是 action 名，但一個呼叫點都沒有', () => {
  const code = fs.readFileSync(path.join(S.ROOT, 'assets/board-cache.js'), 'utf8');
  // 先證明這個對照組有鑑別力：它確實含有 action 名（否則「回 0」什麼都沒證明）
  const 提到的 = Object.keys(M.actions).filter((a) => code.indexOf("'" + a + "'") >= 0);
  assert.ok(提到的.length >= 10,
    'board-cache.js 只提到 ' + 提到的.length + ' 支 action ⇒ 這個對照組失效了，換一個');
  // 🔴 那些全是 `case 'x':` 的分片對照表標籤，不是呼叫
  assert.deepStrictEqual(S.batchItems(code), [], 'board-cache.js 不該有任何 batch 子項');
  assert.equal(S.literalCalls(code).some((c) => c.arg === 'batch'), false,
    'board-cache.js 不該被算成打了 batch');
});

/**
 * ⚠️ **這一條是「今天的線上檔案沒有漏出來」的實測，不是可突變證明的那一條。**
 *    `deny-no-role.js` 那句話被**兩道**擋著：它在區塊註解裡，而且外面還包著反引號
 *    （⇒ 就算不認得註解，也會被當成樣板字串）。兩道互相覆蓋 ⇒ 拿掉任一道它都不紅。
 *    真正單獨可突變的那一格在下面的反例集（①c 跨行、無反引號）。
 */
test('⬛ 對照組：deny-no-role.js 的註解裡寫著 jsonp(\'batch\'，掃描器必須不算', () => {
  const code = fs.readFileSync(path.join(S.ROOT, 'assets/deny-no-role.js'), 'utf8');
  // 有鑑別力：原文真的有那一串（沒有的話這條是空轉）
  assert.ok(code.indexOf("jsonp('batch'") >= 0,
    'deny-no-role.js 已經沒有那句註解了 ⇒ 這個對照組失效，換一個註解裡提到 action 的檔');
  assert.equal(S.literalCalls(code).some((c) => c.arg === 'batch'), false,
    '註解被算成呼叫點 ⇒ 載入它的三頁都會被誤判成打了 batch');
  // 它的連鎖後果：hr-stats.html 載入 deny-no-role.js 卻沒有自己打 batch
  assert.equal(S.scanPage('hr-stats.html').callsBatch, false,
    'hr-stats.html 被算成打了 batch ⇒ 註解漏出來了');
});

test('⬛ 對照組：反例集裡的六種近似陷阱，掃描器逐一分得出來', () => {
  const code = S.inlineScript(FIX);
  const calls = S.literalCalls(code);
  const args = calls.map((c) => c.arg);
  // ①註解裡的呼叫（行註解與區塊註解各一）②字串裡的呼叫 → 都不算
  assert.equal(args.indexOf('batch'), -1, '註解或字串裡的 jsonp(\'batch\') 被算成呼叫了');
  assert.equal(calls.some((c) => c.callee === 'jsonp' && c.arg === 'listActivities'), false,
    '單行區塊註解裡的 jsonp(\'listActivities\') 被算成呼叫了');
  // ①c 跨行區塊註解：**只有「認得區塊註解」擋得住**（正則字面值遇換行會放棄），
  //    所以這一格讓那道處理單獨可被突變抓到，不與 ①b 互相覆蓋。
  assert.equal(calls.some((c) => c.arg === 'getRosterExport'), false,
    '跨行區塊註解裡的呼叫被算進去了 ⇒ 區塊註解那一段處理沒有生效');
  // ③正則裡含引號、⑤除號後接引號 → 掃描器沒有被帶偏，後面那支真呼叫仍抽得到
  assert.ok(calls.some((c) => c.callee === 'jsonp' && c.arg === 'getActivityStats'),
    '正則／除號的陷阱把後面的真呼叫吃掉了');
  // ④switch 標籤不是呼叫
  assert.equal(calls.some((c) => c.arg === 'getHrPending' && c.callee !== 'jsonp'), false,
    'case 標籤被算成呼叫了');
  // batch 子項：兩種寫法都抽得到；⑥值是變數的抽不到（已知邊界，明著釘住）
  assert.deepStrictEqual(S.batchItems(code).sort(),
    ['getActivityStats', 'getHrPending', 'listActivities']);
});

/* ════════════════════════════════════════════════════════════════════════
 * 三、🔴 主斷言
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 batch 的身分集合，不得比它轉派的任何一支子 action 更窄', () => {
  const 允許 = new Set(who('batch'));
  const 違反 = [];
  S.pages().forEach((p) => {
    const r = S.scanPage(p);
    if (!r.callsBatch) return;
    const 要求 = demandedIdentities(r.subs);
    const 缺 = 要求.filter((i) => !允許.has(i));
    if (缺.length) 違反.push(p + ' ｜ 子項 ' + r.subs.filter(known).join(',')
      + ' 要求 [' + 要求.join(',') + ']，而 batch 只開給 [' + who('batch').join(',')
      + ']，缺 ' + 缺.join(','));
  });
  assert.deepStrictEqual(違反, [],
    '這幾頁的 batch 首載會把本來打得到子 action 的身分整個擋在門外，'
    + '而前端把那個拒絕翻譯成「連結已失效」的全頁覆蓋層：\n  ' + 違反.join('\n  '));
});

/* ════════════════════════════════════════════════════════════════════════
 * 四、絆線：矩陣副本過期的一個方向（副本裡沒有的 action 名）
 * ════════════════════════════════════════════════════════════════════════ */

test('🟡 絆線：頁面上的 batch 子項都必須在後端的 batchAllowed 裡', () => {
  const allowed = new Set(M.batchAllowed);
  const 壞的 = [];
  S.pages().forEach((p) => {
    const r = S.scanPage(p);
    if (!r.callsBatch) return;
    r.subs.filter(known).forEach((a) => { if (!allowed.has(a)) 壞的.push(p + ' → ' + a); });
  });
  assert.deepStrictEqual(壞的, [],
    '這些子項後端不接受（會回「此 action 不支援 batch」），'
    + '或是矩陣副本過期了——重產：'
    + 'jdc-line-gas 跑 `node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json`');
});
