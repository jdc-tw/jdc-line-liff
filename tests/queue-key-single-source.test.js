'use strict';
/**
 * 🔴 **絆線**：佇列的鍵只准有一個來源。
 *
 * 為何而生（2026-09-02 外審 R2 #9）：上一輪抽出了 `qrowKey()`，並在註解裡宣稱
 * 「移除／比對／驗證共用這一把」——**而 `flush` 裡自己寫的第二把還在**。
 * 抽出共用函式之後，會覺得那件事已經做完了，所以這一型最難自己發現。
 * 順藤摸下去還有**第三把在另一個 repo**（後端 `accountedKeys`），寫法又不一樣。
 *
 * ⚠️ **這一層是絆線，不是保證。**
 * - **保證**在 `staff-identity-wiring.test.js`：餵帶空白的內部碼跑完整條 flush，
 *   斷言那一列真的被移除、沒有進隔離區、沒有跳假警告。**繞法不管長什麼樣都會被它擋下。**
 * - 這一層只掃原始碼，**繞得過**（用 `Array.join`、用樣板字串、用別的分隔符…）。
 *   它的價值是「改壞的當下就紅」，不是「改不壞」。
 * - ⇒ **這一層是綠的，什麼都不代表。它變紅才是訊號。**
 *
 * ⚠️ 掃描前必須先剝掉註解——**註解也算原始碼**。這個檔案與 staff.html 的註解裡
 * 都寫著它要禁止的東西，不剝就是一個永遠響的紅燈（而執行者會學會無視它）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 剝掉區塊註解與**整行**註解——留下真正會被執行的那些字。
 *
 * 🔴 **行尾註解刻意不剝**（2026-09-02 外審 R3 #5 的答案是「不做」，理由如下）。
 *
 * 要正確剝掉行尾 `//`，必須先知道那個 `//` 在不在字串裡（`'https://…'` 是常態）。
 * 那是一個手寫的近似 lexer——**跟同一輪因為看不懂正則而被整支刪掉的 `fnByLine`
 * 是同一族**，而且沒有人驗得了它。
 *
 * 決定的判準是**兩種錯的方向**：
 * - 不剝行尾註解 ⇒ 註解裡剛好寫到組鍵 ⇒ **誤報，紅燈，看得見**，把那句註解改寫就好
 * - 剝過頭（把字串裡的 `//` 當註解起點）⇒ **真的第二把鍵被剝掉、靜默放過**
 *
 * ⇒ 取可見的那一種。這跟後端 inventory 那支選「排除清單」而不是「檔案清單」是同一條理由：
 * **兩種列舉的失效方向相反，選會吵的那一種。**
 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 允許組這把鍵的地方：只有這一支。
 *
 * 🔴 判定要比對到左括號為止（2026-09-02 外審 R3 #4）：上一版用 `'function ' + OWNER`
 * 當子字串 ⇒ `function qrowKeyLegacy(...)`、`function qrowKey2(...)` 都含有它
 * ⇒ **第二把鍵只要取個以 qrowKey 開頭的名字就自動免疫**，而這一層正是為了擋第二把鍵而存在。
 */
const OWNER = 'qrowKey';
const OWNER_DECL = 'function ' + OWNER + '(';

test('🔴佇列的鍵只有一個來源：`|` 組鍵只准出現在 qrowKey 裡', () => {
  const src = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8'));
  const hits = src.split('\n')
    .map((line, i) => ({ n: i + 1, line: line.trim() }))
    .filter((x) => x.line.indexOf("'|'") >= 0 || x.line.indexOf('"|"') >= 0);
  assert.ok(hits.length >= 1, '一個都掃不到＝這個掃法本身壞了（qrowKey 自己必須被掃到）');
  const strays = hits.filter((x) => x.line.indexOf(OWNER_DECL) < 0);
  assert.deepEqual(strays, [],
    '又長出第二把組鍵函式了。佇列的鍵有兩個持有人（本檔 qrowKey、後端 accountedKeys），'
    + '兩邊必須逐字相同——不一樣的話送出成功卻移不掉，每 15 秒重送一次而且永遠不會停。\n'
    + '⚠️ 如果掃到的那一行，`|` 其實是在**行尾註解**裡：這一層刻意不剝行尾註解'
    + '（理由見 codeOnly 的說明），把那句註解改寫或搬成整行註解即可。');
});

