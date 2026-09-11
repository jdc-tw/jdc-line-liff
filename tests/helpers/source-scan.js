/**
 * 從前端原始碼取東西的**唯一**一支（liff 側）。
 *
 * ══ 為何有這一支（2026-09-10，工作順序第 14 格 / F5 的前端那一半）══════════
 *
 * `jdc-line-gas` 的同名 helper（`9f37874`，2026-09-07）證明了一件事：
 * **抽一支共用的「近似」述詞只消滅「多份實作會分歧」，沒有消滅「近似本身會判錯」。**
 * 那一輪的修法是讓 V8 自己剖析，`Function.prototype.toString()` 規格保證逐字。
 *
 * 本檔把同一個手法搬到前端。**但兩邊的失效條件不同，不可以照抄那份檔頭**：
 *
 * ┌ gas 側 ─────────────────────────────────────────────────────────────
 * │ 來源是 `.js`，整個檔幾乎只有函式宣告 ⇒ 空 context 跑得完。
 * │ **跑不完＝紅燈**，那是它唯一的失效條件，而且方向是吵的。
 * ├ liff 側（本檔）─────────────────────────────────────────────────────
 * │ 來源是 `.html`，內嵌 script 一定有會執行的頂層碼
 * │ （2026-09-10 實測：`welfare.html` 在 script 第 38 行拋 `location is not defined`，
 * │  全長 1016 行）。**跑不完是常態，不是訊號。**
 * └─────────────────────────────────────────────────────────────────────
 *
 * ⇒ 所以本檔靠的是**函式宣告的 hoisting**：`function N() {}` 在腳本開始執行前
 *   就已經綁進 context，**中途拋例外不影響它們**。這是規格保證的，不是巧合。
 *   2026-09-10 實測 `welfare.html`：例外之後 context 裡有 50 支函式，
 *   與 `^function` 近似列舉**逐名比對差集兩邊皆空**。
 *
 * ⚠️ **定義域的邊界（這是本檔與 gas 版真正的差異，不要抹掉）**：
 *   `var f = function () {}` 與箭頭函式**不是** hoisting 的，它們靠執行到那一行才賦值。
 *   ⇒ 寫在例外行**之後**的那種函式，本檔**取不到**，而且是**靜默**取不到。
 *   `welfare.html` 今天頂層那種寫法是 0 個，所以現在無害——**但那是今天的事實。**
 *   盲區釘在 `tests/source-scan-tripwire.test.js`，補好了那條會紅並告訴你怎麼收。
 *
 * ⚠️ 抽 `<script>` 這件事本身也是近似（見 `scriptText` 的註解）。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const cache = new Map();

/** 讀原始碼原文（單一讀取點，省得每個檔各自拼路徑）。 */
function sourceText(file) {
  const f = file || 'welfare.html';
  const key = 'txt:' + f;
  if (!cache.has(key)) cache.set(key, fs.readFileSync(path.join(ROOT, f), 'utf8'));
  return cache.get(key);
}

/**
 * ⚠️ **絆線**：把 HTML 裡的內嵌 `<script>` 內容接起來（跳過有 `src` 的）。
 *
 * 這道近似在防什麼   讓下面的引擎剖析拿得到「這一頁真正會跑的那段 JS」。
 * 它抓不到什麼       字串或註解裡出現 `</script>` 會**提早截斷**那一塊。
 *                    要精確就得剖析 HTML，而那是把近似搬到更難察覺的位置。
 * 失效時長什麼樣     🔴 **少取，跟「這一頁沒有那支函式」一模一樣。**
 *                    ⇒ 所以 `contextOf` 的零點要斷言「關鍵函式取得到」，
 *                      不是斷言「沒有錯誤」。
 *
 * 非 `.html` 的檔直接回原文（`assets/*.js` 走這一條）。
 */
function scriptText(file) {
  const f = file || 'welfare.html';
  const src = sourceText(f);
  if (!/\.html?$/i.test(f)) return src;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    if (/\bsrc\s*=/.test(m[1])) continue;   // 外部檔，內容不在這一頁
    out.push(m[2]);
  }
  return out.join('\n');
}

