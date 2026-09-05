/**
 * welfare.html 的 e2e 場景（2026-08-29）。
 *
 * 受測物是**瀏覽器實際送出了幾個請求、畫面實際變成什麼樣**——
 * 不是函式的回傳值。前面兩層（純函式、wiring）測不到的東西住在這裡：
 *   - 快速雙擊到底送出幾次（只數回傳值的話，偷送的第二次看不見）
 *   - 按鈕的 disabled 在真實事件序列下是不是真的擋得住
 *   - 塞進真實 DOM 之後 XSS 有沒有真的被擋
 *
 * 🔴 **儀器必須早於被測事件**：`page.route()` 一律在 `page.goto()` **之前**掛好，
 *    否則量到的是「evaluate 抵達的時刻」而不是「事件發生的時刻」。
 */
const { test, expect } = require('@playwright/test');

const ROWS = [
  { empNo: 'A001', name: '甲同仁', unit: '工務部', email: 'a@x.tw', userId: 'U1', status: 'ok' },
  { empNo: 'A002', name: '乙同仁', unit: '工務部', email: 'b@x.tw', userId: 'U2', status: 'ok' },
  { empNo: 'A003', name: '丙同仁', unit: '工務部', email: '', userId: '', status: 'no_email' },
  { empNo: 'B001', name: '丁同仁', unit: '管理部', email: 'd@x.tw', userId: 'U4', status: 'ok' },
  { empNo: 'B002', name: '戊同仁', unit: '管理部', email: 'e@x.tw', userId: '', status: 'unbound' },
  { empNo: 'C001', name: '己同仁', unit: '企劃部', email: 'f@x.tw', userId: '', status: 'ambiguous' },
];

const TPL_A = '[[e:5ac21a18040ab15980c9b43e:028]]{姓名}您好，端午禮金發放囉';
const TPL_B = '{姓名}中秋節快樂';

const DEFAULTS = {
  getWelfareAudience: { ok: true, rows: ROWS, audienceRev: 'REV1',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 },
    msgLogToken: 'MT-abc', msgLogWhy: '' },
  // 🔴 **欄位名必須與真實後端一致**：`getWelfareTemplates` 回的是 `templateId`。
  //    這裡原本寫 `id`，於是 54 條 e2e 全綠而線上的下拉整個壞掉
  //    （兩則寫進同一格、value 都是 "undefined"）。mock 與真實後端對不上時，
  //    測試測的是那份 mock，不是那個系統。
  getWelfareTemplates: { ok: true, items: [
    { templateId: 't1', title: '端午節禮金發放', text: TPL_A },
    { templateId: 't2', title: '中秋節祝福', text: TPL_B } ] },
  getWelfareStatus: { ok: true, state: 'unsent', lastSentAt: '', sentCount: 0, failedCount: 0 },
  requestWelfareOtp: { ok: true, count: 2, sentTo: 'hs***@example.tw', resent: true },
  sendWelfareBroadcast: { ok: true, state: 'sent', sentCount: 2, failedCount: 0,
    newlySentCount: 2, recordingFailed: false, msg: '已送出 2 則。' },
  saveWelfareTemplate: { ok: true },
};

/**
 * 掛好攔截再開頁面。
 * @param {object} [opts.responses] action → 物件｜函式(params, nth)。
 *        回 `{ __abort: true }` 模擬傳輸失敗；`{ __delayMs, body }` 模擬延遲。
 */
async function open(page, opts) {
  opts = opts || {};
  const calls = { getWelfareAudience: 0, getWelfareTemplates: 0, getWelfareStatus: 0,
                  requestWelfareOtp: 0, sendWelfareBroadcast: 0, saveWelfareTemplate: 0 };
  const seen = [];
  await page.route(/script\.google\.com/, async (route) => {
    // 🔴 **2026-09-02：參數改走 POST body，不在網址上了。**
    //    這一段原本讀 `url.searchParams` ⇒ 改成 POST 之後 `action` 是 null，
    //    每一個 mock 都對不上、頁面永遠等不到回應 ⇒ **症狀是「整批逾時」，
    //    看起來像產品壞了，其實是量具還在看舊的地方。**
    const req = route.request();
    const params = {};
    if (req.method() === 'POST') {
      new URLSearchParams(req.postData() || '').forEach((v, k) => { params[k] = v; });
    } else {
      new URL(req.url()).searchParams.forEach((v, k) => { params[k] = v; });
    }
    const a = params.action;
    if (a in calls) calls[a]++;
    seen.push({ action: a, params: params });
    let spec = (opts.responses || {})[a];
    if (typeof spec === 'function') spec = spec(params, calls[a]);
    let payload = spec === undefined ? (DEFAULTS[a] || { ok: true }) : spec;
    if (payload && payload.__abort) { await route.abort('failed'); return; }
    if (payload && payload.__delayMs) {
      await new Promise((r) => setTimeout(r, payload.__delayMs));
      payload = payload.body;
    }
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(payload) + ')' });
  });
  // ── LIFF（2026-09-02 Task 1 前半：這一頁變成 LIFF 頁）────────────────
  //
  // 🔴 **CDN 一律擋掉，改注入替身。** 兩個理由，缺一都不行：
  //   ① **不可以真的去打 LINE。** e2e 是常態執行的東西，讓它連外＝
  //      每跑一次測試就對 LINE 發一次請求，而且測試會因為網路而紅。
  //   ② 真 SDK 在 `localhost` 上 `liff.init` 一定失敗（endpoint 註冊的是
  //      正式網域）⇒ 拿到的會是一個**跟受測物無關的**失敗。
  //
  // ⚠️ **所以這一層驗不到「LINE 真的收下這次轉址」**。那一段只有在正式網域上、
  //    由本人登入一次才驗得到，**不在自動測試涵蓋範圍內**。
  await page.route(/static\.line-scdn\.net/, (route) => route.abort('failed'));
  const liffOpt = opts.liff || {};
  // ⚠️ 記在**頁面裡**，不用 exposeFunction——同一個 page 開兩次的測試會撞
  //    「Function has been already registered」，而那是量具壞掉、不是受測物壞掉。
  await page.addInitScript(({ loggedIn, idToken, initFails, noSdk }) => {
    window.__liffLogins = [];
    // 🔴 **`noSdk` ＝ CDN 掛掉那條路：連 `window.liff` 都不存在。**
    //    上面已經把 static.line-scdn.net 一律 abort ⇒ 真實情況下就是這個樣子。
    //    不是「init 失敗」——那是 SDK 載到了才走得到的分支，兩條路的程式碼不同。
    if (noSdk) { try { delete window.liff; } catch (e) { window.liff = undefined; } return; }
    window.liff = {
      init: () => (initFails ? Promise.reject(new Error(initFails)) : Promise.resolve()),
      isLoggedIn: () => loggedIn,
      getIDToken: () => idToken,
      login: (o) => { window.__liffLogins.push(o); },
    };
  }, {
    loggedIn: liffOpt.loggedIn === undefined ? true : liffOpt.loggedIn,
    // ⚠️ **長度要像真的。** 真的 LINE ID token 是 JWT，實務上約 1KB；
    //    用 'stub-id-token'（13 字）去量網址長度，量到的數字沒有意義
    //    ——那就是「拿假測資量出真數字」。
    idToken: liffOpt.idToken === undefined
      ? ('eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl')
      : liffOpt.idToken,
    initFails: liffOpt.initFails || '',
    noSdk: !!liffOpt.noSdk,
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/welfare.html?t=TESTTOKEN');
  const liffLogins = () => page.evaluate(() => window.__liffLogins || []);
  if (opts.stopAtGate) return { calls, seen, errors, liffLogins };
  await page.waitForSelector('#audience-list details.grp');
  return { calls, seen, errors, liffLogins };
}

/** 勾第 i 個人（用真實的滑鼠點擊，走真實的事件路徑）。 */
async function pick(page, i) {
  await page.locator('#cb-' + i).check();
}

/** 走到「拿到驗證碼、送出鈕可按」那個狀態。 */
async function armed(page, ctx) {
  await pick(page, 0);
  await pick(page, 1);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await expect(page.locator('#btn-send')).toBeEnabled();
  await page.locator('#otp-input').fill('123456');
  return ctx;
}

/* ══════════════ 載入與名單 ══════════════ */

test('載入：四個數字、名單分組、不可發送的顯示但不可勾且寫原因', async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator('#c-ok')).toHaveText('3');
  await expect(page.locator('#c-unbound')).toHaveText('1');
  await expect(page.locator('#c-noemail')).toHaveText('1');
  await expect(page.locator('#c-ambiguous')).toHaveText('1');
  await expect(page.locator('#audience-list details.grp')).toHaveCount(3);
  await expect(page.locator('#audience-list input:disabled')).toHaveCount(3);
  await expect(page.locator('#audience-list .why')).toHaveText(
    ['名冊未填信箱', '尚未綁定 LINE', '資料重複，請洽人事']);
  expect(errors, 'console 有未捕捉的錯誤').toEqual([]);
});