test('🔴突變自檢：把 qrowKey 那一行的識別字改掉，這條必須紅（證明它不是恆綠）', () => {
  // 「這個判準抓不抓得到東西」自己要有對照組——否則掃法壞掉時它會安靜地一直綠。
  const fake = "function somethingElse(r) { return r.internalId + '|' + r.ts; }";
  const hits = codeOnly(fake).split('\n')
    .filter((l) => l.indexOf("'|'") >= 0)
    .filter((l) => l.indexOf(OWNER_DECL) < 0);
  assert.equal(hits.length, 1, '換個函式名就該被掃出來；掃不到代表這個判準沒有鑑別力');
});

test('🔴突變自檢：名字以 qrowKey 開頭的第二把鍵也必須被抓出來（R3 #4）', () => {
  // 子字串判定會把 `qrowKeyLegacy` 當成合法 owner ⇒ 這一層對「改個名字再組一次」全盲。
  const fake = "function qrowKeyLegacy(r) { return r.internalId + '|' + r.ts; }";
  const hits = codeOnly(fake).split('\n')
    .filter((l) => l.indexOf("'|'") >= 0)
    .filter((l) => l.indexOf(OWNER_DECL) < 0);
  assert.equal(hits.length, 1, 'qrowKeyLegacy 被當成合法 owner ⇒ 這一層擋不住第二把鍵');
});

test('🔴零點對照：真正的 qrowKey 宣告不可以被自己的判定掃成 stray（否則永遠紅）', () => {
  const real = "function qrowKey(r) { return String(r && r.internalId).trim() + '|' + String(r && r.ts); }";
  const hits = codeOnly(real).split('\n')
    .filter((l) => l.indexOf("'|'") >= 0)
    .filter((l) => l.indexOf(OWNER_DECL) < 0);
  assert.deepEqual(hits, [], '判定收太緊會把 owner 自己打紅——那是永遠響的紅燈');
});

test('🔴註解不算：把禁止的寫法寫在註解裡不可以讓這條紅（永遠響的紅燈比沒有判準更糟）', () => {
  const fake = "// var qkeyOf = function (r) { return r.internalId + '|' + r.ts; };\nvar x = 1;";
  const hits = codeOnly(fake).split('\n').filter((l) => l.indexOf("'|'") >= 0);
  assert.deepEqual(hits, [], '註解沒被剝掉＝這條會永遠紅，然後被無視');
});

test('刻意的限制：行尾註解不剝，所以它會誤報——這是選來的方向，不是漏掉的', () => {
  // ⚠️ 這條**不是把缺陷寫成規格**：它釘住的是一個**有理由的取捨**，而理由寫在 codeOnly 上面。
  // 釘住它是為了讓「日後有人順手加一個行尾註解剝除器」這件事會紅，
  // 被迫回去讀那段理由——而不是靜靜換成一個沒人驗得了的近似 lexer。
  const withTrailing = "var x = 1;   // 舊寫法是 r.internalId + '|' + r.ts";
  assert.equal(codeOnly(withTrailing).indexOf("'|'") >= 0, true,
    '行尾註解目前不剝（誤報＝紅燈，看得見）；要改成剝掉之前，先讀 codeOnly 上面那段理由');

  // 對照組：整行註解**必須**剝掉——那一種沒有「字串裡的 //」的風險，而且不剝會永遠紅。
  const fullLine = "  // var qkeyOf = function (r) { return r.internalId + '|' + r.ts; };";
  assert.equal(codeOnly(fullLine).indexOf("'|'") >= 0, false,
    '整行註解不剝＝永遠響的紅燈，那比沒有判準更糟');
});

/* ── 跨 repo 契約：這一側必須組出跟後端一樣的字串 ───────────────────────────
   後端 jdc-line-gas 的 `accountedKeys` 用同一份契約檔跑同樣的案例。
   ⚠️ **沒有任何機制檢查兩份契約檔是否相同**——與「兩個 repo 必須同批上線」同一個缺口。 */

test('🔴★qrowKey 必須符合跨 repo 契約（後端拿同一份跑 accountedKeys）', () => {
  const vm = require('node:vm');
  const contract = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'queue-key-contract.json'), 'utf8'));
  assert.ok(contract.cases.length >= 4, '契約案例被刪光了＝這條什麼都沒測到');
  const src = fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8');
  const m = src.match(/^function qrowKey\b[\s\S]*?\n}|^function qrowKey.*$/m);
  assert.ok(m, 'staff.html 裡找不到 qrowKey');
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(m[0], ctx, { filename: 'staff.html-extract' });
  contract.cases.forEach((c) => {
    assert.equal(ctx.qrowKey(c.row), c.expect, '案例「' + c.why + '」對不上契約');
  });
});
