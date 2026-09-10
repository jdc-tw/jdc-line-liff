/**
 * 讀原始碼那一族檢查的**分級**：哪幾道是守門、哪幾道只是絆線（前端這一半）。
 *
 * ══ 為何有這一檔（2026-09-10，工作順序第 14 格 / F5）════════════════════
 *
 * 2026-09-02 構造了 10 個「合法輸入但近似會判錯」的案例，9 個判錯、7 個是少報。
 *
 *   ⭐ **一道用近似寫的檢查，它的價值不等於它抓到過什麼，
 *      而等於你構造得出幾個它抓不到的東西。構造不出來，才有資格說它在守。**
 *
 * `jdc-line-gas` 那一半已經做完（`9f37874`）：①①b② 靠引擎剖析消滅了近似本身，
 * ③⑤⑥ 降級成絆線。那顆自己標了一格留白——**第 ⑦ 道不在那個 repo**，
 * 因為 `gasCall`／`wfCall` 是前端的東西。**本檔就是那一格。**
 *
 * ⚠️ **不是照抄 gas 那份。** 兩邊的失效條件不同，見 `helpers/source-scan.js` 檔頭：
 * gas 側「空 context 跑不完＝紅燈」，liff 側**跑不完是常態**（HTML 一定有頂層碼），
 * 靠的是函式宣告的 hoisting。定義域的邊界因此不一樣，第二節單獨釘。
 *
 * ⚠️ 絆線的三句檔頭格式（「防什麼／抓不到什麼／失效時長什麼樣」）沿用 gas 側那顆。
 *    交接文記著「三句是哪三句沒有任何地方寫下來」——那仍然是未決，換格式就換。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('./helpers/source-scan.js');

const F = 'tests/fixtures/scan-cases.fixture.html';
const F文 = S.scriptText(F);
const 頁文 = S.scriptText('welfare.html');

/** 近似變體 A：`^function N(` 到行首 `}`——`welfare-page-wiring` 等 5 個檔在用的那種。 */
const 近似A = (src, n) => {
  const m = src.match(new RegExp('^function ' + n + '\\([\\s\\S]*?^}', 'm'));
  return m ? m[0] : null;
};
/** 近似變體 C：到第一個 `\n}` 為止——第 ⑦ 道第二處在用的那種。 */
const 近似C = (src, n) => {
  const i = src.indexOf('function ' + n + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n}', i);
  return j < 0 ? src.slice(i) : src.slice(i, j + 2);
};

