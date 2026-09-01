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
