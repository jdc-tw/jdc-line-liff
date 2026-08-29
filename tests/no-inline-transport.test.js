const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 任何 .html 不得自己定義呼叫 GAS 的傳輸函式——請用 assets/gas-call.js。
 *
 * 為何存在（2026-08-26）：實測全站 8 支 jsonp ＋ 1 支 jsonpW，**7 種不同實作**，
 * 而差異是語意的（空參數過濾／錯誤加工／重試策略），不是排版的。
 * 其中 stats.html 的重試刻意做成「只有讀取才重試」，註解寫明
 * 「這裡再重試會疊成雙重、有重複送出風險」。
 *
 * 🔴 **下面的 ALLOW 是「債務清單」，只准變短、不准變長。**
 *    每遷走一頁就刪一行；新頁面**不准加進來**。
 *    沒有這條測試的話，assets/gas-call.js 只會變成第 9 種實作。
 */
const ROOT = path.join(__dirname, '..');
const RE = /function\s+(jsonp\w*|gasCall\w*)\s*\(/g;

// ⚠️ 只准刪、不准加。加一行之前先想清楚為什麼不能用 assets/gas-call.js。
const ALLOW = {
  'admin.html': 1, 'attend.html': 1, 'board.html': 1, 'hr-stats.html': 1,
  'index.html': 1, 'stats.html': 2, 'verify.html': 1, 'wall.html': 1,
};

test('🔴 .html 不得自己定義傳輸函式（既有的在 ALLOW 裡，只准變短）', () => {
  const bad = [];
  fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).forEach((f) => {
    const n = (fs.readFileSync(path.join(ROOT, f), 'utf8').match(RE) || []).length;
    const allowed = ALLOW[f] || 0;
    if (n > allowed) {
      bad.push(`${f}: 有 ${n} 支，只准 ${allowed} 支`
        + (allowed === 0 ? '——請 <script src="assets/gas-call.js"> 然後用 gasCall()' : ''));
    }
  });
  assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
});

test('🔴 ALLOW 只准變短：列在裡面的頁面若已經遷走，要把那一行刪掉', () => {
  const stale = Object.keys(ALLOW).filter((f) => {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) return true;                        // 檔案沒了
    return (fs.readFileSync(p, 'utf8').match(RE) || []).length < ALLOW[f];
  });
  assert.deepStrictEqual(stale, [],
    '這幾頁的傳輸函式已經比 ALLOW 少了，請把 ALLOW 改小或刪掉那一行：' + stale.join(', '));
});

test('對照組：這條真的抓得到新增的 inline 傳輸函式', () => {
  const probe = 'function jsonp(action, params) { }';
  assert.equal((probe.match(RE) || []).length, 1, '偵測樣式壞了');
  const clean = 'gasCall(GAS_URL, "a", {}, 30000);';           // 呼叫不算定義
  assert.equal((clean.match(RE) || []).length, 0, '把呼叫誤判成定義了');
});