/* ════════════════════════════════════════════════════════════════════
 * 一、精確取法：先證明它有鑑別力，再證明它比近似對
 * ════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：抽 `<script>` 真的抽到東西，而且是這一頁的量級', () => {
  // 沒有這一格，下面每一條都在空字串上跑——空字串不含任何東西，全部恆真。
  // 🔴 抽 script 是絆線（字串裡的 `</script>` 會提早截斷），失效方向是**少取**，
  //    而少取跟「這一頁沒有那支函式」一模一樣。所以零點要問「取到多少」。
  assert.ok(頁文.length > 20000,
    'welfare.html 只抽到 ' + 頁文.length + ' 字元 ⇒ 抽 script 被提早截斷了');
  assert.ok(S.fnNames('welfare.html').length > 40,
    '只列到 ' + S.fnNames('welfare.html').length + ' 支函式 ⇒ 任何「對每一支都成立」的斷言會變成裝飾品');
});

test('⬛ 零點：精確取法只取那一支，不會吃到隔壁', () => {
  // ⚠️ 第一版照抄 gas 那顆的判準（「本體裡只能有一個 `function`」）——**紅了**，
  //    因為 `wfCall` 本體裡有 `forEach(function (k) {…})`，而 gas 那條的對象沒有。
  //    ⭐ 照抄一條判準，就是把別人受測物的形狀當成規格。改成問邊界本身。
  const b = S.fnSrc('wfCall');
  assert.ok(b.startsWith('function wfCall('), '取到的開頭不是 wfCall：' + b.slice(0, 60));
  assert.ok(b.endsWith('}'), '取到的結尾不是 `}` ⇒ 被截斷了：' + b.slice(-60));
  assert.match(b, /gasCall/, '取到的不是 wfCall 的本體');
  // ⬛ 不會吃到下一支頂層函式：拿實際排在它後面的那支的名字當哨兵
  const 名單 = S.fnNames('welfare.html');
  const 後面的 = 名單.filter((n) => n !== 'wfCall' && 頁文.indexOf('function ' + n + '(') > 頁文.indexOf('function wfCall('));
  assert.ok(後面的.length > 0, '前提不成立：wfCall 後面沒有別的函式了，這格哨兵失效');
  後面的.forEach((n) => {
    assert.ok(b.indexOf('function ' + n + '(') < 0, 'wfCall 的本體裡吃到了下一支 ' + n);
  });
});

test('🔴 反例①：函式體裡有對齊第 0 欄的 `};` ⇒ 近似 A 截斷，helper 不會', () => {
  assert.ok(近似A(F文, '受害者_').indexOf('DANGEROUS_TOKEN') < 0,
    '近似 A 竟然沒被騙 ⇒ 這個反例失效了，換一個能騙到它的');
  assert.ok(S.fnSrc('受害者_', F).indexOf('DANGEROUS_TOKEN') >= 0,
    'helper 也被截斷了 ⇒ 它退回近似了');
});

test('🔴 反例①b：一行寫法的函式 ⇒ 近似 A 吞掉下一支，helper 不會', () => {
  assert.ok(近似A(F文, '一行的_').indexOf('SHOULD_NOT_BE_HERE') >= 0,
    '近似 A 竟然沒吞 ⇒ 這個反例失效了');
  assert.ok(S.fnSrc('一行的_', F).indexOf('SHOULD_NOT_BE_HERE') < 0,
    'helper 吞到隔壁了 ⇒ 它退回近似了');
});

test('🔴 反例 C：巢狀區塊的 `}` 讓「到第一個 \\n} 為止」提早收手', () => {
  assert.ok(近似C(F文, '巢狀收手_').indexOf('LATE_MARKER') < 0,
    '近似 C 竟然沒被騙 ⇒ 這個反例失效了');
  assert.ok(S.fnSrc('巢狀收手_', F).indexOf('LATE_MARKER') >= 0,
    'helper 也提早收手了 ⇒ 它退回近似了');
});

test('🔴 反例①b 不是假想：welfare.html 現在就有一行寫法的函式，近似 A 對它們全錯', () => {
  // 2026-09-10 實測 5 支（q／bumpUiGen／showOtpInput／hideOtpInput／otpValue），
  // 最惡的 `q` 近似取到 2032 字元、實際 113 ⇒ **多吞 1,919 字元**。
  // ⚠️ **不斷言「有幾支」**——那是今天的事實，會腐爛，而且改成多行寫法是合法的。
  const 一行的 = S.fnNames('welfare.html')
    .filter((n) => S.fnSrc(n, 'welfare.html').indexOf('\n') < 0);
  assert.ok(一行的.length > 0,
    '一支一行寫法的函式都沒有了 ⇒ 這條反例在這一頁上失去對象。'
    + '它不是壞了，是沒對象了：確認之後可以刪，但先確認不是 fnSrc 壞掉。');
  一行的.forEach((n) => {
    const 近 = 近似A(頁文, n);
    if (近 === null) return;   // 近似連找都找不到，那是另一種失效，不在這條的範圍
    assert.notStrictEqual(近.trim(), S.fnSrc(n, 'welfare.html').trim(),
      n + ' 的近似取法竟然跟引擎一致 ⇒ 這條反例對它失效了');
  });
});

test('🔴 多吞的方向，「抽到的不是空的」那種零點擋不住', () => {
  // `welfare-page-wiring.test.js` 的對照組寫的是 `s.length > 40`。
  // 🔴 對**多吞**來說長度反而變大 ⇒ 那條零點只驗了「少取」一個方向。
  //    這是本輪量到最值得記的一格：**零點也有極性。**
  const 多吞 = 近似A(頁文, 'q');
  assert.ok(多吞.length > 40, '前提不成立：近似取到的長度沒有 > 40');
  assert.ok(多吞.length > S.fnSrc('q').length * 5,
    '近似取到 ' + 多吞.length + '、實際 ' + S.fnSrc('q').length
    + ' ⇒ 差距沒有大到能示範這件事，換一支或改用實測值');
});

test('🔴 取不到就要吵，不可以靜默回空', () => {
  assert.throws(() => S.fnSrc('這支函式一定不存在_'), /找不到函式/);
});

/* ════════════════════════════════════════════════════════════════════
 * 二、定義域的邊界——這一節是 liff 版特有的，gas 版沒有
 *
 * 🔴 **這些斷言釘的是限制，不是規格。**
 *    每一條的訊息都寫著「這條紅了代表盲區補好了，該做什麼」——
 *    沒有那句話，下一個人會把已知缺陷讀成期望值
 *    （`feedback_comment_enshrines_a_bug` 第二形態：期望值表）。
 * ════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：頂層碼真的會中途拋例外（liff 版整個手法架在這件事上）', () => {
  const d = S.loadDiag('welfare.html');
  assert.ok(d.error,
    'welfare.html 的頂層碼在空 context 裡跑完了 ⇒ 前提變了。'
    + '這不是壞消息，但 helper 檔頭那段「跑不完是常態」要改，'
    + '而且下面那條 `var f = function` 的盲區可能已經消失。');
  assert.ok(d.line > 0 && d.line < d.totalLines,
    '拋出的行號 ' + d.line + ' 不在 1..' + d.totalLines + ' 之間 ⇒ 診斷本身壞了');
});

test('絆線：`var f = function () {}` 寫在載入例外之後 ⇒ **靜默**取不到', () => {
  const ctx = S.contextOf(F);
  assert.strictEqual(typeof ctx['例外後的匿名_'], 'undefined',
    '⬛ 這條紅了＝例外之後的 var 賦值也拿得到了。'
    + '八成是 helper 改成餵 stub 讓頂層碼跑完了——那會讓頁面的頂層副作用真的發生，'
    + '確認過沒有網路請求之後，把這條刪掉並更新 helper 檔頭那格定義域邊界。');
  // ⬛ 零點：不是整個 context 都空的——例外**之前**的同一種寫法拿得到
  assert.strictEqual(typeof ctx['例外前的匿名_'], 'function',
    '例外之前的 var 也拿不到 ⇒ 這不是「邊界」，是 helper 整支壞了');
  // ⬛ 零點：函式宣告不受例外影響（hoisting，規格保證）
  assert.strictEqual(typeof ctx['例外後的宣告_'], 'function',
    '例外之後的 function 宣告拿不到 ⇒ hoisting 沒發生，整個手法的前提不成立');
});

test('絆線：welfare.html 今天沒有頂層 `var f = function`，所以上面那個盲區沒在咬', () => {
  // 🔴 **「現在沒有在咬」與「不會咬」是兩件事，而前者會腐爛。**
  //    它會在有人寫出第一個頂層 `var f = function () {}` 那天開始咬，
  //    而那天**不會有任何訊號**——fnSrc 只會說「找不到函式」，讀起來像打錯字。
  const 頂層var = 頁文.match(
    /^[ \t]*(?:var|const|let)\s+[A-Za-z0-9_$一-鿿]+\s*=\s*(?:function\b|\([^)]*\)\s*=>)/gm) || [];
  assert.deepStrictEqual(頂層var, [],
    '這一頁長出了頂層的 var/const/let = function：\n  ' + 頂層var.join('\n  ')
    + '\n⇒ 寫在載入例外之後的那幾支，本工具**靜默**取不到。'
    + '要嘛改成 `function N() {}` 宣告，要嘛去改 helper（見它檔頭那格定義域邊界）。');
});

/* ════════════════════════════════════════════════════════════════════
 * 三、絆線清冊——每一條釘的是「它抓不到什麼」
 * ════════════════════════════════════════════════════════════════════ */

