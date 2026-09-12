/**
 * hr-stats.html：帶身分那一發（`getHrStats`）失敗時，畫面必須說出發生了什麼。
 *
 * ══ 為何存在（2026-09-12，線上缺陷）════════════════════════════════════════
 * 這一頁是兩段式渲染：公開聚合檔先畫圖表（姓名在後端就被剝掉），
 * gated 那一發回來才填上真名。**而 gated 失敗時，改動前的程式一個字都不會說**——
 * `denyNoRole` 只認 `role_mismatch`、`cacheVerdict` 只認「無權限或連結已失效」前綴，
 * 其餘全部落進 `else if (!painted) renderHr(r)`，而公開檔已經畫好 ⇒ **什麼都不做**。
 * 使用者看到的是圖表全部正常、姓名欄每一列停在「需權限，載入中…」，永遠不變。
 *
 * ⚠️ **這一格特別容易做出假綠燈**：「失敗時會說話」用「有沒有字」去斷言的話，
 *    「不管什麼都說同一句」也會全綠。所以下面的斷言是**兩兩相異**與
 *    **未列到的代號要把代號原樣印出來**，不是「不為空」。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { fnSrc, scriptText, stripComments, sourceText } = require('./helpers/source-scan.js');

/* ── 把三支函式從 hr-stats.html 逐字取出來，放進同一個 context ────────────
 * 三支共用 `HR_GATE_FAIL` 這一格，分開 new Function 會讓 markGateFail 寫的那一格
 * 與 lockText 讀的那一格不是同一個 ⇒ 測出來的「有接上」是假的。          */
function makeDom() {
  const mk = (tag) => ({
    tag: tag || 'div', id: '', className: '', textContent: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
  });
  const main = mk('div');
  main.id = 'main';
  const inserted = [];
  main.parentNode = { insertBefore(el) { inserted.push(el); } };
  const locks = [mk('span'), mk('span'), mk('span')];
  locks.forEach((l) => { l.className = 'lock'; l.textContent = '需權限，載入中…'; });
  const warns = [];
  const document = {
    getElementById: (id) => (id === 'main' ? main : (inserted.find((e) => e.id === id) || null)),
    createElement: mk,
    querySelectorAll: (sel) => (sel === '.rl .lock' ? locks : []),
    body: { appendChild() { throw new Error('不該走到 body fallback：#main 是在的'); } },
  };
  return { document, main, inserted, locks, warns };
}

function load() {
  const dom = makeDom();
  const con = { warn: (...a) => dom.warns.push(a.join(' ')), log() {}, error() {} };
  const ctx = vm.createContext({
    document: dom.document, console: con, window: { console: con },
    Object, String, Number, Array, Boolean, JSON,
  });
  vm.runInContext(
    'var HR_GATE_FAIL = null;\n'
    + fnSrc('lockText', 'hr-stats.html') + '\n'
    + fnSrc('gateFailText', 'hr-stats.html') + '\n'
    + fnSrc('markGateFail', 'hr-stats.html') + '\n',
    ctx, { filename: 'hr-stats-extracted.js' });
  return { ctx, dom };
}

const { ctx: C } = load();
const fail = (r) => C.gateFailText(r);

/* ══ ⬛ 零點 ══════════════════════════════════════════════════════════════ */

test('⬛ 零點：三支函式真的從 hr-stats.html 抓出來了', () => {
  assert.equal(typeof C.gateFailText, 'function');
  assert.equal(typeof C.lockText, 'function');
  assert.equal(typeof C.markGateFail, 'function');
});

test('⬛ 零點：還沒失敗時，姓名欄寫的就是原本那句（這條綠了才證明下面的紅是真的）', () => {
  const { ctx } = load();
  assert.equal(ctx.lockText(), '需權限，載入中…');
});

/* ══ 說了「正確的話」，不是「同一句話」 ═══════════════════════════════════ */