test('🔴 名單重繪不得清掉已經勾好的（SWR 會畫兩次，2026-08-20 因此誤發）', async ({ page }) => {
  await open(page);
  await pick(page, 0);
  await pick(page, 1);
  await expect(page.locator('#picked-n')).toHaveText('已選 2 人');
  // 第二次繪製（快取先畫、網路回來再畫的那一次）
  await page.evaluate(() => onAudienceLoaded({
    ok: true, rows: ROWS, audienceRev: 'REV1',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 }, msgLogToken: 'MT-abc' }));
  await expect(page.locator('#cb-0')).toBeChecked();
  await expect(page.locator('#cb-1')).toBeChecked();
  await expect(page.locator('#picked-n')).toHaveText('已選 2 人');
});

test('對照組：重繪之後沒勾的仍然沒勾（證明上一條不是「全部勾起來」）', async ({ page }) => {
  await open(page);
  await pick(page, 0);
  await page.evaluate(() => onAudienceLoaded({
    ok: true, rows: ROWS, audienceRev: 'REV1',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 }, msgLogToken: 'MT-abc' }));
  await expect(page.locator('#cb-3')).not.toBeChecked();
});

test('訊息紀錄入口帶對 token；換發失敗要寫出原因', async ({ page }) => {
  await open(page);
  await expect(page.locator('#msglog-entry a'))
    .toHaveAttribute('href', 'messages.html?t=MT-abc&days=180');

  await open(page, { responses: { getWelfareAudience: {
    ok: true, rows: ROWS, audienceRev: 'REV1',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 },
    msgLogToken: '', msgLogWhy: 'HUB_VIEWER_BY_ROLE 還沒有 welfare 這一格。' } } });
  await expect(page.locator('#msglog-entry')).toContainText('還沒有 welfare 這一格');
  await expect(page.locator('#msglog-entry a')).toHaveCount(0);
});

/* ══════════════ 範本編輯 ══════════════ */

test('🔴 emoji palette 點一下插入，游標停在插入點之後（不是跳到最後）', async ({ page }) => {
  await open(page);
  await page.locator('#wf-tpl').fill('前後');
  await page.evaluate(() => {
    const ta = document.getElementById('wf-tpl');
    ta.focus(); ta.selectionStart = ta.selectionEnd = 1;
  });
  await page.locator('#wf-emo-box button.emo-btn').first().click();
  const r = await page.evaluate(() => {
    const ta = document.getElementById('wf-tpl');
    return { value: ta.value, caret: ta.selectionStart };
  });
  expect(r.value).toMatch(/^前\[\[e:[0-9a-f]+:\d{3}\]\]後$/);
  expect(r.caret, '游標跳到最後了——行動裝置上這正是 click 而非 mousedown 的症狀')
    .toBe(r.value.indexOf('後'));
});

test('🔴 編輯區與預覽區：一個不可以改變字元寬度，另一個必須畫圖', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const ta = document.getElementById('wf-tpl');
    const mi = document.getElementById('wf-mirror');
    const pv = document.getElementById('wf-preview');
    return { taLen: ta.value.length,
             miLen: mi.textContent.replace(/\n$/, '').length,
             miImgs: mi.querySelectorAll('img').length,
             pvImgs: pv.querySelectorAll('img.emo').length,
             pvHasLiteral: pv.textContent.indexOf('[[e:') >= 0 };
  });
  expect(r.miLen, '鏡像層與 textarea 對不齊 ⇒ 底色會標到別的字上').toBe(r.taLen);
  expect(r.miImgs, '鏡像層畫了圖，寬度一定對不上').toBe(0);
  expect(r.pvImgs, '預覽區沒把 emoji 畫出來，等於沒有預覽').toBeGreaterThan(0);
  expect(r.pvHasLiteral, '預覽區留下了字面標記').toBe(false);
});

test('🔴 鏡像層 XSS：塞進真實 DOM 之後不得執行（純函式層之外的那一半）', async ({ page }) => {
  const { errors } = await open(page);
  let dialog = null;
  page.on('dialog', (d) => { dialog = d.message(); d.dismiss(); });
  const payloads = ['<img src=x onerror=alert(1)>', '</textarea><script>alert(2)</script>',
                    'A & B', '[[e:NOTHEX:001]]', '{<b>}'];
  for (const p of payloads) {
    await page.locator('#wf-tpl').fill(p);
    await expect(page.locator('#wf-mirror')).toContainText(p.slice(0, 10));
  }
  expect(dialog, '有 dialog 被觸發＝腳本執行了').toBeNull();
  expect(errors, 'pageerror 被觸發').toEqual([]);
  await expect(page.locator('#wf-mirror img')).toHaveCount(0);
});

test('🔴 切換範本：內容、狀態列、綁定全部跟著換；再切回來也一樣', async ({ page }) => {
  await open(page);
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_A);
  await page.locator('#wf-tpl-list').selectOption('t2');
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_B);
  expect(await page.evaluate(() => CURRENT_TPL)).toBe('t2');
  await page.locator('#wf-tpl-list').selectOption('t1');
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_A);
  expect(await page.evaluate(() => CURRENT_TPL)).toBe('t1');
});

test('🔴 未存草稿時切換要問；說不要 → 下拉回到原本那則，內容不變', async ({ page }) => {
  await open(page);
  await page.locator('#wf-tpl').fill(TPL_A + '改了一個字');
  page.once('dialog', (d) => d.dismiss());          // 選「取消」
  await page.locator('#wf-tpl-list').selectOption('t2');
  await expect(page.locator('#wf-tpl-list')).toHaveValue('t1');
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_A + '改了一個字');
  expect(await page.evaluate(() => CURRENT_TPL)).toBe('t1');
});

test('對照組：說「要」就真的切走（證明上一條不是「永遠不切」）', async ({ page }) => {
  await open(page);
  await page.locator('#wf-tpl').fill(TPL_A + '改了一個字');
  page.once('dialog', (d) => d.accept());
  await page.locator('#wf-tpl-list').selectOption('t2');
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_B);
});

test('🔴 未存變更 → 寄碼鈕 disable，而且旁邊寫明原因（不是靜靜擋住）', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btn-otp')).toBeEnabled();
  await page.locator('#wf-tpl').fill(TPL_A + 'X');
  await expect(page.locator('#btn-otp')).toBeDisabled();
  await expect(page.locator('#otp-hint')).toContainText('請先儲存');
  await expect(page.locator('#btn-save'), '儲存鈕這時候才該亮').toBeEnabled();
});

test('🔴 存檔後切走再切回，顯示的是新文，而且寄碼鈕可按', async ({ page }) => {
  await open(page);
  await page.locator('#wf-tpl').fill('新的內容 B');
  await page.locator('#btn-save').click();
  await expect(page.locator('#tpl-note')).toContainText('已儲存');
  await page.locator('#wf-tpl-list').selectOption('t2');
  await page.locator('#wf-tpl-list').selectOption('t1');
  await expect(page.locator('#wf-tpl'), '從快取拿出舊文 ⇒ 顯示 A、送出 B')
    .toHaveValue('新的內容 B');
  await expect(page.locator('#btn-otp')).toBeEnabled();
});