test('絆線⑥ 剝註解：字串裡的 `//` 會讓整行後半消失', () => {
  const 樣本 = "var s = 'a//b'; var 鈕 = '刪除';";
  assert.ok(S.stripComments(樣本).indexOf('刪除') < 0,
    '⬛ 這條紅了＝剝註解認得字串字面量了。'
    + '把它從「絆線」移到「守門」，刪掉這條測試，並更新 helpers/source-scan.js 的檔頭。');
  // ⬛ 零點：它對正常的行是有效的，不是整支壞掉
  assert.equal(S.stripComments('var a = 1; // 註解').trim(), 'var a = 1;');
  assert.equal(S.stripComments('var a = 1;'), 'var a = 1;');
});

test('絆線⑥b 剝註解：`//` 前面不是 `https:`／`http:` 的網址一律被剝掉', () => {
  const 樣本 = "var w = 'wss://x.tw/a'; var 鈕 = '刪除';";
  assert.ok(S.stripComments(樣本).indexOf('刪除') < 0,
    '⬛ 這條紅了＝例外清單認得更多協定了。把新增的協定寫進 helper 檔頭那格，並更新這條。');
  // ⬛ 零點：https 那個例外真的有效，不是所有網址都被剝
  assert.ok(S.stripComments('src="https://x.tw/a"').indexOf('https://x.tw/a') >= 0,
    'https 網址被當成註解剝掉了 ⇒ 例外清單壞了');
});