// 四類使用者必須分得出來的失敗（題目點名的那四種）＋ LINE 路上其餘代號。
const REASONS = ['role_mismatch', 'role_unresolved', 'line_bad_token', 'line_no_token',
  'line_unbound', 'line_ambiguous', 'line_upstream', 'line_needs_sheet',
  'token_invalid', 'token_ambiguous'];

test('🔴 題目點名的四種，橫幅與姓名欄兩兩相異', () => {
  const four = ['role_mismatch', 'line_bad_token', 'token_invalid', 'role_unresolved'];
  const banners = four.map((x) => fail({ ok: false, reason: x, msg: 'M' }).banner);
  const locks = four.map((x) => fail({ ok: false, reason: x, msg: 'M' }).lock);
  assert.equal(new Set(banners).size, four.length, '橫幅有兩種以上撞成同一句：' + banners.join(' ｜ '));
  assert.equal(new Set(locks).size, four.length, '姓名欄有兩種以上撞成同一句：' + locks.join(' ｜ '));
});

test('🔴 全部代號的橫幅兩兩相異——「不管什麼都說同一句」會在這裡紅', () => {
  const banners = REASONS.map((x) => fail({ ok: false, reason: x, msg: 'M' }).banner);
  assert.equal(new Set(banners).size, REASONS.length,
    '有代號共用同一句橫幅：\n  ' + banners.join('\n  '));
});

test('🔴 各講各的處置：叫人重登的、叫人找人的、叫人換連結的，不可以互相混用', () => {
  // 判準沿用後端 roles.js GATE_REJECT 的分類：他接下來該做什麼。
  assert.match(fail({ reason: 'line_bad_token' }).banner, /重新開啟|重新登入/);
  assert.match(fail({ reason: 'line_unbound' }).banner, /綁定/);
  assert.match(fail({ reason: 'role_unresolved' }).banner, /重新登入不會有用/);
  assert.match(fail({ reason: 'role_mismatch' }).banner, /連結/);
  // ⬛ 對照組：「重登沒用」與「去重登」必須不是同一句，否則上面四條等於沒測
  assert.notEqual(fail({ reason: 'role_unresolved' }).banner,
    fail({ reason: 'line_bad_token' }).banner);
});

/* ══ 🔴 沒列到的也要說 ════════════════════════════════════════════════════ */

test('🔴 未知代號：照樣說話，而且把代號原樣印出來', () => {
  const v = fail({ ok: false, reason: 'brand_new_reason_2027', msg: '後端換了說法' });
  assert.match(v.banner, /brand_new_reason_2027/, '未知代號沒有被印出來，維護者查不到是哪一條路');
  assert.match(v.banner, /後端換了說法/);
  assert.notEqual(v.lock, '需權限，載入中…');
});

test('🔴 完全沒有 reason（後端沒給）：也要說，而且要說「沒有回代號」', () => {
  const v = fail({ ok: false, msg: '找不到員工名冊' });
  assert.match(v.banner, /沒有回代號/);
  assert.match(v.banner, /找不到員工名冊/);
});

test('🔴 空物件／null 也不能靜默', () => {
  for (const r of [{}, null, undefined, { ok: false }]) {
    const v = fail(r);
    assert.ok(v.banner && v.banner.length > 0, '回應是 ' + JSON.stringify(r) + ' 時橫幅是空的');
    assert.ok(v.lock && v.lock.length > 0);
  }
});

test('🔴 任何回應——已知或未知——姓名欄都不可以再寫「載入中」', () => {
  const all = REASONS.concat(['', 'zzz_unknown']).map((x) => fail({ ok: false, reason: x }));
  all.push(fail({ ok: false, msg: '連線逾時，請重新整理。' }));
  all.push(fail(null));
  for (const v of all) {
    assert.ok(v.lock.indexOf('載入中') < 0, '姓名欄還寫著「載入中」：' + v.lock);
  }
});

test('本頁 jsonp 自己 catch 出來的連線失敗，講的是網路不是權限', () => {
  const a = fail({ ok: false, msg: '連線逾時，請重新整理。' });
  const b = fail({ ok: false, msg: '連線失敗' });
  assert.match(a.banner, /連不到伺服器/);
  assert.match(b.banner, /連不到伺服器/);
  // ⬛ 對照組：它跟權限那一類必須不同，否則這條分支什麼都沒做
  assert.notEqual(a.lock, fail({ reason: 'role_mismatch' }).lock);
});