test('🔴 儲存往返期間繼續打字，存進去的是按下去那一刻的內容', async ({ page }) => {
  const ctx = await open(page, { responses: {
    saveWelfareTemplate: { __delayMs: 800, body: { ok: true } } } });
  await page.locator('#wf-tpl').fill('按下去那一刻');
  await page.locator('#btn-save').click();
  await page.locator('#wf-tpl').fill('後來又改的');       // 往返期間繼續打字
  await expect(page.locator('#tpl-note')).toContainText('已儲存');
  expect(ctx.seen.filter((s) => s.action === 'saveWelfareTemplate')[0].params.text)
    .toBe('按下去那一刻');
  // ⚠️ 此刻畫面上是「後來又改的」而基準是「按下去那一刻」⇒ dirty ⇒ 切走會先問。
  //    那是產品的正確行為（不靜靜丟掉她打的字），測試要回答它。
  page.once('dialog', (d) => d.accept());
  await page.locator('#wf-tpl-list').selectOption('t2');
  await page.locator('#wf-tpl-list').selectOption('t1');
  await expect(page.locator('#wf-tpl')).toHaveValue('按下去那一刻');
});

test('🔴 儲存失敗不得把 dirty 歸零（不確定有沒有存進去就不能說存了）', async ({ page }) => {
  await open(page, { responses: { saveWelfareTemplate: { ok: false, msg: '內容超過長度上限。' } } });
  await page.locator('#wf-tpl').fill(TPL_A + 'X');
  await page.locator('#btn-save').click();
  await expect(page.locator('#tpl-note')).toContainText('長度上限');
  await expect(page.locator('#btn-otp'), '沒存成功卻讓她寄碼 ⇒ 送出的是舊文').toBeDisabled();
  await expect(page.locator('#otp-hint')).toContainText('請先儲存');
});

/* ══════════════ 寄驗證碼 ══════════════ */

test('🔴 快速雙擊「寄驗證碼」只送出一個請求', async ({ page }) => {
  const ctx = await open(page, { responses: {
    requestWelfareOtp: { __delayMs: 600, body: DEFAULTS.requestWelfareOtp } } });
  await pick(page, 0);
  // 🔴 **直接呼叫兩次，不用點的。** 點的話第二次會被 disabled 擋住、根本沒派出事件
  //    ⇒ 測到的是「按鈕有沒有變灰」，不是 OTP_IN_FLIGHT 旗標。
  //    （2026-08-29 突變抓到：把旗標檢查拿掉，這條仍然綠。）
  await page.evaluate(() => { onRequestOtp(); onRequestOtp(); });
  await expect(page.locator('#otp-box')).toBeVisible();
  expect(ctx.calls.requestWelfareOtp, '雙擊送出了兩個請求＝她會收到兩封信').toBe(1);
});

test('🔴 取得驗證碼之後，送出鈕要從 disabled 變成可按', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btn-send')).toBeDisabled();
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await expect(page.locator('#btn-send'), '她拿到碼卻按不了送出').toBeEnabled();
});

test('🔴 resent:false 仍要進輸碼狀態，文案說「剛剛已經寄過」而不是失敗', async ({ page }) => {
  await open(page, { responses: { requestWelfareOtp: {
    ok: true, count: 2, sentTo: 'hs***@example.tw', resent: false } } });
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await expect(page.locator('#otp-note')).toContainText('剛剛已經寄過');
  await expect(page.locator('#otp-note')).not.toContainText('失敗');
});

test('🔴 寄碼的回應掉了：要說「可能已經寄出」，而且輸碼欄照樣出現', async ({ page }) => {
  // ⚠️ 用 abort 而不是等 45 秒逾時——兩者走的是 gasCall 的同一條 catch 分支
  //    （transport:true），而等真的逾時會超過測試的 30 秒上限。
  await open(page, { responses: { requestWelfareOtp: { __abort: true } } });
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-note')).toContainText('可能已經寄出');
  await expect(page.locator('#otp-note'), '說失敗會讓她一直重按').not.toContainText('寄送失敗');
  await expect(page.locator('#otp-box')).toBeVisible();
});

test('🔴 人數不確定時，確認框不可以報一個假數字', async ({ page }) => {
  await open(page, { responses: { requestWelfareOtp: { __abort: true } } });
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await page.locator('#otp-input').fill('123456');
  let msg = null;
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.locator('#btn-send').click();
  expect(msg).toContain('無法確認');
  expect(msg).not.toMatch(/\d+ 位同仁/);
});

test('🔴 伺服器明確拒絕 → 輸碼區收起來、送出鈕 disabled', async ({ page }) => {
  await open(page, { responses: { requestWelfareOtp: (p, n) =>
    n === 1 ? DEFAULTS.requestWelfareOtp : { ok: false, msg: '名單已變動，請重新整理。' } } });
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await page.locator('#btn-otp').click();                 // 第二次被拒
  await expect(page.locator('#otp-note')).toContainText('名單已變動');
  await expect(page.locator('#otp-box'), '舊碼還留著＝畫面顯示新的、實際發給舊的')
    .toBeHidden();
  await expect(page.locator('#btn-send')).toBeDisabled();
});

test('🔴 寄碼未回應期間改勾選：舊回應抵達後不得進入可送出狀態', async ({ page }) => {
  await open(page, { responses: {
    requestWelfareOtp: { __delayMs: 1200, body: DEFAULTS.requestWelfareOtp } } });
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await pick(page, 1);                                    // 等回應期間改勾選
  await expect(page.locator('#otp-note')).toContainText('已不適用');
  await expect(page.locator('#btn-send')).toBeDisabled();
  await expect(page.locator('#otp-box')).toBeHidden();
});

test('quota warning 要出現在確認框裡', async ({ page }) => {
  await open(page, { responses: { requestWelfareOtp: {
    ok: true, count: 2, sentTo: 'hs***@example.tw', resent: true,
    quotaWarning: '本月剩餘額度 40 則，可能不夠這一批。' } } });
  await armed(page, null);
  let msg = null;
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.locator('#btn-send').click();
  expect(msg).toContain('本月剩餘額度 40 則');
});

/* ══════════════ 送出前的 binding ══════════════ */

test('🔴 取碼後改勾選（同人數的另一組）→ 送出鈕失效，強制點也不得產生請求', async ({ page }) => {
  const ctx = await open(page);
  await armed(page, null);
  await page.locator('#cb-0').uncheck();
  await page.locator('#cb-3').check();                    // 同樣 2 人，不同人
  await expect(page.locator('#btn-send')).toBeDisabled();
  await expect(page.locator('#otp-box'), '輸碼區該收起來').toBeHidden();
  // 🔴 **一定要 accept 確認框。** 不接的話 Playwright 預設 dismiss，送出會被
  //    confirm 擋下來——測試照樣綠，而它宣稱驗的 binding 根本沒被執行到。
  //    （2026-08-29 突變抓到：把 binding 檢查整段拿掉，這條仍然綠。）
  page.on('dialog', (d) => d.accept());
  // 繞過 UI 直接呼叫——按鈕已經看不見了，點不到。而 onSend 裡那道 binding 檢查
  // 正是「UI 事件會漏，這一道不會漏」的那一道，要驗的就是它。
  await page.evaluate(() => onSend());
  expect(ctx.calls.sendWelfareBroadcast, '舊碼綁的是舊名單，發出去就發錯人').toBe(0);
});

test('🔴 取碼後只改草稿不存 → 送出鈕失效（三個識別值都沒變，靠 dirty 擋）', async ({ page }) => {
  const ctx = await open(page);
  await armed(page, null);
  await page.locator('#wf-tpl').fill(TPL_A + '偷改的字');
  await expect(page.locator('#btn-send')).toBeDisabled();
  page.on('dialog', (d2) => d2.accept());           // 同上：不接就是 confirm 在擋，不是 binding
  await page.evaluate(() => onSend());              // 繞過 UI 驗最後那道
  expect(ctx.calls.sendWelfareBroadcast).toBe(0);
  await expect(page.locator('#send-note')).toContainText('已停止送出');
});

test('確認框要列出人數、最近一次狀態、以及「收不回來」', async ({ page }) => {
  await open(page, { responses: { getWelfareStatus: {
    ok: true, state: 'sent', lastSentAt: '2026-06-15 09:00', sentCount: 137, failedCount: 0 } } });
  await armed(page, null);
  let msg = null;
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.locator('#btn-send').click();
  expect(msg).toContain('2 位同仁');
  expect(msg).toContain('已發送（2026-06-15 09:00）');
  expect(msg).toContain('收不回來');
});

