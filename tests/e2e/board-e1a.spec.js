/**
 * board.html 的 E1a 三種失敗畫面（2026-09-12）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試釘住的是「後端回了三種不同的 reason」。
 *    它證明不了**使用者看到三句不同的話**——中間隔著整條畫面路徑，而那一段
 *    CSS×JS 交界的 bug 靜態檢查抓不到（2026-07-27 attend.html 的下拉永遠不隱藏，
 *    三輪審查＋四項靜態確認全沒抓到，使用者開一次就看到）。
 *
 * 🔴 **這一檔的重點是失敗畫面，不是成功畫面。** 成功那條已經有測試釘住；
 *    會咬人的是「三句話在畫面上長得一樣」——那等於這一格的工作白做。
 *
 * ⚠️ 儀器早於事件：`page.route()` 與 `addInitScript()` 一律在 `goto()` 之前。
 */
const { test, expect } = require('@playwright/test');

/**
 * 🔴 **真的 LIFF SDK 必須擋掉，否則替身會被它覆蓋。**
 *    第一次跑就踩到：`addInitScript` 的替身有裝上去，但 `<script src=…sdk.js>`
 *    隨後載入並**覆寫 `window.liff`** ⇒ 頁面拿真的 SDK 去打 LINE ⇒ 瀏覽器被導去
 *    LINE 的錯誤頁，六條全紅、畫面內容是 `400 Bad Request`。
 *    ⚠️ 那個失敗長得像「我的頁面壞了」，其實是**替身缺席**——量具的問題不是受測物的問題。
 */
async function blockLiffCdn(page) {
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
}

/** LIFF SDK 走 CDN；在頁面 script 跑之前先放一個替身，否則 startAuth 會走「元件沒載入」。 */
function liffStub({ loggedIn = true, idToken = 'IDTOK', sub = 'U_sub_1' } = {}) {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return ${loggedIn}; },
    getIDToken: function(){ return ${JSON.stringify(idToken)}; },
    getDecodedIDToken: function(){ return { sub: ${JSON.stringify(sub)} }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1; },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

/**
 * @param {object} envelope 後端對 `batch` 回的外層信封（LINE 那條路是外層就被擋）
 */
async function open(page, { envelope, liff = {}, search = '' } = {}) {
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liffStub(liff));
  await page.route(/script\.google\.com/, async (route) => {
    const body = 'cb(' + JSON.stringify(envelope) + ')';
    await route.fulfill({ status: 200, contentType: 'application/javascript', body });
  });
  await page.goto('/board.html' + search);
  await page.waitForTimeout(1200);
  return logs;
}

/** 畫面上「使用者真的看得到」的文字。 */
async function visibleText(page) {
  return (await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length) return;                  // 只取葉節點，避免整頁重複
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const t = (el.textContent || '').trim();
      if (t) out.push(t);
    });
    return out;
  })).join(' ⏎ ');
}

const MSG = {
  unbound: '您的 LINE 帳號還沒有完成員工身分綁定，所以系統認不出您是誰。請先回 LINE 完成綁定，再開啟這一頁。',
  upstream: '系統目前無法確認您的身分（不是您的問題）。請稍後再試一次；若一直這樣，請聯絡系統維護者。',
  unresolved: '系統目前讀不到您的權限設定。換一條連結不會有幫助，請聯絡系統維護者。',
};

/* ══ 狀態①：還沒登入 ═══════════════════════════════════════════════ */

test('①還沒登入 → 去 LINE 登入，畫面說明中，且一個請求都沒送出', async ({ page }) => {
  let sent = 0;
  await blockLiffCdn(page);
  await page.route(/script\.google\.com/, async (route) => {
    sent++; await route.fulfill({ status: 200, body: 'cb({"ok":true})' });
  });
  await page.addInitScript(liffStub({ loggedIn: false }));
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('/board.html');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeTruthy();
  expect(sent, '導頁中還送出了請求').toBe(0);
  const txt = await visibleText(page);
  expect(txt).toContain('正在前往 LINE 登入');
  await page.screenshot({ path: 'test-results/e1a-01-登入中.png', fullPage: true });
  console.log('【①未登入】畫面：', txt.slice(0, 200));
  console.log('【①未登入】console：', JSON.stringify(logs));
});

/* ══ 狀態②：成功 ═════════════════════════════════════════════════ */

test('②登入成功、身分解出來 → 看板正常畫出來', async ({ page }) => {
  // ⚠️ `who` 一定要給——它是後端從守門交下來的身分取的「核准人」。
  //    第一次跑漏了它，畫面顯示「核准人：undefined」⇒ 那是**我的 mock 缺欄位**，
  //    不是頁面的 bug（`renderLoad` 讀的是 `getCheckinPending` 的 `r.who`）。
  //    補上之後這條斷言才有意義：它證明**身分真的走到畫面上**。
  const logs = await open(page, { envelope: { ok: true, results: {
    getCheckinOptions: { ok: true, units: [], titles: [] },
    getCheckinPending: { ok: true, rows: [], who: '甲', admin: false },
    getHrPending: { ok: true, rows: [] },
    getAnniversaries: { ok: true, items: [] },
  } } });
  const txt = await visibleText(page);
  expect(txt, '身分沒有走到畫面上').toContain('核准人：甲');
  expect(txt, '成功時不該出現任何一句失敗文案').not.toContain('請聯絡系統維護者');
  expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
  await page.screenshot({ path: 'test-results/e1a-02-成功.png', fullPage: true });
  console.log('【②成功】畫面：', txt.slice(0, 200));
  console.log('【②成功】console：', JSON.stringify(logs));
});

