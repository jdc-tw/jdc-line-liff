/**
 * 身分狀態的訊息必須畫在**分頁外面**（2026-09-12）。
 *
 * 🔴 **為何非有這一支不可**：原本 `authBlock` 只寫 `#who`，而 `#who` 在
 *    `<div id="tab-checkin">` **裡面**。切到別的分頁、或後續渲染蓋掉它，
 *    那句話就消失了，而畫面看起來仍然是一張正常的看板。
 *    使用者 9/12 在手機上回報「畫面正常、五顆鈕都在」——我們到現在都還不知道
 *    當時 `startAuth` 走到哪一格，因為唯一會講的那個位置本來就可能看不見。
 *
 * ⚠️ 這一支不驗「成因是什麼」（那一格要真機才量得到），只驗「下一次會不會留下證據」。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fnSrc } = require('./helpers/source-scan.js');

/**
 * 只抽 board.html 裡那三支函式的原字來跑——不重寫一份等價邏輯。
 * ⚠️ 走共用抽取器（讓 V8 自己剖析），不自己手寫正則：
 *    `source-scan-tripwire.test.js` 會抓手寫的，而它抓得對——
 *    第一版我就是手寫的，被它打紅。
 */
function authSource() {
  return ['authBanner', 'authDiag', 'authBlock']
    .map((n) => fnSrc(n, 'board.html')).join('\n');
}

function fakeEl(tag) {
  return {
    tagName: tag, id: '', style: { cssText: '' }, children: [],
    textContent: '', innerHTML: '',
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    get firstChild() { return this.children[0] || null; },
  };
}

/** @param {{token:string, liff?:object}} opt */
function runAuth(opt) {
  const body = fakeEl('body');
  const byId = {};
  const created = [];
  // ⚠️ 插進 body 的元素要**登記進 id 表**，否則 `getElementById` 永遠找不到它，
  //    stub 就會把「真 DOM 找得到既有橫幅」演成「每次都建一條新的」。
  //    第一版漏了這一步，測試紅在「疊了 2 條」——紅的是儀器，不是受測物。
  body.insertBefore = function (c) {
    this.children.unshift(c);
    if (c && c.id) byId[c.id] = c;
    return c;
  };
  const ctx = {
    console, TOKEN: opt.token,
    document: {
      body,
      getElementById: (id) => byId[id] || null,
      createElement: (t) => { const e = fakeEl(t); created.push(e); return e; },
    },
    liff: opt.liff,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(authSource(), ctx, { filename: 'board auth' });
  return { ctx, body, byId, created };
}

const LIFF_OK = { init() {}, isLoggedIn: () => true, getIDToken: () => 'HEADER.PAYLOAD.SIGNATURE' };
const LIFF_NO_ID = { init() {}, isLoggedIn: () => true, getIDToken: () => '' };

test('⬛ 儀器檢查：三支函式真的抽得到並跑得起來', () => {
  const { ctx } = runAuth({ token: '', liff: LIFF_OK });
  assert.equal(typeof ctx.authBlock, 'function');
  assert.equal(typeof ctx.authBanner, 'function');
  assert.equal(typeof ctx.authDiag, 'function');
});

test('🔴 訊息畫在 body 最上緣，不是只寫進分頁裡的 #who', () => {
  const { ctx, body } = runAuth({ token: '', liff: LIFF_NO_ID });
  ctx.authBlock('已經登入 LINE，但拿不到這一頁需要的憑證。', true);
  assert.equal(body.children.length, 1, 'body 上沒有多出橫幅 ⇒ 訊息又只活在分頁裡了');
  assert.equal(body.children[0].id, 'auth-banner');
  assert.match(body.children[0].textContent, /拿不到這一頁需要的憑證/);
});

test('🔴 橫幅是 body 的第一個孩子（被後面的內容蓋掉就等於沒有）', () => {
  const { ctx, body } = runAuth({ token: '', liff: LIFF_NO_ID });
  body.children.push(fakeEl('div'));           // 先有既有內容
  ctx.authBlock('失敗', true);
  assert.equal(body.children[0].id, 'auth-banner', '橫幅被排到既有內容後面了');
});

test('重複呼叫只會有一條橫幅（不是每次疊一條）', () => {
  const { ctx, body } = runAuth({ token: '', liff: LIFF_NO_ID });
  ctx.authBlock('第一句', false);
  ctx.authBlock('第二句', true);
  assert.equal(body.children.length, 1, '疊了 ' + body.children.length + ' 條');
  assert.match(body.children[0].textContent, /第二句/);
});

test('🔴 診斷行只講「有沒有／多長」，**不可以**把憑證本身印出來', () => {
  const { ctx } = runAuth({ token: '', liff: LIFF_OK });
  const d = ctx.authDiag();
  assert.equal(d.indexOf('HEADER.PAYLOAD.SIGNATURE'), -1,
    '把 ID token 原文印進畫面 ⇒ 使用者截圖傳出去就是外洩一把有效憑證');
  assert.match(d, /憑證長度=24/, '長度沒印出來 ⇒ 那就分不出「沒帶」與「帶了但驗不過」');
  assert.match(d, /已登入=true/);
  assert.match(d, /t=無/);
});

test('診斷行分得開「沒有憑證」與「有憑證」——這正是 9/12 分不開的那一格', () => {
  const a = runAuth({ token: '', liff: LIFF_NO_ID }).ctx.authDiag();
  const b = runAuth({ token: '', liff: LIFF_OK }).ctx.authDiag();
  assert.match(a, /憑證長度=0/);
  assert.notEqual(a, b, '兩種狀態印出同一行 ⇒ 這一行零鑑別力，加了等於沒加');
});

test('liff 整個沒載入 / getIDToken 丟例外 → 診斷行仍印得出來，不是自己炸掉', () => {
  assert.match(runAuth({ token: '', liff: undefined }).ctx.authDiag(), /liff=無/);
  const boom = { init() {}, isLoggedIn: () => true, getIDToken() { throw new Error('x'); } };
  assert.match(runAuth({ token: '', liff: boom }).ctx.authDiag(), /憑證長度=throw/);
});

test('⬛ 對照組：舊路 `?t=` 的診斷行要看得出他走的是舊路', () => {
  const { ctx } = runAuth({ token: 'STUBTOKEN', liff: LIFF_OK });
  assert.match(ctx.authDiag(), /t=有/);
});