test('她在確認框按取消 → 不送出，而且送出鈕要恢復', async ({ page }) => {
  const ctx = await open(page);
  await armed(page, null);
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#btn-send').click();
  expect(ctx.calls.sendWelfareBroadcast).toBe(0);
  await expect(page.locator('#btn-send'), '卡在送出中就再也按不了了').toBeEnabled();
});

/* ══════════════ 送出 ══════════════ */

test('🔴 快速雙擊「送出」只送出一個請求，而且 nonce 只有一個', async ({ page }) => {
  const ctx = await open(page, { responses: {
    sendWelfareBroadcast: { __delayMs: 800, body: DEFAULTS.sendWelfareBroadcast } } });
  await armed(page, null);
  page.on('dialog', (d) => d.accept());
  // 同上：點的話第二次被 disabled 擋住，測到的不是 SEND_IN_FLIGHT
  await page.evaluate(() => { onSend(); onSend(); });
  await expect(page.locator('#send-note')).toContainText('已送出');
  expect(ctx.calls.sendWelfareBroadcast, '雙擊送了兩次＝137 人收到兩則').toBe(1);
  const nonces = ctx.seen.filter((s) => s.action === 'sendWelfareBroadcast')
    .map((s) => s.params.nonce);
  expect(new Set(nonces).size).toBe(1);
});

test('🔴 送出成功之後送出鈕不得再亮（那組碼已經用掉了）', async ({ page }) => {
  await open(page);
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已送出');
  await expect(page.locator('#btn-send')).toBeDisabled();
  await expect(page.locator('#otp-box')).toBeHidden();
});

test('🔴 送出的傳輸失敗＝不知道有沒有送到，不可以說成失敗', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: { __abort: true } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('不確定對方有沒有收到');
  await expect(page.locator('#send-note')).toContainText('請不要重按');
  await expect(page.locator('#btn-send'), '碼可能已經被消耗掉了').toBeDisabled();
});

test('🔴 bad_code：留著讓她再試（後端還有 5 次上限擋著）', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: {
    ok: false, reason: 'bad_code', msg: '驗證碼不正確，請再確認一次。' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('驗證碼不正確');
  await expect(page.locator('#otp-box'), '打錯字就把她踢出去，她得重寄一次').toBeVisible();
  await expect(page.locator('#btn-send')).toBeEnabled();
});

test('🔴 expired：這組碼死了，一定要把她踢出輸碼狀態', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: {
    ok: false, reason: 'expired', msg: '驗證碼已過期，請重新申請。' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已過期');
  await expect(page.locator('#otp-box'),
    '她會對著一個永遠不會成功的輸碼欄一直按').toBeHidden();
});

test('🔴 部分成功要顯眼地說「不要整批重發」', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: {
    ok: true, state: 'partial', sentCount: 130, failedCount: 7, newlySentCount: 130,
    recordingFailed: false,
    msg: '部分送出：成功 130 則、失敗 7 則。⚠️ 請不要整批重發——成功的人會收到第二次。' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('請不要整批重發');
  await expect(page.locator('#status-line')).toContainText('部分成功');
});

test('🔴 紀錄沒記到：那 7 個人的資訊不可以被蓋掉', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: {
    ok: true, state: 'partial', sentCount: 130, failedCount: 7, recordingFailed: true,
    msg: '部分送出：成功 130 則、失敗 7 則。⚠️ 請不要整批重發。（訊息紀錄沒有記到這一批）' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  // 🔴 **先等非同步回來再讀。** 原本點完立刻讀 #status-line，而更新發生在
  //    gasCall 的 .then 裡 ⇒ 競態，實測四次跑會紅一到兩次。
  //    flaky 的測試比沒有測試更糟——它會讓人養成忽略紅燈的習慣。
  await expect(page.locator('#send-note')).toContainText('部分送出');
  const line = await page.locator('#status-line').textContent();
  expect(line, '把那 7 個人的資訊蓋掉了').toContain('130');
  expect(line).toContain('7');
  expect(line).toContain('訊息紀錄沒有記到');
});

