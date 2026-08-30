const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');

function extractFn(name) {
  const m = HTML.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
  assert.ok(m, `stats.html 裡找不到 function ${name}`);
  return m[0];
}

function run(opt) {
  const calls = [], els = {};
  const el = (id) => (els[id] = els[id] || { textContent: '', style: {} });
  const ctx = {
    console, q: () => 'TOKEN',
    document: {
      getElementById: el,
      // 預設就提供 createRange——不提供的話 selectBindLink 必定 throw，
      // 「選取成功」那條路徑永遠測不到（2026-08-29 外部審查抓到的假綠燈）
      createRange: opt.createRange || (() => ({ selectNodeContents() {} })),
    },
    setTimeout: () => 1,
    navigator: opt.clipboard === false ? {} : {
      clipboard: { writeText: (s) => { calls.push(s); return opt.clipboardFail ? Promise.reject(new Error('x')) : Promise.resolve(); } },
    },
    window: { getSelection: () => (opt.selection || { removeAllRanges() {}, addRange() {} }) },
    jsonp: (a, p) => { calls.push({ action: a, params: p }); return Promise.resolve(opt.res); },
    gBindLink: '',
  };
  vm.createContext(ctx);
  vm.runInContext('var gBindLink = "";', ctx);
  vm.runInContext(extractFn('loadBindLink'), ctx);
  vm.runInContext(extractFn('copyBindLink'), ctx);
  vm.runInContext(extractFn('selectBindLink'), ctx);
  return { ctx, calls, els };
}

test('★連結來自後端，不是前端寫死', () => {
  const src = HTML.match(/function loadBindLink\([\s\S]*?^}/m)[0];
  assert.match(src, /jsonp\('getBindLink'/, '必須打 getBindLink');
  assert.ok(!/liff\.line\.me/.test(src),
    '★前端寫死連結 ⇒ 後端一改參數名，佳岑手上那份就靜靜失效');
});

test('讀到連結就顯示全文', async () => {
  const { ctx, els } = run({ res: { ok: true, url: 'https://liff.line.me/2010451233-a781rqsm?mode=bind' } });
  await ctx.loadBindLink();
  assert.strictEqual(els['bl-url'].textContent, 'https://liff.line.me/2010451233-a781rqsm?mode=bind');
});

test('後端回失敗：顯示錯誤，不留「讀取中…」', async () => {
  const { ctx, els } = run({ res: { ok: false } });
  await ctx.loadBindLink();
  assert.match(els['bl-url'].textContent, /讀取失敗/);
});

test('還沒讀到連結就按複製：給明確訊息，不靜默', () => {
  const { ctx, els } = run({ res: { ok: true, url: 'X' } });
  ctx.copyBindLink();
  assert.match(els['bl-msg'].textContent, /還沒讀到/);
});

test('clipboard 不存在（非 https／舊瀏覽器）：退回選取，不靜默失敗', async () => {
  const { ctx, els } = run({ res: { ok: true, url: 'https://x/y' }, clipboard: false });
  await ctx.loadBindLink();
  ctx.copyBindLink();
  assert.match(els['bl-msg'].textContent, /選取|手動/,
    '按了沒反應比按了失敗更難查');
});

/* 🔴 上面那條在 2026-08-29 外部審查被判為「不管實作怎麼壞都會綠」：
 * VM 的 document 只有 getElementById，selectBindLink 第一行就 document.createRange()
 * → 必定 throw → 必定走 catch → 訊息「自動複製失敗，請手動選取」也吃 /選取|手動/。
 * 所以要把兩條路徑分開斷言，而且 stub 要真的提供 createRange。
 */

test('★選取路徑成功時：訊息要說「已選取」，而且真的呼叫了 selection API', async () => {
  const calls = [];
  const { ctx, els } = run({
    res: { ok: true, url: 'https://x/y' }, clipboard: false,
    selection: { removeAllRanges: () => calls.push('remove'), addRange: () => calls.push('add') },
    createRange: () => { calls.push('range'); return { selectNodeContents() {} }; },
  });
  await ctx.loadBindLink();
  ctx.copyBindLink();
  assert.deepStrictEqual(calls, ['range', 'remove', 'add'], '★沒真的選取 ⇒ 使用者按了複製卻什麼都沒選到');
  assert.match(els['bl-msg'].textContent, /已選取|Cmd\/Ctrl\+C/,
    '成功路徑的訊息必須與失敗路徑可區分');
});

test('★選取也壞掉時：訊息要說「自動複製失敗」，與成功路徑不同字', async () => {
  const { ctx, els } = run({
    res: { ok: true, url: 'https://x/y' }, clipboard: false,
    createRange: () => { throw new Error('no range'); },
  });
  await ctx.loadBindLink();
  ctx.copyBindLink();
  assert.match(els['bl-msg'].textContent, /自動複製失敗/);
  assert.ok(!/已選取/.test(els['bl-msg'].textContent),
    '★兩條路徑的訊息若共用同一個字，上面那條測試就不管實作怎麼壞都會綠');
});

test('★說明文字不得叫她提醒同仁加好友（那是機械閘的事）', () => {
  const card = HTML.match(/<h2>重新綁定連結<\/h2>[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(card, '找不到重新綁定連結卡');
  assert.ok(!/加好友|加入好友/.test(card[0]),
    '寫進文字等於多一條要人記得的紀律，而它擋不住任何東西——閘在 index.html');
  assert.match(card[0], /用手機點/, '「請他用手機點」一定要在——電腦點會綁到另一個帳號');
});
