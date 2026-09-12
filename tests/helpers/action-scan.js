/**
 * 「這一頁會打哪些 action」的**唯一**一支抽取器。
 *
 * ══ 為何有這一支（2026-09-12，線 X）══════════════════════════════════════
 *
 * `attend.html` 開頁第一發打 `batch`，而 `batch` 在後端註冊成 `'any'`
 * ＝**任何看板身分**，view（副總）不在其中 ⇒ 副總開那一頁被蓋上
 * 「連結已失效／這條看板連結已經停用」，**已壞約 3.5 週，875 條前端測試全綠**。
 *
 * 🔴 **真正的成因不是那一行寫錯，是沒有任何東西在問
 *    「每一頁打的 action，那一頁的身分打不打得到」。**
 *    後端 `ci/roles-matrix/baseline.md` 白紙黑字記著 `batch | any | … view ·`——
 *    **資訊一直在，只是沒有人拿它跟頁面對照。**
 *
 * ══ 三個已知的假陽性／假陰性來源，逐一釘死 ═════════════════════════════
 *
 * ① **註解裡的 action 名不是呼叫點。**
 *    `assets/deny-no-role.js` 的檔頭寫著「三頁的首載走 `jsonp('batch', …)`」——
 *    那是一句說明，不是呼叫。**逐字 grep 會把它算成呼叫點**，於是
 *    board/stats/hr-stats 三頁都會多出一支它們其實沒打的 `batch`。
 *    ⇒ 本檔走詞法掃描（comment／string／regex 三種都認得），註解整段丟掉。
 *    （`feedback_comment_is_source_code`：註解會觸發別人的檢查。）
 *
 * ② **`assets/board-cache.js` 的 action 名是「快取分片對照表」不是呼叫點。**
 *    它裡面是 `case 'getActivityStats':` 這種標籤，一支都不是呼叫。
 *    ⬛ **對照組（測試裡釘著）：本檔對 `board-cache.js` 必須回 0 個 batch 子項。**
 *
 * ③ **母體要掃出來，不要手寫。**
 *    `tests/page-load.test.js` 的 `PAGES` 是手維護的——2026-09-12 有人加了一頁
 *    而測試數前後都是 906，**那一頁沒有任何載入防護且零訊號**。
 *    ⇒ 本檔的頁面母體是 repo 根目錄的 `*.html` 現掃，
 *      每頁的 assets 從它自己的 `<script src>` 現讀。
 *
 * ══ 🔴 一個實測踩到的 fail-open，決定了本檔抽什麼 ═══════════════════════
 *
 * 第一版抽的是「這一頁的所有 action 呼叫點」，然後算「哪些身分能用完這一頁」。
 * **實測當場自爆**：`assets/board-cache.js` 裡有 `send.push('listStaffStations')`
 * （那是 `stats.html` 報到分頁在用的），而 `attend.html` 也載入這支 asset
 * ⇒ attend 被算成「需要 listStaffStations」⇒ 受眾被算窄成 `admin,activity`
 * ⇒ **view 本來就不在裡面 ⇒ 檢查變綠 ⇒ 今天這顆抓不到。**
 *
 * ⭐ 教訓：**共用 asset 裡的呼叫點屬於別的頁**，靜態上分不出誰真的會執行到。
 *    多算 ⇒ 受眾變窄 ⇒ **fail-open 且靜默**。
 *
 * ⇒ 改成只抽**局部、結構上封閉**的那一格：`jsonp('batch', {list:[{a:…},…]})`
 *   的子項清單。判準因此不必知道「這一頁的使用者是誰」——見
 *   `tests/page-action-gate.test.js` 檔頭那段推理。
 *
 * ══ 已知的定義域邊界（會少報，而少報是靜默的）═════════════════════════
 *
 * ⚠️ **動態組出來的子項抽不到**：`items=plan.send.map(function(a){return {a:a}})`
 *    （`stats.html` 報到分頁）。那一批的名字寫在 `assets/board-cache.js` 的
 *    `send.push('…')` 裡，本檔不追。測試裡有一條零點盯著「今天抽得到幾支」，
 *    抽法退化成 0 會紅。
 * ⚠️ **本檔不判斷「這一頁直接呼叫的 action，它的使用者打不打得到」**。
 *    那需要一份「頁面 → 身分」的宣告，而那種表腐爛時沒有東西會紅（見測試檔頭）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/* ════════════════════════════════════════════════════════════════════════
 * 一、詞法掃描：把註解丟掉，字串／正則各自認出來
 * ════════════════════════════════════════════════════════════════════════ */

/** 前一個有意義的 token 是這些收尾符號時，`/` 是除號；否則是正則字面值的開頭。 */
const DIV_AFTER = new Set([')', ']', '}']);
/** 這些關鍵字之後的 `/` 仍然是正則（`return /x/` 等）。 */
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await',
]);

