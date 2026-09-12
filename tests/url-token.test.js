/**
 * 共用的網址取值（E2 準備，2026-09-12）。
 *
 * 🔴 **本檔最重要的不是「新的那支對不對」，是「它與被取代的那幾支一不一樣」。**
 *    抽共用函式的風險不是寫錯，是**寫成另一個意思而沒人發現**——舊頁面換上去之後
 *    行為悄悄變了，而畫面看起來一模一樣。所以下面把**四種舊寫法原字重現**，
 *    對同一組輸入逐一比對。
 *
 * ⚠️ 舊寫法是從實際頁面抄來的，不是我重寫的等價版：
 *    ① board.html:231 `getToken`
 *    ② attend/hr-stats/stats/checkin/wall/welfare 的 `q(k)`
 *    ③ admin.html:91 的裸 match
 *    ④ staff.html:190／messages.html:485 的 URLSearchParams
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { urlParam, urlToken } = require('../assets/url-token.js');

/* ── 四種舊寫法，逐字照抄 ─────────────────────────────────────────── */
const OLD = {
  board: (s) => { var m = s.match(/[?&]t=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; },
  q: (s, k) => { var m = s.match(new RegExp('[?&]' + k + '=([^&]+)')); return m ? decodeURIComponent(m[1]) : ''; },
  admin: (s) => { var m = s.match(/[?&]t=([^&]+)/); return m ? m[1] : ''; },   // ⚠️ 不解碼
  usp: (s, k) => new URLSearchParams(s).get(k) || '',
};

/** 實際會遇到的網址形狀。 */
const CASES = [
  '?t=abc123',
  '?t=abc123&act=midyear2026',
  '?act=midyear2026&t=abc123',
  '?mt=xyz&t=abc123',
  '?t=a%2Fb%2Bc',          // 有逸出字元
  '?t=',                   // 空值
  '',                      // 完全沒有
  '?act=only',             // 有別的參數、沒有 t
  '?tt=notthisone',        // 🔴 名字很像但不是它
  '?t=abc&t=def',          // 重複
];

test('⬛ 對照組：這組案例真的有鑑別力（不是每一筆都回空字串）', () => {
  const got = CASES.map((s) => urlToken(s));
  const nonEmpty = got.filter((v) => v !== '').length;
  assert.equal(nonEmpty >= 6, true,
    '只有 ' + nonEmpty + ' 筆取到值 ⇒ 下面的比對多半在比「兩邊都是空字串」');
});

test('🔴 與 board.html 舊寫法逐案相同', () => {
  CASES.forEach((s) => assert.equal(urlToken(s), OLD.board(s), '不一致：' + JSON.stringify(s)));
});

test('🔴 與 q(k) 舊寫法逐案相同（六頁在用的那一種）', () => {
  CASES.forEach((s) => assert.equal(urlToken(s), OLD.q(s, 't'), '不一致：' + JSON.stringify(s)));
  // q(k) 也被拿去取別的參數，一併比
  ['?act=A&t=B', '?act=', '?x=1'].forEach((s) =>
    assert.equal(urlParam('act', s), OLD.q(s, 'act'), '不一致：' + JSON.stringify(s)));
});

test('與 URLSearchParams 舊寫法在一般形狀上相同', () => {
  ['?t=abc123', '?t=abc123&act=x', '?act=x&t=abc123', '', '?act=only', '?tt=no']
    .forEach((s) => assert.equal(urlToken(s), OLD.usp(s, 't'), '不一致：' + JSON.stringify(s)));
});

test('⚠️ 已知且刻意的差異：`+` 不還原成空白（舊的四種有三種也不還原）', () => {
  assert.equal(urlToken('?t=a+b'), 'a+b');
  assert.equal(OLD.board('?t=a+b'), 'a+b', '前提：board 舊寫法也不還原');
  assert.equal(OLD.usp('?t=a+b', 't'), 'a b', '前提：只有 URLSearchParams 會還原');
});

/* ── 新寫法自己的性質 ─────────────────────────────────────────────── */

test('取不到一律回空字串，不是 null／undefined', () => {
  ['', '?', '?x=1', '?tt=1'].forEach((s) => {
    assert.strictEqual(urlToken(s), '', JSON.stringify(s));
  });
});

test('🔴 空值 `?t=` 要回空字串（舊的 [^&]+ 取不到，行為相同）', () => {
  assert.equal(urlToken('?t='), '');
  assert.equal(OLD.board('?t='), '');
});

test('🔴 名字像的參數不可以被當成它（tt≠t、at≠t）', () => {
  assert.equal(urlToken('?tt=x'), '');
  assert.equal(urlToken('?at=x'), '');
  assert.equal(urlToken('?at=x&t=real'), 'real');
});

test('🔴 參數名裡的正則保留字元不可以變成樣式', () => {
  // 若沒有逸出，'a.c' 會match到 'abc='
  assert.equal(urlParam('a.c', '?abc=wrong'), '', '參數名被當成正則樣式了');
  assert.equal(urlParam('a.c', '?a.c=right'), 'right');
});

test('壞掉的逸出序列不丟例外（回原字）', () => {
  assert.equal(urlToken('?t=%E0%A4%A'), '%E0%A4%A');
});

test('沒傳 search 時讀 location.search（頁面上的實際用法）', () => {
  const saved = global.location;
  global.location = { search: '?t=fromLocation' };
  try { assert.equal(urlToken(), 'fromLocation'); }
  finally { if (saved === undefined) delete global.location; else global.location = saved; }
});