/* ══ markGateFail：真的把字放到畫面上 ═════════════════════════════════════ */

test('🔴 markGateFail：建出橫幅、改掉已經畫好的姓名欄', () => {
  const { ctx, dom } = load();
  // 先確認起點是「載入中」——起點就不對的話，下面的斷言等於沒測
  assert.equal(dom.locks[0].textContent, '需權限，載入中…');
  ctx.markGateFail({ ok: false, reason: 'line_bad_token', msg: 'LINE 登入已過期' });
  assert.equal(dom.inserted.length, 1, '橫幅沒有被插進 #main 前面');
  assert.equal(dom.inserted[0].id, 'gate-fail');
  assert.match(dom.inserted[0].textContent, /重新開啟/);
  for (const l of dom.locks) {
    assert.equal(l.textContent, '登入過期', '已經畫好的姓名欄沒有被改掉');
  }
  assert.ok(dom.warns.some((w) => w.indexOf('line_bad_token') >= 0), 'console 沒有留下代號');
});

test('🔴 失敗先發生、表後畫：lockText() 要拿到失敗後的字（另一個方向）', () => {
  const { ctx } = load();
  ctx.markGateFail({ ok: false, reason: 'role_unresolved' });
  assert.equal(ctx.lockText(), '權限未設定');
});

test('markGateFail 呼叫兩次不會長出兩條橫幅', () => {
  const { ctx, dom } = load();
  ctx.markGateFail({ ok: false, reason: 'line_upstream' });
  ctx.markGateFail({ ok: false, reason: 'line_unbound' });
  assert.equal(dom.inserted.length, 1);
  assert.match(dom.inserted[0].textContent, /綁定/, '第二次的訊息沒有蓋上去');
});

/* ══ 接線：這些函式真的被呼叫到 ═══════════════════════════════════════════
 * ⚠️ 這幾條讀的是原始碼（剝掉註解——註解也算原始碼，會讓斷言假通過）。
 *    它們證明的只是「寫在那裡」，證明不了「跑起來會呼叫」；語意那一半由上面的
 *    行為測試負責。兩半都要有。                                            */

const SRC = stripComments(scriptText('hr-stats.html'));
const FLAT = SRC.replace(/\s+/g, ' ');

test('🔴 接線：`ok:false` 那一支無條件先 markGateFail，不再被 `!painted` 擋住', () => {
  assert.match(FLAT,
    /if \(r && r\.ok\) \{ renderHr\(r\); markOffline\(null\); markPub\(null\); \} else \{ markGateFail\(r\);/,
    '失敗分支沒有先呼叫 markGateFail——公開檔畫好之後它就會靜默');
});

test('🔴 接線：姓名欄那一格走 lockText()，原始碼裡不可以再有第二個寫死的「載入中」', () => {
  assert.match(FLAT, /class="lock">'\+esc\(lockText\(\)\)/, '姓名欄沒有走 lockText()');
  const hits = SRC.split('需權限，載入中…').length - 1;
  assert.equal(hits, 1, '「需權限，載入中…」在剝掉註解後出現 ' + hits
    + ' 次；只能有 lockText() 裡那一個，多的那個改不掉就會繼續說謊');
});

test('🔴 接線：離線那一條（沒有快取、圖表已經畫好）也要說話', () => {
  assert.match(FLAT, /if \(c\) \{ markOffline\(c\.savedAt\); return; \} markGateFail\(r\);/,
    '離線且沒有快取時仍然靜默');
});

test('⬛ 對照組：橫幅的 CSS class 真的存在於這一頁的樣式裡', () => {
  // 沒有這條的話，橫幅可能被插進去卻沒有任何樣式——插了跟沒插一樣。
  assert.match(sourceText('hr-stats.html'), /\.gate-fail\{/);
});
