/**
 * workflow 的變數接線。
 *
 * 為何存在（2026-09-10）：`update-hr-stats.yml` 曾經一次寫錯**三個** repo variable 名字
 *（`GCP_WIF_PROVIDER`／`GCP_WIF_SERVICE_ACCOUNT`／`IDENTITY_BASE`，而 repo 上設的是
 * `WIF_PROVIDER`／`IDENTITY_SA`／`IDENTITY_URL`）。兩個人各自命名同一組東西，
 * 而**沒有任何東西要求它們相等**。失敗方向是 `vars.X` 取到空字串，
 * 那個紅讀起來像「WIF 設錯了」，但 WIF 完全正確。
 *
 * 🔴 **這支測試驗得到什麼、驗不到什麼，先講清楚：**
 *
 *   驗得到（§2）：**同一步之內**，`run:` 用到的環境變數有沒有在那一步的 `env:` 宣告。
 *                 這是真的機械檢查，沒有第二份清單——錨點就是檔案自己。
 *
 *   ❌ 驗不到：`vars.WIF_PROVIDER` 這個名字在 GitHub 上**存不存在**。
 *              唯一的真相來源是 `gh variable list -R jdc-tw/jdc-line-liff`，
 *              那要網路與權限，不在單元測試的射程內。
 *              §1 只是把「這支要哪些外部名字」印出來讓人比對——**它不是檢查，
 *              它永遠會通過**。刻意不寫成「必須等於某張硬編清單」：那會變成
 *              第三份要同步的東西，而我們正在修的就是「兩份不同步」。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');

/** 去掉 YAML 註解行。⚠️ 註解裡寫 `vars.X` 當例子會被算成「這支要這個變數」——寫這支時當場踩到。 */
const stripComments = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** 這支 workflow 要求外部提供哪些名字。 */
function externalNames(src) {
  const m = stripComments(src).match(/(?:vars|secrets)\.[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return [...new Set(m)].sort();
}

/** 拆成 step。step 的界線是 6 個空格 + `- `。 */
function steps(src) {
  return stripComments(src).split(/\n(?=      - )/).slice(1);
}

/** 一個 step 的 `env:` 宣告了哪些鍵。 */
function envKeys(step) {
  const m = /\n\s*env:\n((?:\s{10,}\S[^\n]*\n)+)/.exec(step + '\n');
  if (!m) return [];
  return (m[1].match(/^\s+([A-Za-z_][A-Za-z0-9_]*):/gm) || [])
    .map((l) => l.trim().replace(':', ''));
}

/**
 * 一個 step 的 shell 腳本用到哪些環境變數。
 *
 * 先剝掉 `${{ }}`——那是 GitHub 運算式不是 shell 變數。
 *
 * 🔴 **只認全大寫的名字，這是刻意的限制**：`run:` 裡常常內嵌 `node -e`，
 *    而 JS 的模板字串 `${f}`／`${i}` 與 shell 的 `${VAR}` **長得一模一樣**。
 *    （寫這支時當場踩到：`syntax-check.yml` 的 `` `${f} inline#${i-1}` `` 被算成
 *    「用了沒宣告的環境變數」。那不是缺陷，是我的尺咬到別的語言。）
 *    這個 repo 的 env 鍵一律全大寫，用大小寫當分界。
 *
 * ⚠️ **代價寫在這裡**：小寫的環境變數這支測不到。要用小寫 env 鍵的人不會被擋。
 */
function shellVars(step) {
  const runIdx = step.indexOf('run:');
  if (runIdx < 0) return [];
  const body = step.slice(runIdx).replace(/\$\{\{[^}]*\}\}/g, '');
  const m = body.match(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g) || [];
  const SHELL_BUILTIN = ['PATH', 'HOME', 'PWD', 'GITHUB_ENV', 'GITHUB_OUTPUT', 'RUNNER_TEMP'];
  return [...new Set(m.map((x) => x.replace(/[${}]/g, '')))]
    .filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v))
    .filter((v) => !SHELL_BUILTIN.includes(v));
}

// ─────────── §1 把外部名字放到眼前（不是檢查，永遠會過）───────────

test('§1 這支 workflow 要求外部提供的名字（拿去跟 gh variable/secret list 比對）', () => {
  const names = externalNames(read('update-hr-stats.yml'));
  console.log('\n  update-hr-stats.yml 需要：\n    ' + names.join('\n    ')
    + '\n  比對指令：gh variable list -R jdc-tw/jdc-line-liff'
    + '\n            gh secret   list -R jdc-tw/jdc-line-liff\n');
  assert.ok(names.length > 0, '一個外部名字都抓不到 ⇒ 抓法壞了，不是這支不需要變數');
});

test('⬛ 零點：註解裡的 `vars.X` 不算數（否則自己的說明文字會被算成需求）', () => {
  const 假檔 = '      - name: x\n        run: echo 1\n';
  assert.deepEqual(externalNames('# 這行講 vars.NOT_REAL 只是舉例\n' + 假檔), []);
  assert.deepEqual(externalNames('        run: echo ${{ vars.REAL_ONE }}\n'), ['vars.REAL_ONE']);
});

// ─────────── §2 真正的機械檢查：同一步之內的接線 ───────────

test('🔴 §2 每一支 workflow：`run:` 用到的變數都要在同一步的 `env:` 宣告', () => {
  const bad = [];
  for (const f of fs.readdirSync(WF).filter((x) => x.endsWith('.yml'))) {
    steps(read(f)).forEach((st) => {
      const declared = envKeys(st);
      shellVars(st).forEach((v) => {
        // 只看「像是要從 env 來的」——腳本自己 `X=...` 定義的不算
        const selfAssigned = new RegExp('^\\s*(?:export\\s+)?' + v + '=', 'm').test(st);
        if (!declared.includes(v) && !selfAssigned) {
          bad.push(f + ' → $' + v + '（那一步的 env: 只有 ' + (declared.join(',') || '空') + '）');
        }
      });
    });
  }
  assert.deepStrictEqual(bad, [],
    '這些變數在腳本裡用了、卻沒有人給值 ⇒ 取到空字串，而空字串不會報錯：\n' + bad.join('\n'));
});

test('⬛ 零點：§2 抓得到「用了但沒宣告」——沒有這條，上面那條全綠不代表它在檢查', () => {
  const 壞的 = [
    '      - name: 少宣告一個',
    '        env:',
    '          A: 1',
    '        run: |',
    '          echo "${A}" "${B}"',
    ''].join('\n');
  const st = steps('jobs:\n  x:\n    steps:\n' + 壞的);
  assert.equal(st.length, 1, 'step 切不出來 ⇒ 切法壞了');
  assert.deepEqual(envKeys(st[0]), ['A']);
  assert.deepEqual(shellVars(st[0]), ['A', 'B']);
  assert.ok(!envKeys(st[0]).includes('B'), 'B 沒被宣告，這正是要被抓到的形狀');
});

test('⬛ 零點：小寫的（JS 模板字串那種）不算 shell 變數——這是上面那條的已知盲區，釘住它', () => {
  const js = ['      - name: 內嵌 node',
              '        run: |',
              '          node -e "console.log(`${f} 與 ${i}`)"', ''].join('\n');
  const st = steps('jobs:\n  x:\n    steps:\n' + js);
  assert.deepEqual(shellVars(st[0]), [], 'JS 模板字串被當成環境變數 ⇒ 這支會對別人的檔誤報');
});