/* ══ 狀態③④⑤：三種失敗 ═══════════════════════════════════════════ */

for (const [key, reason, msg] of [
  ['03-沒綁定', 'line_unbound', MSG.unbound],
  ['04-系統壞了', 'line_upstream', MSG.upstream],
  ['05-名冊沒有生效的列', 'role_unresolved', MSG.unresolved],
]) {
  test(`失敗畫面 ${key}：後端的那一句要真的出現在畫面上`, async ({ page }) => {
    const logs = await open(page, { envelope: { ok: false, msg, reason } });
    const txt = await visibleText(page);
    await page.screenshot({ path: `test-results/e1a-${key}.png`, fullPage: true });
    console.log(`【${key}】reason=${reason}`);
    console.log(`【${key}】畫面：`, txt.slice(0, 400));
    console.log(`【${key}】console：`, JSON.stringify(logs));
    expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
    // 🔴 這一行就是這一檔存在的理由：後端講的那句話，使用者要看得到。
    expect(txt, `${reason} 的訊息沒有出現在畫面上 ⇒ 三種失敗對使用者是同一句`).toContain(msg.slice(0, 12));
  });
}

/**
 * 🔴 **「被擋住」與「這裡沒有資料」必須在畫面上分得開。**
 *
 * 為何補這一條（2026-09-12）：下面那條「三句話必須不同」是**綠的**，而畫面仍然有缺口
 * ——三句話確實不同，但它比的是三種失敗**彼此**，從來沒跟「沒有資料」比過。
 * 實際截圖看到的是：被擋下的訊息走 `.empty`（這一頁用來說「這一區沒有資料」的樣式），
 * 於是進不去的人看到的畫面，跟「這裡本來就沒東西」一模一樣。
 *
 * ⚠️ **判準刻意是「兩者必須不同」，不是「顏色等於某個值」。**
 *    把顏色寫死在測試裡，等於把同一個值抄第二份——樣式改一次就要改兩個地方，
 *    而忘了改的那一次測試會紅得莫名其妙（或更糟：改了測試去遷就）。
 */
/** #pending 裡那一塊訊息的「長相簽名」。 */
async function boxLook(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#pending > div');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { cls: el.className, color: cs.color, bg: cs.backgroundColor,
             align: cs.textAlign, text: (el.textContent || '').trim().slice(0, 20) };
  });
}

test('🔴 被擋住的畫面，與「沒有資料」的畫面，必須分得開', async ({ browser }) => {
  const look = {};
  const cases = [
    ['沒有資料', { ok: true, results: {
      getCheckinOptions: { ok: true, units: [], titles: [] },
      getCheckinPending: { ok: true, rows: [], who: '甲', admin: false },
      getHrPending: { ok: true, rows: [] }, getAnniversaries: { ok: true, items: [] } } }],
    ['被擋住_沒綁定', { ok: false, msg: MSG.unbound, reason: 'line_unbound' }],
    ['被擋住_系統壞了', { ok: false, msg: MSG.upstream, reason: 'line_upstream' }],
  ];
  for (const [name, envelope] of cases) {
    const p = await (await browser.newContext()).newPage();
    await open(p, { envelope });
    look[name] = await boxLook(p);
    await p.close();
  }
  console.log('【長相簽名】', JSON.stringify(look, null, 1));

  // ⬛ 對照組：兩種狀態都真的畫出了東西（否則下面在比兩個 null）
  Object.entries(look).forEach(([k, v]) => {
    if (!v) throw new Error(k + ' 沒有畫出任何訊息 ⇒ 這條測試什麼都沒比到');
  });

  const sig = (v) => [v.color, v.bg, v.align].join('|');
  expect(sig(look['被擋住_沒綁定']), '被擋住與沒有資料長得一模一樣 ⇒ 他不知道自己被擋住了')
    .not.toBe(sig(look['沒有資料']));
  expect(sig(look['被擋住_系統壞了']), '同上，另一種失敗也要分得開')
    .not.toBe(sig(look['沒有資料']));
  // 兩種「被擋住」之間長相相同是對的——它們靠文字分辨，不靠顏色分辨。
  expect(sig(look['被擋住_沒綁定'])).toBe(sig(look['被擋住_系統壞了']));
});

test('🔴 三種失敗在畫面上必須是三句不同的話（壓成一句＝這一格白做）', async ({ page, browser }) => {
  const seen = {};
  for (const [reason, msg] of [
    ['line_unbound', MSG.unbound], ['line_upstream', MSG.upstream],
    ['role_unresolved', MSG.unresolved],
  ]) {
    const p = await (await browser.newContext()).newPage();
    await open(p, { envelope: { ok: false, msg, reason } });
    seen[reason] = await visibleText(p);
    await p.close();
  }
  const vals = Object.values(seen);
  expect(new Set(vals).size, '三種失敗畫出來是同一個畫面 ⇒ 使用者被指錯路').toBe(3);
  console.log('【三種失敗各自的畫面】', JSON.stringify(seen, null, 1).slice(0, 1500));
});