test('🔴 剝註解要守住行數（否則逐行比對是在比不同的行）', () => {
  // 2026-09-02 踩過：剝註解會刪行 ⇒ 逐行比 a[i] vs b[i] 等於在比不同的行，
  // 量出「19 行受害」這個單位對、算法對、可重現、方向也合理**而完全錯**的數字。
  // ⚠️ 這一條不是絆線，是守門——第 ⑦ 道第一處會報「第 N 行」，那個 N 靠它才是真的。
  const 樣本 = 'a\n<!-- 一\n   二 -->\nb\n/* 三\n 四 */\nc';
  assert.equal(S.stripComments(樣本).split('\n').length, 樣本.split('\n').length,
    '剝完行數變了 ⇒ 任何拿它做逐行比對、或報「第 N 行」的地方都在講錯的行');
  assert.ok(S.stripComments(樣本).indexOf('二') < 0, '區塊註解沒剝掉');
  assert.ok(S.stripComments(樣本).indexOf('c') >= 0, '剝過頭，程式碼也剝掉了');
});

/* ── 第 ⑦ 道：`jdc-line-gas` 的 `9f37874` 標了留白說「不在那個 repo」，就是這裡 ── */

test('絆線⑦ 掃 `gasCall` 呼叫樣式：改用別名就繞過去了', () => {
  // 對應 `welfare-page-wiring.test.js` 的兩處：
  //   · 逐行掃「不可以有人直接呼叫」那條（剝了註解、報行號）
  //   · 「全頁只能有一個呼叫點」那條計數（**沒有剝註解**）
  // 繞法 2026-09-02 就構造出來了，2026-09-10 在夾具上實跑確認仍然繞得過。
  const 乾淨 = S.stripComments(F文);
  assert.ok(乾淨.indexOf('繞過去的_') >= 0, '前提不成立：夾具裡找不到那支繞過去的函式');
  assert.ok(!/gasCall\s*\(/.test(乾淨),
    '⬛ 這條紅了＝夾具裡出現了直接呼叫的樣式。先確認不是有人在夾具裡加了新東西；'
    + '如果是那道檢查變聰明了（認得別名），把它移到守門並刪掉這條。');
  // ⬛ 零點：那支函式**真的**會走到 gasCall，不是這個夾具本來就沒事
  assert.match(S.fnSrc('繞過去的_', F), /送\(GAS_URL/,
    '夾具那支沒有透過別名呼叫 ⇒ 這條什麼都沒證明');
});

test('絆線⑦b 計數式沒有剝註解：註解裡寫出那個樣式就會多報', () => {
  // 多報＝會紅＝吵，方向比 ⑦ 好，但它仍然是絆線：**紅的原因會指錯人。**
  // 有人在註解裡寫下那個樣式，訊息會說「多出來的那個不會帶 idToken」——
  // 而那一處根本不是程式碼。修的人會去找一個不存在的呼叫點。
  const 假 = 頁文 + '\n// 舉例說明：gasCall(GAS_URL, "x", {}, 1)\n';
  const 未剝 = (假.match(/gasCall\s*\(\s*GAS_URL/g) || []).length;
  const 剝了 = (S.stripComments(假).match(/gasCall\s*\(\s*GAS_URL/g) || []).length;
  assert.strictEqual(未剝, 剝了 + 1,
    '⬛ 這條紅了＝那條計數改成先剝註解了（未剝 ' + 未剝 + '、剝了 ' + 剝了 + '）。'
    + '把這條刪掉，並把 welfare-page-wiring 那條的註解一起更新。');
  // ⬛ 零點：這一頁**今天**的註解沒有觸發它——但那是今天的事實
  assert.strictEqual((頁文.match(/gasCall\s*\(\s*GAS_URL/g) || []).length, 1,
    '這一頁現在就有多報或漏報 ⇒ 不是理論風險，去看 welfare-page-wiring 那條');
});

/* ════════════════════════════════════════════════════════════════════
 * 四、還在手寫抽取式的檔要列出來——而這份清單只能縮短
 *
 * ⚠️ 這仍然是一份列舉。選它的理由是**失效方向相反**：
 *      沒列到 ⇒ 🔴 **紅燈**（新檔手寫、或忘了列）——會吵
 *      多列了 ⇒ 🔴 **紅燈**（已經遷移完卻沒從清單刪）——也會吵
 *    兩個方向都吵，沒有一個方向是靜默的。
 *
 * 🔴 **這道掃描自己就是近似，而且我拿三把尺量到三個答案**（2026-09-10）：
 *      樣式表列舉（`'^function` 等 8 種）        → 15 個檔，**漏了 old-code-behavior**
 *      `new RegExp(…function` 同一行             → 13 個檔，**同樣漏了它**（它換行寫）
 *      「引號裡出現 `function `」（現在用的）      → 22 個檔，全部涵蓋
 *    ⇒ **前兩把都回了一個真實的、看起來查過了的數字。**
 *      手選的關鍵詞表就是自己選的定義域，而它不會回 0。
 * ════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('node:path');

/** 判準：原始碼裡出現「被引號或正規式包起來的 `function `」——拼函式宣告樣式必經之路。 */
const 抽取式樣式 = /['"/][^'"/\n]*function\s/;

/**
 * 🔴 這兩個檔**必然**含那個樣式，因為它們就是在講這件事。
 *    不排除的話這道檢查會變成「永遠響的紅燈」，而永遠響的紅燈會被學會無視——
 *    比沒有判準更糟（`feedback_comment_is_source_code` 第五形態）。
 * ⚠️ **代價明寫**：`welfare-page-wiring` 被排除之後，它哪天**真的**改回手寫抽取式，
 *    這道掃描不會叫。守那一格的是它自己那兩條行為測試
 *    （「取函式本體用的是引擎剖析」「剝註解守住行數」），2026-09-10 實測突變各打紅一條。
 */
const 本來就會有 = ['source-scan-tripwire.test.js', 'welfare-page-wiring.test.js'];

/** 還在手寫的檔。**只能刪，不能加**——要加的話先問「為什麼這一支不能用共用的」。 */
const 尚未遷移 = [
  'bind-friend-gate-wiring.test.js', 'bind-link-card.test.js',
  'board-cache-wiring.test.js', 'board-nonce.test.js', 'call-nonce.test.js',
  'checkin-empno-conflict.test.js', 'deny-no-role.test.js',
  'download-menu-wiring.test.js', 'msglog-order.test.js',
  'no-inline-transport.test.js', 'old-code-behavior.test.js',
  'partial-failure-consumers.test.js', 'pass-cache.test.js',
  'pass-diag-wiring.test.js', 'pass-done-wiring.test.js',
  'qr-person-identity.test.js', 'queue-key-single-source.test.js',
  'staff-identity-wiring.test.js', 'staff-loop-wiring.test.js',
  'tpl-editor.test.js',
];

function 手寫的檔() {
  const dir = __dirname;
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && 本來就會有.indexOf(f) < 0)
    .filter((f) => 抽取式樣式.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort();
}

test('🔴 沒列在「尚未遷移」裡的檔，不可以自己手寫抽取式', () => {
  const 多出來的 = 手寫的檔().filter((f) => 尚未遷移.indexOf(f) < 0);
  assert.deepStrictEqual(多出來的, [],
    '這幾個檔手寫了取函式本體的式子：\n  ' + 多出來的.join('\n  ')
    + '\n⇒ 改用 require("./helpers/source-scan.js")。'
    + '真的不能用就把檔名加進「尚未遷移」，並在這裡寫下為什麼。');
});

test('🔴 清單只能縮短：已經遷移完的檔不可以還留在清單裡', () => {
  const 已經沒有了 = 尚未遷移.filter((f) => 手寫的檔().indexOf(f) < 0);
  assert.deepStrictEqual(已經沒有了, [],
    '這幾個檔已經不手寫了，把它們從「尚未遷移」刪掉：\n  ' + 已經沒有了.join('\n  ')
    + '\n⇒ 留著的話這份清單會慢慢變成一份說謊的名冊。');
});

test('⬛ 零點：這道掃描真的掃得到東西（否則上面兩條在空集合上恆真）', () => {
  assert.ok(手寫的檔().length > 0, '掃到 0 個檔 ⇒ 樣式或路徑壞了，上面兩條什麼都沒測到');
  assert.ok(手寫的檔().indexOf('old-code-behavior.test.js') >= 0,
    '已知手寫的 old-code-behavior.test.js 沒被掃到 ⇒ 量法有假陰性。'
    + '**它就是前兩把尺漏掉的那一個**（它把 `new RegExp(` 與 `function ` 寫成兩行）。');
});
