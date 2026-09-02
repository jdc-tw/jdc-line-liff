const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 承辦人叫出某個人的報到 QR：認的是內部碼，不是姓名（2026-09-02，第三階段）。
 *
 * 🔴 為何存在：原本 findQr 只用姓名比對。同名不同人時，承辦人在座位表點 A 的名字，
 * 叫出來的是 B 的 QR——**而卡片上顯示的是 A 的名字**。他印出來、發給 A，
 * A 到現場掃進去記成 B。畫面完全正常，沒有任何一層會喊。
 *
 * 這一組守兩件事：findQr 認內部碼、座位表真的把內部碼傳進去。
 * 只測前者不夠——參數沒接上的話 findQr 收到 undefined，它會安靜地退回姓名比對。
 */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');
function fnSrc(name) {
  const m = SRC.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
  assert.ok(m, `stats.html 裡找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

// 同名不同人：兩個「李明」，內部碼不同、單位不同。
const ROWS = [
  { internalId: 'JDC-HJKMNP', name: '李明', unit: 'A部', code: 'CHK|act|JDC-HJKMNP|SIG1' },
  { internalId: 'JDC-BBBBBB', name: '李明', unit: 'B部', code: 'CHK|act|JDC-BBBBBB|SIG2' },
  { internalId: 'JDC-CCCCCC', name: '陳大同', unit: 'A部', code: 'CHK|act|JDC-CCCCCC|SIG3' },
];

function loadFindQr() {
  const ctx = { console, String };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('findQr'), ctx, { filename: 'stats.html-extract' });
  return ctx.findQr;
}

test('★findQr：兩個同名的人，各自拿到自己的碼', () => {
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, 'JDC-HJKMNP').code, 'CHK|act|JDC-HJKMNP|SIG1');
  assert.equal(findQr(ROWS, 'JDC-BBBBBB').code, 'CHK|act|JDC-BBBBBB|SIG2');
});

test('★findQr：有內部碼卻找不到 → 回 null，不可以退回姓名去猜一個給他', () => {
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, 'JDC-ZZZZZZ'), null);
});

/* 🔴 外審第二輪 D：姓名 fallback 整支拿掉 ─────────────────────────────────
   第一版留了姓名 fallback，註解寫「沒有內部碼的列本來就簽不出碼，走到這裡也只會
   回 null」。**那個推理錯了。** fallback 搜尋的是 `rows`——**別人已經簽出來的碼**。
   「這個人簽不出碼」不代表「rows 裡沒有同名的人」。

   而且這件事可以證明、不是取捨：`getCheckinCodes` 放進 rows 的每一筆都必有非空
   且合法的內部碼（沒有的人一律進 unsigned）⇒ **沒有內部碼的人不可能有自己那一筆
   在 rows 裡** ⇒ 姓名比對命中的必然是別人。

   ⇒ 那個 fallback 沒有「正確」的情況，所以不是收緊，是拿掉。 */

test('🔴★findQr：沒有內部碼時一律回 null——即使 rows 裡有同名的人', () => {
  // 這一條是 D 的最小重現。舊版在這裡會回傳李明那一筆，而呼叫端的卡片上寫著的是
  // 另一個人的名字 ⇒ 印出來發下去，報到時記成別人。
  //
  // ⚠️ **姓名一定要傳進去**，即使現行簽名只吃兩個參數。第一版我只傳兩個，
  // 於是「還原成舊版」這個突變**沒有被抓到**——舊版拿到的 name 是 undefined，
  // 誰都比不中，照樣回 null。測試沒有重現那個缺陷，而它看起來像測到了。
  // 要重現就得用**生產呼叫端的姿勢**：那裡手上一直有姓名。
  const findQr = loadFindQr();
  ['李明', '陳大同'].forEach((nm) => {
    assert.equal(findQr(ROWS, '', nm), null, `空字串的 id 竟然靠「${nm}」比中了`);
    assert.equal(findQr(ROWS, null, nm), null);
    assert.equal(findQr(ROWS, undefined, nm), null);
    assert.equal(findQr(ROWS, '   ', nm), null, '只有空白也算沒有');
  });
});

test('對照組：同一批 rows 給對的內部碼就找得到——證明回 null 不是全部都找不到', () => {
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, 'JDC-CCCCCC').name, '陳大同');
});

/* ── 接線：座位表要真的把內部碼傳進去 ─────────────────────────────────────── */

function renderSeats(seats) {
  let html = '';
  const ctx = {
    console, String,
    SB: { ranks: {} },
    sortSeats: (list) => list,
    esc: (s) => String(s == null ? '' : s),
    document: { getElementById: () => ({ set innerHTML(v) { html = v; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('renderDetail'), ctx, { filename: 'stats.html-extract' });
  ctx.renderDetail('標題', seats, false);
  return html;
}

test('★接線：座位表點名字時，帶進去的是內部碼不是只有姓名', () => {
  const html = renderSeats([
    { kind: 'emp', id: 'JDC-HJKMNP', internalId: 'JDC-HJKMNP', name: '李明', unit: 'A部', table: '1' },
  ]);
  assert.ok(html.indexOf("showPerson('JDC-HJKMNP','李明')") >= 0,
    '座位表沒有把內部碼傳給 showPerson，findQr 會收到 undefined 然後安靜地退回姓名比對。實際產出：' + html);
});

test('對照組：同一個人只把內部碼拿掉，產出的就變成空的第一個參數', () => {
  // 沒有這條，上面那條也可能只是因為字串剛好對上。
  const html = renderSeats([
    { kind: 'emp', id: '', internalId: '', name: '李明', unit: 'A部', table: '1' },
  ]);
  assert.ok(html.indexOf("showPerson('','李明')") >= 0, '實際產出：' + html);
});

/* ── 批次下載的檔名：同名同單位不可以互相覆蓋 ───────────────────────────── */

test('★批次 zip：同名同單位的兩個人不會共用同一個檔名（共用＝少一張，且看不出來）', () => {
  // ⚠️ 這條的第一版是**抄了一份命名規則**來測，那種測試抓不到 stats.html 的回歸
  //    ——抄的那一份不會跟著正本一起改。改成抽出真正的 qrFileName 來跑。
  const ctx = { console, String };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('qrFileName'), ctx, { filename: 'stats.html-extract' });
  const used = {};
  const nameOf = (p) => ctx.qrFileName(p, used);
  const same = [
    { internalId: 'JDC-HJKMNP', name: '李明', unit: 'A部' },
    { internalId: 'JDC-BBBBBB', name: '李明', unit: 'A部' },
  ];
  const files = same.map(nameOf);
  assert.notEqual(files[0], files[1], '兩個檔名一樣＝後面那張把前面那張蓋掉，zip 裡就少一張');
  assert.equal(files[0], 'A部_李明.png', '沒撞名的那一張要維持原本乾淨的檔名');
  assert.equal(files[1], 'A部_李明_JDC-BBBBBB.png');
});

/* ═══ 後端算出來的「誰沒拿到碼」不可以在前端接縫被裁掉（外審第三輪 #3／#4）═══
   原本 `qrRows()` 是 `qrCache[id]=rs[1].rows; return rs[1].rows;`
   ⇒ 後端逐人算出的 `unsigned`／`duplicated`／`total` **在第一個消費接縫全部消失**。

   **後端守恆只證明 JSON 回應完整，證明不了操作端看得到。**
   從產生資訊的地方到承辦人的眼睛，中間每一個接縫都要保留它。 */

function loadQrRows(res) {
  let cached = null;
  const ctx = {
    console, Promise, String, Object, Array,
    qrCache: {},
    qrBadgeReady: () => Promise.resolve(),
    q: () => 'tok',
    jsonp: () => Promise.resolve(res),
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('qrRows'), ctx, { filename: 'stats.html-extract' });
  return ctx.qrRows('act').then((r) => { cached = ctx.qrCache['act']; return { r, cached }; });
}

const FULL = {
  ok: true, total: 4,
  rows: [{ internalId: 'JDC-HJKMNP', name: '甲', unit: 'A部', code: 'CHK|a|JDC-HJKMNP|S' }],
  unsigned: [{ name: '乙', unit: 'B部', why: '缺內部碼' },
             { name: '丙', unit: 'B部', why: '名冊查無此碼' }],
  duplicated: [{ name: '丁', unit: 'A部', internalId: 'JDC-JKMNPQ' }],
};

test('★qrRows：整個回應都要留住，不可以只留 rows', async () => {
  const { r, cached } = await loadQrRows(FULL);
  assert.ok(r.rows, 'rows 還在');
  assert.equal(r.total, 4, 'total 被裁掉了＝畫面算不出 N/total');
  assert.equal(r.unsigned.length, 2, 'unsigned 被裁掉了＝少了誰永遠沒人知道');
  assert.equal(r.duplicated.length, 1);
  assert.equal(cached.total, 4, '快取存的也要是完整的——否則第二次點更慘（連第一次的資訊都沒了）');
});

test('★unsignedText：把「是誰、為什麼」講出來，不是只給一個數字', () => {
  const ctx = { console, String, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('unsignedText'), ctx, { filename: 'stats.html-extract' });
  const t = ctx.unsignedText(FULL);
  assert.match(t, /未簽發（2 人）/);
  assert.match(t, /乙/); assert.match(t, /缺內部碼/);
  assert.match(t, /丙/); assert.match(t, /名冊查無此碼/);
  assert.match(t, /重複回覆、只簽一張（1 筆）/);
  assert.match(t, /丁/);
});

test('對照組：全部都簽得出來時，unsignedText 是空字串（不可以永遠有東西）', () => {
  const ctx = { console, String, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('unsignedText'), ctx, { filename: 'stats.html-extract' });
  assert.equal(ctx.unsignedText({ ok: true, total: 1, rows: [{}], unsigned: [], duplicated: [] }), '');
  assert.equal(ctx.unsignedText({}), '');
});

/* ── 動作前要明示：承辦人是拿這批 QR 去發給人的 ─────────────────────────── */

function runDlAllQr(res, confirmAnswer) {
  const out = { msgs: [], confirms: [], files: [], downloaded: false };
  const ctx = {
    console, Promise, String, Object, Array, Date, JSON,
    JSZip: function () {
      this.file = (n, b) => out.files.push(n);
      this.generateAsync = () => Promise.resolve('BLOB');
    },
    __tmLib: () => Promise.resolve(),
    qrRows: () => Promise.resolve(res),
    ckActId: () => 'act', ckActName: () => '年中聚餐',
    __rdlToday: () => '2026/09/02',
    qrBadgeCanvas: () => ({ toBlob: (cb) => cb('IMG') }),
    qrFileName: (p) => p.name + '.png',
    confirm: (t) => { out.confirms.push(t); return confirmAnswer; },
    setMsg: (id, t, cls) => out.msgs.push({ t, cls }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click: () => { out.downloaded = true; }, set href(v) {}, set download(v) {} }) },
  };
  vm.createContext(ctx);
  // dlAllQr 會呼叫 unsignedText——給真貨，不要 stub。stub 掉的話「訊息裡有沒有原因」
  // 就變成在測我寫的替身，而不是測實際會顯示的內容。
  vm.runInContext([fnSrc('unsignedText'), fnSrc('dlAllQr')].join('\n'),
                  ctx, { filename: 'stats.html-extract' });
  ctx.dlAllQr();
  return new Promise((r) => setTimeout(() => r(out), 30));
}

test('★★下載前要先講「只簽得出 N／total」並列出是誰——不是印完發完才發現', async () => {
  const out = await runDlAllQr(FULL, true);
  assert.equal(out.confirms.length, 1, '少了誰卻直接下載＝承辦人拿著不完整的一批去發');
  assert.match(out.confirms[0], /4 人/);
  assert.match(out.confirms[0], /只簽得出 1 張/);
  assert.match(out.confirms[0], /缺內部碼/, '要講出原因，不是只給數字');
});

test('★★未簽發清單要放進 zip——資訊跟著成品走', async () => {
  const out = await runDlAllQr(FULL, true);
  assert.ok(out.files.indexOf('_未簽發清單.txt') >= 0,
    '清單只出現在一個關掉就沒有的對話框裡＝隔天沒有人知道少了誰。實際檔案：'
    + JSON.stringify(out.files));
  assert.equal(out.downloaded, true);
});

test('★★承辦人選擇取消時不下載，而且訊息要講出還有幾人未處理', async () => {
  const out = await runDlAllQr(FULL, false);
  assert.equal(out.downloaded, false);
  assert.equal(out.files.length, 0);
  const m = out.msgs.map((x) => x.t).join('｜');
  assert.match(m, /未簽發 3 人/, '實際訊息：' + m);
});

test('對照組：全部簽得出來時不問、直接下載，且 zip 裡沒有清單', async () => {
  // 沒有這條，上面那些也可能只是「它每次都問」。
  const clean = { ok: true, total: 1, rows: FULL.rows, unsigned: [], duplicated: [] };
  const out = await runDlAllQr(clean, true);
  assert.equal(out.confirms.length, 0, '正常情況多問一次＝下次沒有人會看那個對話框');
  assert.ok(out.files.indexOf('_未簽發清單.txt') < 0);
  assert.equal(out.downloaded, true);
  assert.match(out.msgs.map((x) => x.t).join('｜'), /1／1 張/);
});