/**
 * 把原始碼載進空 context——函式宣告會綁上去，頂層碼跑到哪算哪。
 *
 * 🔴 **例外是吞掉的，不是忽略的**：診斷留在 `loadDiag(file)`，由測試去釘。
 *    吞掉的理由見檔頭——在 HTML 這一側，拋例外是常態而不是訊號。
 *    ⚠️ 空 context 裡沒有 `fetch`／`XMLHttpRequest`／`liff`，
 *      所以頂層碼**送不出任何請求**。這一點是刻意的，不要餵 stub 讓它「跑完」。
 */
function contextOf(file) {
  const f = file || 'welfare.html';
  const key = 'ctx:' + f;
  if (!cache.has(key)) {
    const ctx = vm.createContext(Object.create(null));
    const body = scriptText(f);
    let diag = { error: null, line: null, totalLines: body.split('\n').length };
    try {
      vm.runInContext(body, ctx, { filename: f });
    } catch (e) {
      const hit = String(e.stack || '').match(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)'));
      diag = { error: e.message, line: hit ? Number(hit[1]) : null, totalLines: diag.totalLines };
    }
    cache.set(key, ctx);
    cache.set('diag:' + f, diag);
  }
  return cache.get(key);
}

/** 載入診斷：`{ error, line, totalLines }`。`error` 為 null 代表頂層碼整段跑完了。 */
function loadDiag(file) {
  contextOf(file);
  return cache.get('diag:' + (file || 'welfare.html'));
}

/**
 * 一支函式的**逐字**原始碼。
 * @param {string} name 函式名
 * @param {string} [file] 預設 `welfare.html`
 */
function fnSrc(name, file) {
  const f = file || 'welfare.html';
  const fn = contextOf(f)[name];
  if (typeof fn !== 'function') {
    throw new Error(
      '找不到函式 ' + name + '（' + f + '）——改名了就要同步改測試。' +
      '\n⚠️ 也可能是它寫成 `var f = function () {}` 而且在載入例外之後：' +
      '那種寫法不是 hoisting 的，本工具取不到（見 helpers/source-scan.js 檔頭）。');
  }
  return fn.toString();
}

/**
 * 檔案裡所有取得到的頂層函式名字。
 * ⚠️ 「取得到」不等於「存在」——見檔頭那格定義域邊界。
 */
function fnNames(file) {
  const ctx = contextOf(file);
  return Object.getOwnPropertyNames(ctx).filter((n) => typeof ctx[n] === 'function');
}

/* ══════════════════════════════════════════════════════════════════════
 * ⚠️ 以下是**絆線**，不是守門。
 *
 * 這道檢查在防什麼   剝掉註解，讓「原始碼裡不可以出現 X」這種斷言不會被一句
 *                    寫著 X 的註解騙過去（`feedback_comment_is_source_code`）。
 * 它抓不到什麼       字串字面量裡的 `//`。`var s = 'a//b'; var btn = '刪除';`
 *                    ⇒ **整行後半被當成註解剝掉**，「畫面上不可以有刪除入口」回「乾淨」。
 * 失效時長什麼樣     🔴 **少報，跟「乾淨」一模一樣。** 沒有錯誤訊息、沒有紅燈。
 *
 * ⇒ 只能拿來**降低雜訊**，不可以拿來下「這裡沒有 X」的結論。
 *   盲區釘在 `tests/source-scan-tripwire.test.js`。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 絆線：剝 HTML 註解、JS 區塊註解、行註解。
 *
 * ⚠️ **`https?:` 那個例外是刻意的**：`src="https://x"` 的 `//` 不是註解。
 *    它只認得**緊接在 `//` 前面**的 `https:`／`http:`，其他協定（`ws://`、`//cdn…`
 *    這種 protocol-relative 網址）一律被當成註解剝掉 ⇒ 又是一種少報。
 */
function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split('\n').map((ln) => {
      const i = ln.indexOf('//');
      return i < 0 || /https?:$/.test(ln.slice(0, i)) ? ln : ln.slice(0, i);
    }).join('\n');
}

module.exports = { sourceText, scriptText, contextOf, loadDiag, fnSrc, fnNames, stripComments };
