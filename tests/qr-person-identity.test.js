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
  { internalId: 'JDC-AAAAAA', name: '李明', unit: 'A部', code: 'CHK|act|JDC-AAAAAA|SIG1' },
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
  assert.equal(findQr(ROWS, 'JDC-AAAAAA', '李明').code, 'CHK|act|JDC-AAAAAA|SIG1');
  assert.equal(findQr(ROWS, 'JDC-BBBBBB', '李明').code, 'CHK|act|JDC-BBBBBB|SIG2');
});

test('★findQr：有內部碼卻找不到 → 回 null，不可以退回姓名去猜一個給他', () => {
  // 這條是這次修法的關鍵。退回姓名的話，一個沒有報到碼的人會拿到同名同事的碼，
  // 而畫面上寫著他自己的名字——比「找不到」糟得多。
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, 'JDC-ZZZZZZ', '李明'), null);
});

test('findQr：沒有內部碼時才退回姓名比對（來賓、回填前的歷史列）', () => {
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, '', '陳大同').internalId, 'JDC-CCCCCC');
  assert.equal(findQr(ROWS, null, '查無此人'), null);
});

test('findQr：姓名比對仍然吃得下全形與半形空白', () => {
  const findQr = loadFindQr();
  assert.equal(findQr(ROWS, '', '陳　大同').internalId, 'JDC-CCCCCC');
  assert.equal(findQr(ROWS, '', ' 陳大同 ').internalId, 'JDC-CCCCCC');
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
    { kind: 'emp', id: 'JDC-AAAAAA', internalId: 'JDC-AAAAAA', name: '李明', unit: 'A部', table: '1' },
  ]);
  assert.ok(html.indexOf("showPerson('JDC-AAAAAA','李明')") >= 0,
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
    { internalId: 'JDC-AAAAAA', name: '李明', unit: 'A部' },
    { internalId: 'JDC-BBBBBB', name: '李明', unit: 'A部' },
  ];
  const files = same.map(nameOf);
  assert.notEqual(files[0], files[1], '兩個檔名一樣＝後面那張把前面那張蓋掉，zip 裡就少一張');
  assert.equal(files[0], 'A部_李明.png', '沒撞名的那一張要維持原本乾淨的檔名');
  assert.equal(files[1], 'A部_李明_JDC-BBBBBB.png');
});