/**
 * 把 JS 原始碼切成 token。**註解不會出現在輸出裡。**
 * @param {string} src
 * @returns {Array<{t:'id'|'num'|'str'|'punct'|'regex', v:string, i:number}>}
 */
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const regexAllowed = () => {
    const p = out.length ? out[out.length - 1] : null;
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 'regex') return false;
    if (p.t === 'id') return REGEX_AFTER_KEYWORD.has(p.v);
    return !DIV_AFTER.has(p.v);
  };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') { i++; continue; }
    // 註解
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    // 字串（樣板字串不解析內插：今天前端沒有用樣板字串寫的呼叫點）
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1; let v = '';
      while (j < n) {
        if (src[j] === '\\') { v += src[j + 1] === undefined ? '' : src[j + 1]; j += 2; continue; }
        if (src[j] === q) break;
        v += src[j]; j++;
      }
      out.push({ t: 'str', v, i });
      i = j + 1; continue;
    }
    // 正則字面值
    if (c === '/' && regexAllowed()) {
      let j = i + 1; let cls = false; let ok = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; break; }
        else if (d === '\n') break;          // 未閉合 ⇒ 不是正則，退回當除號
        j++;
      }
      if (ok) {
        while (j + 1 < n && /[a-z]/.test(src[j + 1])) j++;
        out.push({ t: 'regex', v: src.slice(i, j + 1), i });
        i = j + 1; continue;
      }
      out.push({ t: 'punct', v: '/', i }); i++; continue;
    }
    // 識別字（含非 ASCII：本 repo 有中文函式名與變數名）
    if (/[A-Za-z_$¡-￿]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$¡-￿]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), i });
      i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j), i });
      i = j; continue;
    }
    out.push({ t: 'punct', v: c, i }); i++;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * 二、母體：頁面與它載入的 assets
 * ════════════════════════════════════════════════════════════════════════ */

/** repo 根目錄的所有 `*.html`——**現掃，不是手寫清單**。 */
function pages() {
  return fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();
}

/** 一頁的內嵌 `<script>` 原文（有 `src` 的略過，那是外部檔）。 */
function inlineScript(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) { if (!/\bsrc\s*=/.test(m[1])) out.push(m[2]); }
  return out.join('\n');
}

/** 一頁 `<script src="…">` 指到的本地檔（略過 http(s) 外連、不存在的路徑）。 */
function assetsOf(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const u = m[1];
    if (/^https?:|^\/\//i.test(u)) continue;
    if (fs.existsSync(path.join(ROOT, u))) out.push(u);
  }
  return out;
}

/** 一頁真正會跑的所有 JS 來源：`[{name, code}, …]`（第一筆是內嵌的）。 */
function sourcesOf(file) {
  const out = [{ name: file + '#inline', code: inlineScript(file) }];
  assetsOf(file).forEach((a) => out.push({ name: a, code: fs.readFileSync(path.join(ROOT, a), 'utf8') }));
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * 三、抽取
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「第一個參數是字串字面值」的函式呼叫，全部抽出來：`[{callee, arg}, …]`。
 * 形狀 `ident ( 'str'` 與 `obj.ident ( 'str'` 都認（`__rdl.jsonp('getRosterList', …)`）。
 *
 * ⚠️ 這一支**不做語意判斷**——`indexOf('x')`、`push('x')` 也會被抽出來。
 *    呼叫端自己決定要看哪一個 callee／哪一個 arg。
 */
function literalCalls(code) {
  const tk = tokenize(code);
  const out = [];
  for (let k = 0; k + 2 < tk.length; k++) {
    if (tk[k].t !== 'id') continue;
    if (tk[k + 1].t !== 'punct' || tk[k + 1].v !== '(') continue;
    if (tk[k + 2].t !== 'str') continue;
    out.push({ callee: tk[k].v, arg: tk[k + 2].v });
  }
  return out;
}

/**
 * batch 的子項：物件字面值裡 `a: '<action>'` 那一格。
 * `{a:'listActivities'}`／`{ a: 'getActivityStats', p:{…} }`／`{'a':'x'}` 都認。
 * ⚠️ `{a:a}`（值是變數）抽不到——見檔頭的定義域邊界。
 */
function batchItems(code) {
  const tk = tokenize(code);
  const out = [];
  for (let k = 0; k + 2 < tk.length; k++) {
    const isKey = (tk[k].t === 'id' || tk[k].t === 'str') && tk[k].v === 'a';
    if (!isKey) continue;
    if (tk[k + 1].t !== 'punct' || tk[k + 1].v !== ':') continue;
    if (tk[k + 2].t !== 'str') continue;
    out.push(tk[k + 2].v);
  }
  return out;
}

/**
 * 一頁的掃描結果。
 *
 * @param {string} file
 * @returns {{file:string, assets:string[], callsBatch:boolean,
 *            subs:string[], subsBySource:Object<string,string[]>,
 *            calledStrings:string[]}}
 */
function scanPage(file) {
  let callsBatch = false;
  const subs = new Set();
  const subsBySource = {};
  const calledStrings = new Set();
  sourcesOf(file).forEach((s) => {
    literalCalls(s.code).forEach((c) => {
      calledStrings.add(c.arg);
      if (c.arg === 'batch') callsBatch = true;
    });
    const got = batchItems(s.code);
    if (got.length) subsBySource[s.name] = got.slice().sort();
    got.forEach((a) => subs.add(a));
  });
  return {
    file,
    assets: assetsOf(file),
    callsBatch,
    subs: [...subs].sort(),
    subsBySource,
    calledStrings: [...calledStrings].sort(),
  };
}

module.exports = {
  ROOT, tokenize, pages, inlineScript, assetsOf, sourcesOf,
  literalCalls, batchItems, scanPage,
};