test('🔴 紀錄沒記到時不得再去重讀 hub（會把警告洗掉）', async ({ page }) => {
  const ctx = await open(page, { responses: { sendWelfareBroadcast: {
    ok: true, state: 'sent', sentCount: 2, recordingFailed: true, msg: '已送出 2 則。' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已送出');
  // 🔴 **驗最終效果，不要數呼叫次數。** 原本是「等 400ms，看 getWelfareStatus 有沒有
  //    被多呼叫一次」——用固定等待去證明「某件事沒發生」本來就不穩，實測它在兩個
  //    完全無關的突變下都紅過（2026-08-29）。改成驗真正要保護的東西：
  //    這一批的狀態不可以被 hub 的舊資料洗掉。
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => LAST_STATUS && LAST_STATUS.state);
  expect(st, 'hub 正是沒記到這一批，重讀會拿到上一批或 unsent').toBe('sent');
  await expect(page.locator('#status-line')).toContainText('訊息紀錄沒有記到');
});

test('對照組：紀錄有記到的 sent 才去 hub 校正（證明上一條不是恆綠）', async ({ page }) => {
  const ctx = await open(page);
  await armed(page, null);
  const before = ctx.calls.getWelfareStatus;
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已送出');
  await expect.poll(() => ctx.calls.getWelfareStatus - before).toBeGreaterThan(0);
});

test('🔴 送出成功後再申請一次碼，確認框要顯示剛才的結果', async ({ page }) => {
  await open(page, { responses: { getWelfareStatus: { ok: true, state: 'unsent',
    lastSentAt: '', sentCount: 0, failedCount: 0 } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已送出');
  // 不切範本，再寄一次碼
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await page.locator('#otp-input').fill('123456');
  let msg = null;
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.locator('#btn-send').click();
  expect(msg, '那句話正是用來防重複整批發送的').not.toContain('沒有發送紀錄');
});

test('🔴 送出中要 disable；渲染出錯也不可以卡在送出中', async ({ page }) => {
  await open(page, { responses: {
    sendWelfareBroadcast: { __delayMs: 700, body: DEFAULTS.sendWelfareBroadcast } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#btn-send')).toBeDisabled();
  await expect(page.locator('#send-note')).toContainText('已送出');
  // 已 disarm ⇒ 應該是 disabled 而不是「可再按」——這是刻意的
  await expect(page.locator('#btn-send')).toBeDisabled();
});

test('🔴 送出用的 timeout 遠大於一般寫入（延遲 5 秒不可以提早報失敗）', async ({ page }) => {
  // ⚠️ 這條證明不了「就是 120 秒」——那要等 120 秒。它證明的是「不是 0ms」，
  //    也就是計畫警告過的「傳 {timeout:45000} 物件會被 setTimeout 轉成 NaN=0ms」。
  //    確切的數字由 welfare-page-wiring 的原始碼斷言守著。
  await open(page, { responses: {
    sendWelfareBroadcast: { __delayMs: 5000, body: DEFAULTS.sendWelfareBroadcast } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await page.waitForTimeout(2500);
  await expect(page.locator('#send-note'), '2.5 秒就報失敗＝timeout 是 0ms')
    .not.toContainText('失敗');
  await expect(page.locator('#send-note')).toContainText('已送出', { timeout: 15000 });
});

/* ══════════════ 三顆鈕真的有反應 ══════════════ */

test('🔴 儲存／寄碼／送出三顆鈕按下去都真的產生請求', async ({ page }) => {
  const ctx = await open(page);
  await page.locator('#wf-tpl').fill('改一下才能存');
  await page.locator('#btn-save').click();
  await expect(page.locator('#tpl-note')).toContainText('已儲存');
  await pick(page, 0);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await page.locator('#otp-input').fill('123456');
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('已送出');
  expect(ctx.calls.saveWelfareTemplate).toBe(1);
  expect(ctx.calls.requestWelfareOtp).toBe(1);
  expect(ctx.calls.sendWelfareBroadcast).toBe(1);
});

test('全選／全部取消真的有反應，而且不可發送的不會被拉進來', async ({ page }) => {
  await open(page);
  await page.locator('#btn-all').click();
  await expect(page.locator('#picked-n')).toHaveText('已選 3 人');   // 6 人裡只有 3 個可發送
  await page.locator('#btn-none').click();
  await expect(page.locator('#picked-n')).toHaveText('已選 0 人');
});

/* ══════════════ 既有看板不得受影響 ══════════════ */

/**
 * 🔴 **兩個編輯器各跑一次。**
 *    2026-08-29 codex G3 低嚴重度：這條原本只測 `sn`，整份 e2e 沒有出現過 `bc-*`
 *    ⇒ 報到碼那個編輯器的 DOM id、初始化或事件接線壞掉，這條仍然會綠。
 *    而 `bc` 是**報到碼通知**——它掛掉的話同仁點不到自己的報到碼。
 */
const STATS_EDITORS = [
  { set: 'sn', tab: 'staff',   phs: 5, typo: '{年資2}', known: '{姓名}' },
  { set: 'bc', tab: 'checkin', phs: 6, typo: '{桌次2}', known: '{活動名}' },
];

for (const ed of STATS_EDITORS) {
  test(`🔴 stats.html 的 ${ed.set} 編輯器行為不變，而且 [[e:…]] 不會變成圖`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/stats.html');
    await page.evaluate((tab) => {
      const ov = document.getElementById('jdc-revoked'); if (ov) ov.remove();
      showTab(tab);
    }, ed.tab);
    const r = await page.evaluate((e) => {
      const ta = document.getElementById(e.set + '-tpl');
      const mi = document.getElementById(e.set + '-mirror');
      if (!ta || !mi) return { missing: true };
      ta.value = e.known + '您好，' + e.typo + ' [[e:5ac21a18040ab15980c9b43e:028]]';
      paintMirror(e.set + '-tpl', e.set + '-mirror', e.set);
      renderPhs(e.set, e.set + '-phs', e.set + '-tpl');
      return {
        missing: false,
        known: mi.innerHTML.indexOf('<mark>' + e.known + '</mark>') >= 0,
        typo: mi.innerHTML.indexOf('<mark>' + e.typo + '</mark>') >= 0,
        imgs: mi.querySelectorAll('img').length,
        emoMark: mi.innerHTML.indexOf('emo-mark') >= 0,
        phs: document.querySelectorAll('#' + e.set + '-phs button.ph').length,
        aligned: mi.textContent.replace(/\n$/, '').length === ta.value.length,
        escKeeps: typeof esc === 'function' ? esc('<a & "b">') : 'esc 不見了',
      };
    }, ed);
    expect(r.missing, `找不到 ${ed.set} 編輯器的 DOM——id 改名了或分頁沒開`).toBe(false);
    expect(r.known, '認得的佔位符沒上色').toBe(true);
    expect(r.typo, '打錯字的上色了——她就看不出打錯').toBe(false);
    expect(r.imgs, '一期兩個看板不開 emoji，不該畫圖').toBe(0);
    expect(r.emoMark, '沒開 emoji 的組不該標 emo-mark').toBe(false);
    expect(r.phs, '碼標數量不對').toBe(ed.phs);
    expect(r.aligned, '鏡像層與 textarea 對不齊 ⇒ 底色標到別的字上').toBe(true);
    expect(r.escKeeps, '全域 esc 被 tpl-editor 覆寫了——那支有 74 處呼叫')
      .toBe('&lt;a & "b">');
    expect(errors).toEqual([]);
  });
}

test('對照組：兩個編輯器的佔位符組真的不同（證明上面不是同一組跑兩次）', async ({ page }) => {
  await page.goto('/stats.html');
  const r = await page.evaluate(() => ({
    sn: phList('sn').map((p) => p.k),
    bc: phList('bc').map((p) => p.k),
  }));
  expect(r.sn).toEqual(['姓名', '單位', '年資', '年度', '入社日']);
  expect(r.bc).toEqual(['姓名', '單位', '活動名', '日期', '桌次', '連結']);
  expect(r.sn, '兩組一樣的話，參數化跑兩次等於跑同一件事').not.toEqual(r.bc);
});

/* ══════════════ 程式化切換：下拉必須跟上 ══════════════
   2026-08-29 突變抓到的缺口：既有那幾條測的都是「使用者操作下拉」那條路徑
   （change 事件裡有自己的 e.target.value = CURRENT_TPL）。而 selectTemplate 裡
   那一行「程式化切換時下拉也要跟上」拿掉之後，41 條全綠——
   因為沒有一條走的是「程式呼叫 selectTemplate」那條路。
   啟動時選第一則走的正是那條。 */

/* ── 🔴 範本 id 的接線（2026-08-29 上線當天，在 production 上被抓到）─────────
 * 前端讀 `t.id` 而後端回的是 `t.templateId` ⇒ key 是 `undefined`
 * ⇒ 兩則範本寫進同一格、後面覆蓋前面 ⇒ 下拉兩個選項顯示同一個標題。
 * 而 **54 條 e2e 全綠**——因為 mock 當初也寫 `id`，測試在測一份不存在的後端。
 *
 * 🔴 下面這條**刻意不斷言欄位名**。斷言「要讀 templateId」的話，
 *    哪天後端改欄位名，這條會跟著被改成新名字而永遠綠。
 *    改成斷言**症狀**：id 讀不到時它必然是 undefined、必然重複、必然不成對。
 *    那個性質不隨欄位名改變。
 */
test('🔴 每則範本的 id 都要是真的值——讀錯欄位時它會是 undefined 而且全部一樣', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const sel = document.querySelector('#wf-tpl-list');
    return {
      values: [...sel.options].map((o) => o.value),
      labels: [...sel.options].map((o) => o.textContent),
      keys: Object.keys(TEMPLATES),
      order: TPL_ORDER.slice(),
    };
  });
  expect(r.values.length, '下拉沒有兩則').toBe(2);
  r.values.forEach((v) => {
    expect(v, 'option 的 value 是空的').toBeTruthy();
    expect(v, 'value 是字串 "undefined" ⇒ 前端讀錯了 id 的欄位名').not.toBe('undefined');
  });
  expect(new Set(r.values).size, '兩則的 id 一樣 ⇒ 後一則把前一則蓋掉了').toBe(2);
  expect(new Set(r.labels).size, '兩則的標題一樣 ⇒ 她根本選不到另外那則').toBe(2);
  expect(r.keys.length, 'TEMPLATES 只存下一則').toBe(2);
  expect(r.order.length, 'TPL_ORDER 只存下一則').toBe(2);
  expect(r.keys.includes('undefined'), 'TEMPLATES 有一個叫 "undefined" 的 key').toBe(false);
});

// 🔴 **驗的是第一則，不是第二則。** 讀錯欄位時兩則寫進同一格、
//    **後面覆蓋前面** ⇒ 存活下來的剛好是第二則 ⇒ 驗第二則會通過。
//    2026-08-29 實測：第一版寫成驗第二則，突變回 `t.id` 之後它照樣綠。
//    被覆蓋掉的那一個才是證據。
test('🔴 選第一則要拿到第一則的內容——被覆蓋掉的是它', async ({ page }) => {
  await open(page);
  const first = await page.evaluate(
    () => document.querySelector('#wf-tpl-list').options[0].value);
  await page.selectOption('#wf-tpl-list', first);
  await expect(page.locator('#wf-tpl'), '選了第一則卻載入第二則的內容 ⇒ 第一則被蓋掉了')
    .toHaveValue(TPL_A);
});

test('對照組：選第二則也要拿到第二則（證明上一條不是「永遠顯示第一則」）', async ({ page }) => {
  await open(page);
  const second = await page.evaluate(
    () => document.querySelector('#wf-tpl-list').options[1].value);
  await page.selectOption('#wf-tpl-list', second);
  await expect(page.locator('#wf-tpl')).toHaveValue(TPL_B);
});

test('🔴 啟動時自動選第一則，下拉要顯示那一則（不是空白或第 0 個）', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({
    current: CURRENT_TPL,
    selectValue: document.getElementById('wf-tpl-list').value,
    shown: document.getElementById('wf-tpl-list').selectedOptions[0].textContent,
  }));
  expect(r.selectValue, '下拉說 ' + r.selectValue + ' 而實際是 ' + r.current)
    .toBe(r.current);
  expect(r.shown).toBe('端午節禮金發放');
});

test('🔴 程式化呼叫 selectTemplate，下拉也要跟上（不只有點下拉那條路）', async ({ page }) => {
  await open(page);
  await page.evaluate(() => selectTemplate('t2'));
  const r = await page.evaluate(() => ({
    current: CURRENT_TPL,
    selectValue: document.getElementById('wf-tpl-list').value,
    textarea: document.getElementById('wf-tpl').value,
  }));
  expect(r.current).toBe('t2');
  expect(r.selectValue, '又一個「畫面說 A、實際是 B」').toBe('t2');
  expect(r.textarea).toBe(TPL_B);
});

/* ══════════════ codex G3 的四條高嚴重度 ══════════════
   共同形態：**非同步回應抵達時，狀態被寫到錯的地方。**
   四條的對照組都照 codex 給的形狀——只給失敗案例的話，
   分不出是程式碼壞了還是重現方式壞了。 */

/** 換序之後的同一批人（A/B 對調），用來驗勾選是跟著員編還是跟著索引。 */
const ROWS_SWAPPED = [ROWS[1], ROWS[0]].concat(ROWS.slice(2));

test('🔴 名單換序後重繪，勾選要跟著「人」走，不是跟著位置走', async ({ page }) => {
  await open(page);
  await pick(page, 0);                                   // 勾第一個人（甲 A001）
  const before = await page.evaluate(() => ROWS[0].empNo);
  await page.evaluate((rows) => onAudienceLoaded({
    ok: true, rows: rows, audienceRev: 'REV2',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 }, msgLogToken: 'MT-abc' }),
    ROWS_SWAPPED);
  const after = await page.evaluate(() => ROWS.filter((r, i) => {
    const cb = document.getElementById('cb-' + i); return cb && cb.checked;
  }).map((r) => r.empNo));
  expect(after, '換序之後勾到別人身上了——之後驗證碼與送出都會綁錯人')
    .toEqual([before]);
});

test('對照組：順序不變時當然也要保留（證明上一條不是「永遠只剩一個」）', async ({ page }) => {
  await open(page);
  await pick(page, 0);
  await page.evaluate((rows) => onAudienceLoaded({
    ok: true, rows: rows, audienceRev: 'REV1',
    counts: { ok: 3, unbound: 1, no_email: 1, ambiguous: 1 }, msgLogToken: 'MT-abc' }),
    ROWS);
  const after = await page.evaluate(() => ROWS.filter((r, i) => {
    const cb = document.getElementById('cb-' + i); return cb && cb.checked;
  }).map((r) => r.empNo));
  expect(after).toEqual(['A001']);
});

test('🔴 較舊的狀態查詢晚回，不得蓋掉本次的 partial（那 7 個人會被藏起來）', async ({ page }) => {
  // 第一次查詢慢、第二次快 ⇒ 舊的最後才到。只比 templateId 是擋不住的。
  await open(page, { responses: { getWelfareStatus: (p, n) => n === 1
    ? { __delayMs: 1200, body: { ok: true, state: 'sent', lastSentAt: '2026-01-01 00:00',
                                 sentCount: 137, failedCount: 0 } }
    : { ok: true, state: 'partial', sentCount: 130, failedCount: 7 } } });
  await page.evaluate(() => { loadStatus(CURRENT_TPL); loadStatus(CURRENT_TPL); });
  await page.waitForTimeout(1800);
  const st = await page.evaluate(() => LAST_STATUS && LAST_STATUS.state);
  expect(st, '舊的「已發送」蓋掉了本次的 partial ⇒ 那 7 個人沒人知道要補').toBe('partial');
  await expect(page.locator('#status-line')).toContainText('不要整批重發');
});

test('🔴 送出等待期間切換範本，結果不得記到另一則頭上', async ({ page }) => {
  await open(page, { responses: {
    sendWelfareBroadcast: { __delayMs: 1200, body: DEFAULTS.sendWelfareBroadcast } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  // 送出中不准切——這是根源那一道
  await page.evaluate(() => { document.getElementById('wf-tpl-list').value = 't2';
    document.getElementById('wf-tpl-list').dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#send-note')).toContainText('正在送出中');
  expect(await page.evaluate(() => CURRENT_TPL), '送出中被切走了').toBe('t1');
  // 就算真的切走了（程式化），結果也必須記在 t1 身上——那是不會漏的那一道
  await page.evaluate(() => { SEND_IN_FLIGHT = false; selectTemplate('t2'); });
  await page.waitForTimeout(1400);
  const rec = await page.evaluate(() => LAST_STATUS && LAST_STATUS.templateId);
  expect(rec, 'A 的送出結果被記到 B 頭上 ⇒ B 看起來已送、實際沒送').toBe('t1');
});

test('🔴 送出後的校正查詢失敗，不得清掉剛拿到的權威結果', async ({ page }) => {
  await open(page, { responses: {
    sendWelfareBroadcast: { ok: true, state: 'partial', sentCount: 130, failedCount: 7,
      recordingFailed: false, msg: '部分送出：成功 130 則、失敗 7 則。⚠️ 請不要整批重發。' },
    getWelfareStatus: (p, n) => n === 1
      ? { ok: true, state: 'unsent', sentCount: 0, failedCount: 0 }   // 送出前那一次
      : { __abort: true } } });                                       // 校正那一次失敗
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('部分送出');
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => LAST_STATUS && LAST_STATUS.state);
  expect(st, '讀 hub 逾時就把 130/7 洗成「尚未取得」⇒ 又一次把該補發的 7 人藏起來')
    .toBe('partial');
  await expect(page.locator('#status-line')).toContainText('130');
});

/* ── absent：hub 可能還在背景送（2026-08-29 codex G2 高嚴重度）──────────────
 * 137 則的時候 GAS 約 60 秒放棄等待，而 hub 還在逐則打 LINE API。
 * 這一態最貴的失敗是「畫面叫她再試一次」——重發會疊在還沒跑完的原批次上。
 */
test('🔴 送出後 137 則查不到結果 ⇒ 畫面兩處都要說「可能還在送」，不可說「送不出去」', async ({ page }) => {
  await open(page, { responses: { sendWelfareBroadcast: {
    ok: true, state: 'unknown', sentCount: 0, failedCount: 0, absentCount: 137,
    recordingFailed: false,
    msg: '⚠️ 有 137 則查不到送達結果——訊息平台可能還在背景送。**請不要重按**，'
       + '請先到訊息紀錄確認這一批的實際狀態，或聯絡工務管理組。' } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  // send-note 用後端組的 msg
  await expect(page.locator('#send-note')).toContainText('還在背景送');
  await expect(page.locator('#send-note')).toContainText('不要重按');
  // status-line 用前端的 welfareStateLabel——兩處必須說同一件事
  await expect(page.locator('#status-line')).toContainText('137');
  await expect(page.locator('#status-line')).toContainText('還在送');
  const line = await page.locator('#status-line').textContent();
  expect(line, '「訊息紀錄讀不到」會讓她去查錯的東西——紀錄表其實讀得到')
    .not.toContain('訊息紀錄讀不到');
});

test('🔴 unknown 之後 hub 回 unsent，不可把它洗成「沒有發送紀錄」', async ({ page }) => {
  await open(page, { responses: {
    sendWelfareBroadcast: { ok: true, state: 'unknown', sentCount: 0, failedCount: 0,
      absentCount: 137, recordingFailed: false, msg: '⚠️ 有 137 則查不到送達結果。' },
    getWelfareStatus: { ok: true, state: 'unsent', lastSentAt: '',
                        sentCount: 0, failedCount: 0 } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#send-note')).toContainText('137');
  // 送出時 unknown 不會自動校正，所以主動觸發一次——切走再切回來就是這條路徑
  await page.evaluate(() => loadStatus(CURRENT_TPL));
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => LAST_STATUS && LAST_STATUS.state);
  expect(st, '被洗成「沒有發送紀錄」⇒ 確認框會說沒發過 ⇒ 她整批重發，疊上還在跑的原批次')
    .toBe('unknown');
});

test('對照組：本來就沒有同一則的結果時，讀取失敗仍要顯示「尚未取得」', async ({ page }) => {
  await open(page, { responses: { getWelfareStatus: { __abort: true } } });
  await page.evaluate(() => { LAST_STATUS = null; loadStatus(CURRENT_TPL); });
  await page.waitForTimeout(600);
  await expect(page.locator('#status-line')).toContainText('尚未取得');
});

test('送出中儲存鈕也要鎖（後端重讀範本可能送出她沒確認過的版本）', async ({ page }) => {
  await open(page, { responses: {
    sendWelfareBroadcast: { __delayMs: 1000, body: DEFAULTS.sendWelfareBroadcast } } });
  await armed(page, null);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await page.locator('#wf-tpl').fill(TPL_A + '送出中偷改的');
  await expect(page.locator('#btn-save'), '送出中還能存 ⇒ 後端重讀會拿到這一版').toBeDisabled();
  await expect(page.locator('#send-note')).toContainText('已送出');
  await expect(page.locator('#btn-save'), '送出完要恢復').toBeEnabled();
});


/* ══════════════ 範本生命週期：那四步死路的逐步證明（2026-09-05）══════════════
 *
 * **為何在 e2e 這一層，而不是 wiring 層。**
 * wiring 測試已經證明「三顆鈕接上了、後端真的收到呼叫」——**它證明不了畫面結果**。
 * 而 2026-09-05 11:05 後端先上線、前端還沒上的那段窗口，症狀正是畫面結果：
 *   按停用 → 範本**沒有**離開下拉 → 選它又被擋 → 訊息叫她按一顆畫面上不存在的「恢復」。
 * ⇒ **那個洞在 wiring 層完全看不見**（鈕接上了、後端也真的收到了 removeWelfareTemplate）。
 *   看得見它的唯一位置，是「按下去之後畫面變成什麼樣」。
 *
 * ⚠️ **這一節的 mock 用真實後端的形狀**：`status` 是 `'啟用'`／`'停用'`
 *    （一手讀 jdc-line-gas `Code.js` 的 WELFARE_TPL_ACTIVE／WELFARE_TPL_DISABLED）。
 *    本檔上方的 DEFAULTS.getWelfareTemplates **一個 status 欄都沒有**，而真實後端
 *    每一則都會回 —— 沿用它等於在測一個後端不會回的形狀（本檔開頭那條 `id`／
 *    `templateId` 的教訓就是同一族）。所以這一節刻意自己給。
 */

/** 可變的狀態欄，模擬後端那一格。 */
function tplItems(state) {
  return { ok: true, items: [
    { templateId: 't1', title: '端午節禮金發放', text: TPL_A,
      status: state.t1, active: state.t1 === '啟用' },
    { templateId: 't2', title: '中秋節祝福', text: TPL_B,
      status: state.t2, active: state.t2 === '啟用' },
  ] };
}

/** 掛好會改狀態的後端替身。回傳那份狀態，讓斷言看得到後端那一側。 */
async function openLifecycle(page) {
  const state = { t1: '啟用', t2: '啟用' };
  const ctx = await open(page, { responses: {
    getWelfareTemplates: () => tplItems(state),
    removeWelfareTemplate: (params) => { state[params.templateId] = '停用'; return { ok: true }; },
    restoreWelfareTemplate: (params) => { state[params.templateId] = '啟用'; return { ok: true }; },
  } });
  return { ctx, state };
}

test('🔴 四步走完：按停用 → 離開下拉 → 進「已停用」→ 按恢復 → 回到下拉', async ({ page }) => {
  const { ctx } = await openLifecycle(page);
  page.on('dialog', (d) => d.accept());          // 停用的確認框

  // ⬛ 第 0 步（對照組，不可省）：先證明它**在**下拉裡。
  //    少了這一步，「它消失了」同時相容於「它從來就沒出現過」——那樣什麼都沒測到。
  await expect(page.locator('#wf-tpl-list option')).toHaveCount(2);
  await expect(page.locator('#wf-tpl-list option[value="t1"]')).toHaveCount(1);
  await expect(page.locator('#tpl-disabled-list')).toContainText('目前沒有停用的範本');

  // 第 1 步：按「停用這一則」（停的是目前選中的 t1）
  await page.locator('#btn-tpl-disable').click();

  // 第 2 步：它離開下拉——這一條就是那段窗口裡**做不到**的事
  await expect(page.locator('#wf-tpl-list option[value="t1"]')).toHaveCount(0);
  await expect(page.locator('#wf-tpl-list option')).toHaveCount(1);
  await expect(page.locator('#wf-tpl-list option[value="t2"]')).toHaveCount(1);

  // 第 3 步：它出現在「已停用的範本」區，而且**那顆恢復鈕真的在**
  //   （後端的錯誤訊息叫她按的就是這顆；那段窗口裡它不存在）
  await expect(page.locator('#tpl-disabled-list')).toContainText('端午節禮金發放');
  await expect(page.locator('#tpl-disabled-list [data-restore="t1"]')).toHaveText('恢復');

  // 第 4 步：按恢復 → 回到下拉，而且離開已停用區
  await page.locator('#tpl-disabled-list [data-restore="t1"]').click();
  await expect(page.locator('#wf-tpl-list option[value="t1"]')).toHaveCount(1);
  await expect(page.locator('#wf-tpl-list option')).toHaveCount(2);
  await expect(page.locator('#tpl-disabled-list')).toContainText('目前沒有停用的範本');

  // 後端那一側也要對得上：兩個 action 各收到一次，帶的是同一個 templateId
  const life = ctx.seen.filter((c) => c.action === 'removeWelfareTemplate'
                                   || c.action === 'restoreWelfareTemplate');
  expect(life.map((c) => c.action)).toEqual(['removeWelfareTemplate', 'restoreWelfareTemplate']);
  expect(life.every((c) => c.params.templateId === 't1'),
    '送出去的 templateId 不是 t1').toBe(true);

  expect(ctx.errors, 'console 有未捕捉的錯誤').toEqual([]);
});

test('⬛ 對照組：沒按停用時，兩則都留在下拉、已停用區是空的', async ({ page }) => {
  // 沒有這一條的話，上面那些 toHaveCount 只要「下拉永遠只有 t2」就會通過，
  // 而那正是壞掉的樣子之一。
  const { ctx } = await openLifecycle(page);
  await expect(page.locator('#wf-tpl-list option')).toHaveCount(2);
  await expect(page.locator('#tpl-disabled-list [data-restore]')).toHaveCount(0);
  expect(ctx.seen.some((c) => c.action === 'removeWelfareTemplate'),
    '沒按鈕卻送出了停用').toBe(false);
  expect(ctx.errors, 'console 有未捕捉的錯誤').toEqual([]);
});

/* ══ 身分閘：在真的瀏覽器裡，這三條路各自看到什麼 ═══════════════════════
 *
 * 前兩層（純函式、wiring）用的是假元素。這一層看的是**畫面實際變成什麼樣**、
 * **底下的鈕是不是真的按不到**、**console 有沒有東西**。
 *
 * ⚠️ **涵蓋範圍**：LIFF SDK 是替身（見 open() 的說明）。
 *    驗得到「頁面走到哪一步、顯示什麼、有沒有讓她按到不該按的東西」；
 *    **驗不到「LINE 真的收下這次轉址並帶她回來」**——那要正式網域＋本人登入。
 */

test('未登入（電腦瀏覽器那條路）：畫面停在身分閘，送出鈕按不到，且轉去 LINE 登入', async ({ page }) => {
  const r = await open(page, { liff: { loggedIn: false }, stopAtGate: true });
  await expect(page.locator('#liff-gate')).toBeVisible();
  await expect(page.locator('#liff-gate-msg')).toContainText('LINE 登入');

  // 🔴 底下的鈕不是「看不到」而已，要真的**按不到**。
  //    只驗 toBeVisible 的話，一個 z-index 沒蓋住的閘會通過，而她照樣按得到送出。
  const blocked = await page.evaluate(() => {
    const b = document.getElementById('btn-send');
    const rect = b.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { covered: top !== b, gate: !!(top && top.closest && top.closest('#liff-gate')) };
  });
  expect(blocked.covered, '身分閘沒有蓋住送出鈕').toBe(true);
  expect(blocked.gate, '蓋住送出鈕的不是身分閘').toBe(true);

  const logins = await r.liffLogins();
  expect(logins.length, '沒有轉去 LINE 登入 ⇒ 她在電腦上永遠停在確認身分').toBe(1);
  expect(logins[0].redirectUri).toContain('/welfare.html?t=TESTTOKEN');
  expect(r.calls.getWelfareAudience, '還沒確認是誰就把全公司名單載出來了').toBe(0);
  expect(r.errors, 'console 有錯').toEqual([]);
});

test('🔴 SDK 完全沒載到（LINE 的 CDN 掛掉）：要看到具名訊息，而且她真的看得到——不是白屏',
  async ({ page }) => {
  // 🔴 **這是本頁唯一的第三方相依失效時走的那條路**，而它與 `liff.init` 失敗
  //    是**不同的兩段程式碼**：init 失敗是 SDK 載到了才走得到的 `.catch`；
  //    這一條死在 `startLiff()` 第一個 `if`，連 Promise 都沒建立。
  // ⚠️ 這一頁改成 LIFF 頁之前**沒有任何第三方相依**，所以這是新增的失效模式。
  const r = await open(page, { liff: { noSdk: true }, stopAtGate: true });

  await expect(page.locator('#liff-gate')).toBeVisible();
  await expect(page.locator('#liff-gate-msg')).toContainText('沒有載入成功');
  const t = await page.locator('#liff-gate-msg').textContent();
  expect(t, '沒告訴她該找誰 ⇒ 她只能一直重整').toContain('資訊人員');

  // 🔴 **「訊息在 DOM 裡」與「她看得到」是兩件事。** 被別的東西蓋住時，
  //    只斷言文字存在照樣會綠，而她眼前仍然是一片白。
  //    ⇒ 問畫面正中央**實際畫出來的是什麼**，不是問 DOM 裡有什麼。
  const 畫面 = await page.evaluate(() => {
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const gate = document.getElementById('liff-gate');
    const msg = document.getElementById('liff-gate-msg');
    const r2 = gate.getBoundingClientRect();
    return {
      正中央在閘裡: !!(top && gate.contains(top)),
      看得見的字數: (msg.textContent || '').trim().length,
      閘佔畫面高度比: r2.height / innerHeight,
      閘的背景: getComputedStyle(gate).backgroundColor,
    };
  });
  expect(畫面.正中央在閘裡, '畫面正中央畫的不是身分閘 ⇒ 訊息在 DOM 裡但被蓋住了').toBe(true);
  expect(畫面.看得見的字數, '閘上一個字都沒有 ⇒ 她看到的就是白屏').toBeGreaterThan(10);
  expect(畫面.閘佔畫面高度比, '閘沒有蓋滿畫面 ⇒ 底下的半成品會露出來').toBeGreaterThan(0.9);

  // 底下的鈕要真的按不到（沿用未登入那條的量法）
  const blocked = await page.evaluate(() => {
    const b = document.getElementById('btn-send');
    const rect = b.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { covered: top !== b, gate: !!(top && top.closest && top.closest('#liff-gate')) };
  });
  expect(blocked.covered, '身分閘沒有蓋住送出鈕').toBe(true);
  expect(blocked.gate, '蓋住送出鈕的不是身分閘').toBe(true);

  // 沒有身分就不該去要任何資料
  expect(r.calls.getWelfareAudience, '還沒確認是誰就把全公司名單載出來了').toBe(0);
  expect(r.calls.getWelfareTemplates, '沒過閘卻去載了範本').toBe(0);
  // 🔴 **不可以有未捕捉的錯誤**：`liff is not defined` 那種會讓畫面停在
  //    「正在確認身分…」不動，而那句話讀起來像「還在跑」，不像「壞了」。
  expect(r.errors, 'console 有未捕捉的錯誤 ⇒ 她會看到一句永遠不會變的「正在確認身分…」').toEqual([]);
});

test('已登入但拿不到 ID token：擋住並講明重試沒用，不可以說「請先登入」', async ({ page }) => {
  const r = await open(page, { liff: { loggedIn: true, idToken: null }, stopAtGate: true });
  await expect(page.locator('#liff-gate')).toBeVisible();
  const t = await page.locator('#liff-gate-msg').textContent();
  expect(t, '沒講明重試沒用 ⇒ 她會一直重整一個永遠不會好的東西').toContain('重新整理不會好');
  expect(t, '說「請先登入」——而她已經登入了').not.toContain('請先登入');
  expect(r.calls.getWelfareAudience).toBe(0);
  expect(r.errors).toEqual([]);
});

test('已登入且拿得到憑證：閘讓開，名單照常載出來', async ({ page }) => {
  const r = await open(page, {});                 // 預設就是已登入＋有 token
  await expect(page.locator('#liff-gate')).toBeHidden();
  await expect(page.locator('#audience-list details.grp').first()).toBeVisible();
  expect(r.calls.getWelfareAudience).toBe(1);
  expect(r.errors).toEqual([]);
});

test('liff.init 失敗：畫面要說出原因，不可以靜默停在「確認身分中」', async ({ page }) => {
  await open(page, { liff: { initFails: 'boom-原因' }, stopAtGate: true });
  await expect(page.locator('#liff-gate-msg')).toContainText('boom-原因');
});

/* ══ 憑證真的上了網址，而且沒有把網址撐爆 ═══════════════════════════════
 *
 * 前兩層看的是「參數物件裡有沒有那一格」。這一層看的是**瀏覽器實際送出的網址**。
 * 🔴 而 URL 長度是這個 codebase 已知的真實限制（stats.html:559 為此寫了自適應切包：
 *    「中文編碼後膨脹 9 倍，固定筆數會爆 URL 長度」）——ID token 大約 1KB，
 *    每一次呼叫都多背它，值得量一次而不是用猜的。
 */

test('LINE 憑證真的出現在每一次請求的網址上', async ({ page }) => {
  const r = await open(page, {});
  const withCred = r.seen.filter((c) => c.params.idToken);
  expect(r.seen.length, '一次請求都沒有 ⇒ 這條什麼都沒測到').toBeGreaterThan(0);
  expect(withCred.length, '有請求沒帶憑證：'
    + JSON.stringify(r.seen.filter((c) => !c.params.idToken).map((c) => c.action)))
    .toBe(r.seen.length);
  expect(r.errors).toEqual([]);
});

test('🔴 參數走 POST body，網址上一個都不留（她寫的公告不進存取紀錄）', async ({ page }) => {
  const reqs = [];
  page.on('request', (q) => {
    if (/script\.google\.com/.test(q.url())) {
      reqs.push({ method: q.method(), url: q.url(), body: q.postData() || '' });
    }
  });
  await open(page, {});
  await page.locator('#wf-tpl').fill('中'.repeat(1500));
  await page.locator('#btn-save').click();
  await expect.poll(() => reqs.length).toBeGreaterThan(0);

  const 壞的 = [];
  reqs.forEach((r) => {
    if (r.method !== 'POST') 壞的.push('還在用 ' + r.method + '：' + r.url.slice(0, 80));
    if (r.url.indexOf('?') >= 0) 壞的.push('網址上還有參數：' + r.url.slice(0, 120));
  });
  assert2(壞的);

  const longest = reqs.reduce((a, b) => (a.url.length >= b.url.length ? a : b), reqs[0]);
  const biggestBody = reqs.reduce((a, b) => (a.body.length >= b.body.length ? a : b), reqs[0]);
  console.log('[POST 之後] 最長網址 ' + longest.url.length + ' 字元；最大 body '
    + biggestBody.body.length + ' 字元');
  // ⚠️ **這一條取代了改 POST 之前的兩條長度測試**（「最長的網址有多長」與
  //    「量最壞的那一支」）。它們量的是 GET 時代的曝險，改成 POST 之後
  //    兩條都只會量到固定長度的 /exec ⇒ **名字還在，但已經量不到它們要防的東西。**
  //    留著會變成「看起來有守，其實沒有」。這裡的 <300 比它們的 <8000／<16000 都緊。
  //
  // 改之前實測（真 Chrome，同一個場景）：**網址 14,702 字元**。
  // 改之後：網址 114、body 14,587 ⇒ **整篇公告從網址搬進了 body。**
  expect(longest.url.length,
    '網址還是很長 ⇒ 參數沒有真的搬到 body 裡').toBeLessThan(300);
  expect(biggestBody.body.length,
    'body 是空的 ⇒ 參數不見了，後端會說每一支都缺參數').toBeGreaterThan(1000);
});

function assert2(arr) {
  expect(arr, arr.join('\n')).toEqual([]);
}
