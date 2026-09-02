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

/** 剝掉區塊註解與行註解——留下真正會被執行的那些字。 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 允許組這把鍵的地方：只有這一支。 */
const OWNER = 'qrowKey';

test('🔴佇列的鍵只有一個來源：`|` 組鍵只准出現在 qrowKey 裡', () => {
  const src = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8'));
  const hits = src.split('\n')
    .map((line, i) => ({ n: i + 1, line: line.trim() }))
    .filter((x) => x.line.indexOf("'|'") >= 0 || x.line.indexOf('"|"') >= 0);
  assert.ok(hits.length >= 1, '一個都掃不到＝這個掃法本身壞了（qrowKey 自己必須被掃到）');
  const strays = hits.filter((x) => x.line.indexOf('function ' + OWNER) < 0);
  assert.deepEqual(strays, [],
    '又長出第二把組鍵函式了。佇列的鍵有三個持有人（本檔 qrowKey、flush 的移除比對、'
    + '後端 accountedKeys），三邊必須逐字相同——'
    + '不一樣的話送出成功卻移不掉，每 15 秒重送一次而且永遠不會停。');
});

test('🔴突變自檢：把 qrowKey 那一行的識別字改掉，這條必須紅（證明它不是恆綠）', () => {
  // 「這個判準抓不抓得到東西」自己要有對照組——否則掃法壞掉時它會安靜地一直綠。
  const fake = "function somethingElse(r) { return r.internalId + '|' + r.ts; }";
  const hits = codeOnly(fake).split('\n')
    .filter((l) => l.indexOf("'|'") >= 0)
    .filter((l) => l.indexOf('function ' + OWNER) < 0);
  assert.equal(hits.length, 1, '換個函式名就該被掃出來；掃不到代表這個判準沒有鑑別力');
});

test('🔴註解不算：把禁止的寫法寫在註解裡不可以讓這條紅（永遠響的紅燈比沒有判準更糟）', () => {
  const fake = "// var qkeyOf = function (r) { return r.internalId + '|' + r.ts; };\nvar x = 1;";
  const hits = codeOnly(fake).split('\n').filter((l) => l.indexOf("'|'") >= 0);
  assert.deepEqual(hits, [], '註解沒被剝掉＝這條會永遠紅，然後被無視');
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
