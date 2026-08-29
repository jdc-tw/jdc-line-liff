/**
 * welfare.html 的接線測試。
 *
 * 為何存在：計畫第六輪審查抓到的缺陷**全是接線**，不是邏輯——每一支函式單獨看都對，
 * 錯在「誰呼叫誰、拿到什麼參數」，而且全都零錯誤訊息或訊息完全誤導：
 *   ① renderMsgLogEntry 接在 Promise 鏈尾巴 → 拿到 undefined → TypeError
 *   ② onTemplateSaved 沒更新 TEMPLATES 快取 → 切回來顯示舊文、送出新文
 *   ③ 送出成功沒更新 LAST_STATUS → 下一次確認框顯示送出**前**的狀態
 *   ④ selectTemplate 沒有使用者事件入口 → 點第二則範本，畫面與 CURRENT_TPL 脫鉤
 *   ⑤ 儲存／寄碼／送出三顆鈕一顆都沒有接上 click → 按下去什麼都不會發生
 *   ⑥ 儲存的往返競態 → 回應回來時用 .value 重讀，寫進去的是「她後來改的」
 *
 * `page-load.test.js` 驗的是「載得起來」，它明講不驗非同步；上面六個全在非同步之後。
 *
 * 手法沿用 download-menu-wiring.test.js：**從 welfare.html 抽原始碼**配 stub 跑，
 * 不另抄一份等價的（抄的那份會漂移，而漂移不報錯）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'welfare.html'), 'utf8');

function extract(re, what) {
  const m = SRC.match(re);
  assert.ok(m, `welfare.html 裡找不到 ${what}——改名了就要同步改這支測試`);
  return m[0];
}
const fnSrc = (name) =>
  extract(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'), `function ${name}`);

/** 裝好 stub 的 context，把指定的幾支原始碼跑進去。 */
function ctxWith(names, opt) {
  opt = opt || {};
  const calls = { note: [], status: [], msglog: [], select: [], loadStatus: [],
                  confirm: [], audience: [], syncSave: [], syncOtp: [], syncSend: [] };
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    className: '', listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild() {},
    fire(t, ev) { (this.listeners[t] || []).forEach((f) => f(ev)); },
  });
  const ctx = {
    console, Promise, JSON, Math, Date, Object, Array, String, Number,
    document: { getElementById: el, createElement: (t) => el('__made_' + t) },
    GAS_URL: '', TOKEN: 'T',
    ROWS: opt.ROWS || [], TEMPLATES: opt.TEMPLATES || {}, TPL_ORDER: opt.TPL_ORDER || [],
    CURRENT_TPL: opt.CURRENT_TPL || '', AUDIENCE_REV: '',
    SAVED_TPL_TEXT: opt.SAVED_TPL_TEXT === undefined ? '' : opt.SAVED_TPL_TEXT,
    LAST_STATUS: opt.LAST_STATUS === undefined ? null : opt.LAST_STATUS,
    UI_GEN: 0,
    // 2026-08-29 codex G3 之後新增：狀態查詢的世代（只有最新那一份可以落地）
    STATUS_GEN: 0,
    pickedEmpNos: () => opt.picked || {},
    tplTitle: (id) => (opt.TEMPLATES && opt.TEMPLATES[id] && opt.TEMPLATES[id].title) || id,
    OTP_STATE: { armed: false, gen: -1, templateId: '', audienceRev: '', selection: '',
                 count: 0, quotaWarning: '', uncertain: false },
    // ── 被接線呼叫、但本支不受測的東西，一律記帳 ──
    setNote: (id, t, c) => calls.note.push({ id, text: t, cls: c }),
    renderStatus: () => calls.status.push(ctx.LAST_STATUS),
    renderAudience: (r) => calls.audience.push(r),
    renderTemplateSelector: () => {},
    renderPickedCount: () => {},
    renderMsgLogEntry: (r) => calls.msglog.push(r),
    selectTemplate: (id) => { calls.select.push(id); ctx.CURRENT_TPL = id; },
    loadStatus: (id) => calls.loadStatus.push(id),
    bumpUiGen: () => { ctx.UI_GEN++; },
    syncOtpButton: () => calls.syncOtp.push(1),
    syncSendButton: () => calls.syncSend.push(1),
    syncSaveButton: () => calls.syncSave.push(1),
    paintMirror: () => {}, phPopup: () => {},
    disarmOtp: () => { ctx.OTP_STATE = { armed: false }; },
    armOtp: (s) => { ctx.OTP_STATE = s; },
    otpBindingStillValid: () => opt.bindingValid !== false,
    currentSelection: () => opt.selection || '',
    newNonce: () => 'nonce-1',
    otpValue: () => '123456',
    showState: (r) => calls.status.push(r),
    showServerReject: (r) => calls.note.push({ id: 'reject', text: (r && r.msg) || '' }),
    welfareStateLabel: (r) => 'LABEL:' + r.state,
    lastStatusLabel: () => '（測試）',
    isTplDirty: () => opt.dirty === true,
    confirm: (m) => { calls.confirm.push(m); return opt.confirmAnswer !== false; },
    gasCall: (url, action) =>
      Promise.resolve(opt.responses ? opt.responses[action] : { ok: true }),
  };
  ctx.onSaveTemplate = ctx.onRequestOtp = ctx.onSend = () => {};   // wireButtons 接的，預設 noop
  ctx.setAllChecked = () => {};
  ctx.SAVE_IN_FLIGHT = false; ctx.OTP_IN_FLIGHT = false; ctx.SEND_IN_FLIGHT = false;
  vm.createContext(ctx);
  // ⚠️ 後載入的定義會覆寫上面的替身——這正是要的：受測的那幾支用真的，其餘用替身
  names.forEach((n) => vm.runInContext(fnSrc(n), ctx, { filename: n }));
  return { ctx, calls, els, el };
}

/* ── 對照組：抽取真的有抽到東西（否則下面測的是「空字串 vs 空字串」，恆綠）── */
test('對照組：受測函式都抽得到，而且不是空的', () => {
  ['init', 'loadAudience', 'loadTemplates', 'onAudienceLoaded', 'onTemplateSaved',
   'showState', 'wireTemplateSelector', 'wireButtons', 'onSaveTemplate',
   'syncSaveButton', 'welfareStateLabel', 'onSend', 'onRequestOtp'].forEach((n) => {
    const s = fnSrc(n);
    assert.ok(s.length > 40, `${n} 只抽到 ${s.length} 個字元，抽取式壞了`);
  });
});

/* ── ① renderMsgLogEntry 一定要拿到「名單那一份回應」 ── */
test('🔴 訊息紀錄入口拿到的是 audience 回應本身（不是鏈尾巴的 undefined）', async () => {
  const { ctx, calls } = ctxWith(['loadAudience', 'onAudienceLoaded'], {
    responses: { getWelfareAudience:
      { ok: true, rows: [], audienceRev: 'R1', msgLogToken: 'MT-123' } },
  });
  await vm.runInContext('loadAudience()', ctx);
  assert.equal(calls.msglog.length, 1, 'renderMsgLogEntry 沒有被呼叫');
  assert.equal(calls.msglog[0] && calls.msglog[0].msgLogToken, 'MT-123',
    '拿到的不是 audience 回應——第六輪就是這裡拿到 undefined 而 TypeError');
});

test('名單讀不到時要寫出原因，不可靜靜留白', async () => {
  const { ctx, calls } = ctxWith(['loadAudience'], {
    responses: { getWelfareAudience: { ok: false, msg: '無權限或連結已失效。' } },
  });
  await vm.runInContext('loadAudience()', ctx);
  assert.equal(calls.msglog.length, 0, '失敗卻畫了紀錄入口');
  assert.ok(calls.note.some((n) => n.id === 'audience-note' && n.text.indexOf('無權限') >= 0),
    '沒有把伺服器的理由顯示出來');
});

/* ── ② 存檔要同時更新前端快取，否則切走再切回顯示舊文 ── */
test('🔴 存檔成功要更新 TEMPLATES 快取（切走再切回不得顯示舊文）', () => {
  const { ctx } = ctxWith(['onTemplateSaved'], {
    TEMPLATES: { t1: { id: 't1', text: 'A' } }, CURRENT_TPL: 't1',
  });
  vm.runInContext('onTemplateSaved("t1", "B")', ctx);
  assert.equal(ctx.TEMPLATES.t1.text, 'B',
    '快取還是舊文：切走再切回會顯示 A，而後端送出的是 B');
  assert.equal(ctx.SAVED_TPL_TEXT, 'B', '基準沒更新，她存完仍被判成 dirty');
});

test('🔴 存 A 的回應在切到 B 之後才回來，不得蓋掉 B 的基準', () => {
  const { ctx } = ctxWith(['onTemplateSaved'], {
    TEMPLATES: { t1: { id: 't1', text: 'A' }, t2: { id: 't2', text: 'X' } },
    CURRENT_TPL: 't2', SAVED_TPL_TEXT: 'X',
  });
  vm.runInContext('onTemplateSaved("t1", "A2")', ctx);   // ← A 的遲到回應
  assert.equal(ctx.TEMPLATES.t1.text, 'A2', 'A 的快取還是要更新');
  assert.equal(ctx.SAVED_TPL_TEXT, 'X', 'B 的基準被 A 的回應蓋掉了');
});

/* ── ③ 送出成功要更新 LAST_STATUS；紀錄沒記到時不得重讀 hub ── */
test('🔴 送出成功後 LAST_STATUS 立刻反映這次結果', () => {
  const { ctx, calls } = ctxWith(['showState'], { CURRENT_TPL: 't1' });
  vm.runInContext('showState({ ok:true, state:"sent", lastSentAt:"2026-09-01 10:00" })', ctx);
  assert.equal(ctx.LAST_STATUS.state, 'sent', '狀態沒更新：下次確認框會說「沒有發送紀錄」');
  assert.equal(ctx.LAST_STATUS.templateId, 't1');
  assert.equal(calls.status.length, 1, '狀態列沒有重畫');
});

test('🔴 紀錄沒記到這一批時不得再去重讀 hub（會被上一批或 unsent 洗掉）', () => {
  const { ctx, calls } = ctxWith(['showState'], { CURRENT_TPL: 't1' });
  vm.runInContext('showState({ ok:true, state:"sent", recordingFailed:true })', ctx);
  assert.equal(ctx.LAST_STATUS.state, 'sent');
  assert.deepStrictEqual(calls.loadStatus, [],
    '去重讀 hub 了——hub 正是沒記到這一批，重讀會把最重要的警告洗掉');
});

test('對照組：紀錄有記到的 sent 才會去 hub 校正（證明上一條不是恆綠）', () => {
  const { ctx, calls } = ctxWith(['showState'], { CURRENT_TPL: 't1' });
  vm.runInContext('showState({ ok:true, state:"sent" })', ctx);
  assert.deepStrictEqual(calls.loadStatus, ['t1'], 'sent 應該要非同步校正');
});

test('🔴 unknown 不去校正——連有沒有送出都不知道，重讀只會編一個答案', () => {
  const { ctx, calls } = ctxWith(['showState'], { CURRENT_TPL: 't1' });
  vm.runInContext('showState({ ok:true, state:"unknown", msg:"送不出去" })', ctx);
  assert.deepStrictEqual(calls.loadStatus, []);
});

/* ── 狀態文案的值域必須與後端對齊 ── */
test('🔴 四個 state 都有專屬文案，沒有一個掉進「狀態不明」', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  ['sent', 'partial', 'unsent', 'unknown'].forEach((s) => {
    const out = vm.runInContext(
      'welfareStateLabel({state:"' + s + '", sentCount:1, failedCount:1})', ctx);
    assert.notEqual(out, '狀態不明', s + ' 掉進 fallback 了——後端有這一態，前端沒有');
  });
});

test('🔴 recordingFailed 是獨立一軸，不可蓋掉 partial 那句「不要整批重發」', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext(
    'welfareStateLabel({state:"partial", sentCount:130, failedCount:7, recordingFailed:true})', ctx);
  assert.ok(out.indexOf('130') >= 0 && out.indexOf('7') >= 0,
    '把那 7 個人的資訊蓋掉了：' + out);
  assert.ok(out.indexOf('不要整批重發') >= 0, '最重要的那句警告不見了：' + out);
  assert.ok(out.indexOf('訊息紀錄沒有記到') >= 0, '紀錄的警告也要有：' + out);
});

test('對照組：沒有 recordingFailed 時不加那句（證明上一條不是恆綠）', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext('welfareStateLabel({state:"sent", lastSentAt:"X"})', ctx);
  assert.ok(out.indexOf('訊息紀錄沒有記到') < 0, out);
});

/* ── absent：畫面與 send-note 必須說同一件事（2026-08-29 codex G2 高的下游）──
 * 後端把「重問後仍查無」從 failed 拆出來之後，狀態列若只講 failedCount，
 * 就會與 send-note 那句（後端組的 r.msg）說不同的話——而她看的是畫面。
 * memory `feedback_fire_and_forget_hides_outage` 的「告警管道分歧」形態。
 */
test('🔴 unknown 帶 absentCount ⇒ 不可說「訊息紀錄讀不到」，那是另一件事', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext(
    'welfareStateLabel({state:"unknown", absentCount:137, failedCount:0})', ctx);
  assert.ok(out.indexOf('137') >= 0, '沒講出有幾則查不到：' + out);
  assert.ok(out.indexOf('還在送') >= 0, '沒講出「可能還在送」，她會以為是失敗：' + out);
  assert.ok(out.indexOf('訊息紀錄讀不到') < 0,
    '紀錄表其實讀得到，是那些人查不到——這句話會讓她去查錯的東西：' + out);
});

test('對照組：unknown 沒有 absentCount（hub 完全沒回應）仍講原本那句', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext('welfareStateLabel({state:"unknown"})', ctx);
  assert.ok(out.indexOf('訊息紀錄讀不到') >= 0, out);
});

test('🔴 partial 要同時講失敗幾則與查不到幾則', () => {
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext(
    'welfareStateLabel({state:"partial", sentCount:95, failedCount:5, absentCount:37})', ctx);
  assert.ok(out.indexOf('95') >= 0 && out.indexOf('5') >= 0, out);
  assert.ok(out.indexOf('37') >= 0, '漏講查不到的那 37 個人：' + out);
  assert.ok(out.indexOf('不要整批重發') >= 0, out);
});

test('對照組：getWelfareStatus 那條路徑沒有 absentCount ⇒ 文案與改動前一致', () => {
  // welfareStatusFrom 是三態、沒有這個欄位。它不可以因為這次改動長出多餘的字。
  const { ctx } = ctxWith(['welfareStateLabel']);
  const out = vm.runInContext(
    'welfareStateLabel({state:"partial", sentCount:130, failedCount:7})', ctx);
  assert.ok(out.indexOf('查不到結果') < 0, '沒有 absent 卻多講了一段：' + out);
  assert.ok(out.indexOf('失敗 7') >= 0, out);
});

/* ── ⑤ 按鈕真的有接上 click ── */
test('🔴 儲存／寄碼／送出三顆鈕都接上了 click（第六輪之前一顆都沒接）', () => {
  const { ctx, el } = ctxWith(['wireButtons']);
  ctx.onSaveTemplate = () => { ctx.__hit = (ctx.__hit || []).concat('save'); };
  ctx.onRequestOtp   = () => { ctx.__hit = (ctx.__hit || []).concat('otp'); };
  ctx.onSend         = () => { ctx.__hit = (ctx.__hit || []).concat('send'); };
  vm.runInContext('wireButtons()', ctx);
  ['btn-save', 'btn-otp', 'btn-send'].forEach((id) => el(id).fire('click', {}));
  assert.deepStrictEqual(ctx.__hit, ['save', 'otp', 'send'], '有鈕按下去什麼都不會發生');
});

test('全選／全部取消也要接上（不然名單只能一個一個點）', () => {
  const { ctx, el } = ctxWith(['wireButtons']);
  const seen = [];
  ctx.setAllChecked = (on) => seen.push(on);
  vm.runInContext('wireButtons()', ctx);
  el('btn-all').fire('click', {});
  el('btn-none').fire('click', {});
  assert.deepStrictEqual(seen, [true, false]);
});

/* ── ⑥ 儲存的往返競態 ── */
test('🔴 儲存往返期間改了字，寫進快取的仍是送出去的那份', async () => {
  const { ctx } = ctxWith(['onSaveTemplate', 'onTemplateSaved'], {
    TEMPLATES: { t1: { id: 't1', title: '端午', text: 'A' } }, CURRENT_TPL: 't1',
    responses: { saveWelfareTemplate: { ok: true } },
  });
  const ta = ctx.document.getElementById('wf-tpl');
  ta.value = 'B';
  const p = vm.runInContext('onSaveTemplate()', ctx);
  ta.value = 'B 之後又改的字';            // ← 往返期間她繼續打字
  await p;
  assert.equal(ctx.TEMPLATES.t1.text, 'B', '寫進去的是「後來改的」，不是送出去的那份');
  assert.equal(ctx.SAVED_TPL_TEXT, 'B');
});

test('🔴 儲存失敗不得更新快取或基準（不確定有沒有存進去就不能說存了）', async () => {
  const { ctx } = ctxWith(['onSaveTemplate', 'onTemplateSaved'], {
    TEMPLATES: { t1: { id: 't1', title: '端午', text: 'A' } }, CURRENT_TPL: 't1',
    SAVED_TPL_TEXT: 'A',
    responses: { saveWelfareTemplate: { ok: false, transport: true } },
  });
  ctx.document.getElementById('wf-tpl').value = 'B';
  await vm.runInContext('onSaveTemplate()', ctx);
  assert.equal(ctx.TEMPLATES.t1.text, 'A', '沒存成功卻更新了快取');
  assert.equal(ctx.SAVED_TPL_TEXT, 'A', '沒存成功卻歸零了 dirty ⇒ 她可以寄碼，而送出的是舊文');
});

test('傳輸失敗與伺服器拒絕的說法不同（一個是「不確定」，一個是「失敗」）', async () => {
  const mk = (resp) => ctxWith(['onSaveTemplate', 'onTemplateSaved'], {
    TEMPLATES: { t1: { id: 't1', text: 'A' } }, CURRENT_TPL: 't1',
    responses: { saveWelfareTemplate: resp },
  });
  const a = mk({ ok: false, transport: true });
  await vm.runInContext('onSaveTemplate()', a.ctx);
  const b = mk({ ok: false, transport: false, msg: '內容超過長度上限。' });
  await vm.runInContext('onSaveTemplate()', b.ctx);
  const last = (c) => c.calls.note.filter((n) => n.id === 'tpl-note').pop().text;
  assert.ok(last(a).indexOf('不確定') >= 0, '傳輸失敗說成了確定的失敗：' + last(a));
  assert.ok(last(b).indexOf('長度上限') >= 0, '伺服器的理由沒顯示：' + last(b));
});

/* ── ④ 切換範本的使用者入口 ── */
test('🔴 下拉切換範本會走 selectTemplate', () => {
  const { ctx, calls, el } = ctxWith(['wireTemplateSelector'], { CURRENT_TPL: 't1' });
  vm.runInContext('wireTemplateSelector()', ctx);
  el('wf-tpl-list').fire('change', { target: { value: 't2' } });
  assert.deepStrictEqual(calls.select, ['t2'], '點了第二則範本卻沒有人切');
});

test('🔴 有未存草稿時切換要先問；她說不要，下拉必須拉回原本那則', () => {
  const { ctx, calls, el } = ctxWith(['wireTemplateSelector'], {
    CURRENT_TPL: 't1', dirty: true, confirmAnswer: false,
  });
  vm.runInContext('wireTemplateSelector()', ctx);
  const sel = el('wf-tpl-list');
  sel.value = 't2';
  sel.fire('change', { target: sel });
  assert.equal(calls.confirm.length > 0, true, '有未存草稿卻沒問就切了');
  assert.deepStrictEqual(calls.select, [], '她說不要，卻還是切了');
  assert.equal(sel.value, 't1', '下拉停在 t2 而實際是 t1——又一個「畫面 A、實際 B」');
});

/* ── 載入範本：欄位名必須與後端一手碼對齊 ── */
// 🔴 2026-08-29 上線當天在 production 抓到：前端讀 `t.id`，而後端回的是 `t.templateId`。
//    **這條測試原本也寫 `id`**——它的失敗訊息寫著「欄位名對不上就是一則範本都讀不到」，
//    它正是在測這件事，卻用了跟被測程式碼一樣的錯欄位名，所以永遠綠。
//    同一個病灶在三個地方：welfare.html、e2e 的 mock、這裡。
//    ⚠️ 教訓不是「要小心」：**替身的欄位名要從一手碼抄**，不要從被測程式碼抄——
//       從被測程式碼抄的話，測試與程式碼會一起錯而且互相印證。
test('🔴 範本清單讀的是回應的 items，而每一則的鍵是 templateId', async () => {
  const { ctx, calls } = ctxWith(['loadTemplates'], {
    responses: { getWelfareTemplates:
      { ok: true, items: [{ templateId: 'a', title: 'A', text: 'ta' },
                          { templateId: 'b', title: 'B', text: 'tb' }] } },
  });
  await vm.runInContext('loadTemplates()', ctx);
  // ⚠️ vm 裡建的陣列屬於另一個 realm，prototype 不同 ⇒ deepStrictEqual 會判不等
  //    （值明明一樣）。先攤回主 realm 再比。
  assert.deepStrictEqual([].slice.call(ctx.TPL_ORDER), ['a', 'b'],
    '欄位名對不上就是一則範本都讀不到');
  assert.deepStrictEqual(calls.select, ['a'], '沒有自動選第一則');
  // 🔴 這兩條**不看欄位名，只看症狀**：讀錯了鍵必然是 undefined、必然收斂成一格。
  //    斷言欄位名的話，哪天後端改名，這條會跟著改成新名字而永遠綠。
  const keys = Object.keys(ctx.TEMPLATES);
  assert.ok(!keys.includes('undefined'),
    'TEMPLATES 有一個叫 "undefined" 的鍵 ⇒ 讀錯了 id 的欄位名');
  assert.strictEqual(keys.length, 2, '兩則收斂成一格 ⇒ 後一則把前一則蓋掉了');
});

test('一則範本都沒有時不可以硬選（會拿 undefined 去讀 .text）', async () => {
  const { ctx, calls } = ctxWith(['loadTemplates'], {
    responses: { getWelfareTemplates: { ok: true, items: [] } },
  });
  await vm.runInContext('loadTemplates()', ctx);
  assert.deepStrictEqual(calls.select, []);
});

/* ── 寄碼：三種結果三種處置 ── */
test('🔴 寄碼期間她改了勾選，遲到的回應不可以把她重新武裝', async () => {
  const { ctx, calls } = ctxWith(['onRequestOtp'], {
    CURRENT_TPL: 't1', responses: { requestWelfareOtp: { ok: true, count: 5 } },
  });
  // gasCall 回應之前先讓 UI_GEN 前進——等同她在等回應期間動了勾選
  ctx.gasCall = () => { ctx.UI_GEN++; return Promise.resolve({ ok: true, count: 5 }); };
  await vm.runInContext('onRequestOtp()', ctx);
  assert.equal(ctx.OTP_STATE.armed, false, '用舊的一份把她武裝了');
  assert.ok(calls.note.some((n) => n.text.indexOf('已不適用') >= 0), '沒告訴她為什麼');
});

test('🔴 傳輸失敗也要進輸碼狀態，但人數標成不確定（碼可能已經寄出）', async () => {
  const { ctx, calls } = ctxWith(['onRequestOtp'], {
    CURRENT_TPL: 't1', responses: { requestWelfareOtp: { ok: false, transport: true } },
  });
  await vm.runInContext('onRequestOtp()', ctx);
  assert.equal(ctx.OTP_STATE.armed, true, '沒進輸碼狀態——她信箱裡可能就有碼');
  assert.equal(ctx.OTP_STATE.uncertain, true, '沒標成不確定，確認框會報一個假數字');
  const t = calls.note.map((n) => n.text).join(' ');
  assert.ok(t.indexOf('可能已經寄出') >= 0, '說成失敗會讓她一直重按：' + t);
});

test('🔴 伺服器明確拒絕一定要 disarm（留著舊碼＝畫面顯示新的、實際發給舊的）', async () => {
  const { ctx } = ctxWith(['onRequestOtp'], {
    CURRENT_TPL: 't1',
    responses: { requestWelfareOtp: { ok: false, transport: false, msg: '名單已變動。' } },
  });
  ctx.OTP_STATE = { armed: true, gen: 0 };        // 先假設她手上有一組舊碼
  await vm.runInContext('onRequestOtp()', ctx);
  assert.equal(ctx.OTP_STATE.armed, false, '沒有 disarm——那組舊碼還送得出去');
});

/* ── 送出：binding 與確認框 ── */
test('🔴 送出前 binding 不成立就停手，而且要 disarm', () => {
  const { ctx, calls } = ctxWith(['onSend'], { bindingValid: false });
  vm.runInContext('onSend()', ctx);
  assert.equal(ctx.OTP_STATE.armed, false);
  assert.deepStrictEqual(calls.confirm, [], 'binding 都不成立了還跳確認框');
  assert.ok(calls.note.some((n) => n.text.indexOf('已停止送出') >= 0));
});

test('🔴 她在確認框按取消 → 什麼都不送，而且送出鈕要恢復', () => {
  const { ctx, calls } = ctxWith(['onSend'], { confirmAnswer: false });
  ctx.OTP_STATE = { armed: true, count: 5, uncertain: false, quotaWarning: '' };
  let sent = false;
  ctx.gasCall = () => { sent = true; return Promise.resolve({ ok: true }); };
  vm.runInContext('onSend()', ctx);
  assert.equal(sent, false, '她按了取消卻還是送出去了');
  assert.equal(ctx.SEND_IN_FLIGHT, false, '送出鈕卡在「送出中」');
  assert.ok(calls.syncSend.length > 0, '沒有重新推導按鈕狀態');
});

test('🔴 人數不確定時，確認框不可以報一個假數字', () => {
  const { ctx, calls } = ctxWith(['onSend'], { confirmAnswer: false });
  ctx.OTP_STATE = { armed: true, count: 0, uncertain: true, quotaWarning: '' };
  vm.runInContext('onSend()', ctx);
  assert.ok(calls.confirm[0].indexOf('無法確認') >= 0,
    '報了一個假數字：' + calls.confirm[0]);
  assert.ok(calls.confirm[0].indexOf('0 位同仁') < 0);
});

test('確認框要講「收不回來」——它是這一頁唯一不可逆的動作', () => {
  const { ctx, calls } = ctxWith(['onSend'], { confirmAnswer: false });
  ctx.OTP_STATE = { armed: true, count: 137, uncertain: false, quotaWarning: '' };
  vm.runInContext('onSend()', ctx);
  assert.ok(calls.confirm[0].indexOf('137 位同仁') >= 0, calls.confirm[0]);
  assert.ok(calls.confirm[0].indexOf('收不回來') >= 0, calls.confirm[0]);
});

test('🔴 送出的傳輸失敗＝unknown，也要 disarm（碼可能已經被消耗掉）', async () => {
  const { ctx, calls } = ctxWith(['onSend'], {
    responses: { sendWelfareBroadcast: { ok: false, transport: true } },
  });
  ctx.OTP_STATE = { armed: true, count: 5, uncertain: false, quotaWarning: '' };
  await vm.runInContext('onSend()', ctx);
  assert.equal(ctx.OTP_STATE.armed, false, '留著輸碼狀態只會讓她再按一次、然後收到「已用過」');
  const st = calls.status.pop();
  assert.equal(st && st.state, 'unknown', '把「不知道」講成了失敗');
});

test('🔴 送出成功要 disarm（這組碼已經用掉了）並交給 showState', async () => {
  const { ctx, calls } = ctxWith(['onSend'], {
    responses: { sendWelfareBroadcast: { ok: true, state: 'sent', sentCount: 137 } },
  });
  ctx.OTP_STATE = { armed: true, count: 137, uncertain: false, quotaWarning: '' };
  await vm.runInContext('onSend()', ctx);
  assert.equal(ctx.OTP_STATE.armed, false);
  assert.equal((calls.status.pop() || {}).state, 'sent');
  assert.equal(ctx.SEND_IN_FLIGHT, false, '送出鈕永久卡在「送出中」');
});

test('🔴 打錯驗證碼要留著讓她再試；碼死了才 disarm', () => {
  const bad = ctxWith(['showServerReject'], {});
  bad.ctx.OTP_STATE = { armed: true };
  vm.runInContext('showServerReject({ ok:false, reason:"bad_code", msg:"驗證碼不正確。" })', bad.ctx);
  assert.equal(bad.ctx.OTP_STATE.armed, true, '打錯字就把她踢出去了，她得重寄一次');

  const dead = ctxWith(['showServerReject'], {});
  dead.ctx.OTP_STATE = { armed: true };
  vm.runInContext('showServerReject({ ok:false, reason:"expired", msg:"驗證碼已過期。" })', dead.ctx);
  assert.equal(dead.ctx.OTP_STATE.armed, false,
    '碼已經死了還留著輸碼欄，她會對著一個永遠不會成功的欄位一直按');
});

/* ── 啟動順序 ── */
test('🔴 init 先接線再載資料（invalidator 要早於任何重繪）', () => {
  const { ctx } = ctxWith(['init'], {});
  const order = [];
  ctx.registerPhSet = () => order.push('ph');
  ctx.enableEmoji = () => {}; ctx.renderPhs = () => {}; ctx.renderEmojiPalette = () => {};
  ctx.LINE_EMOJI = []; ctx.LINE_EMOJI_GROUPS = [];
  ctx.wireBindingInvalidators = () => order.push('wire-inval');
  ctx.wireTemplateSelector = () => order.push('wire-sel');
  ctx.wireButtons = () => order.push('wire-btn');
  ctx.loadAudience = () => { order.push('load'); return Promise.resolve(); };
  ctx.loadTemplates = () => order.push('tpl');
  vm.runInContext('init()', ctx);
  assert.ok(order.indexOf('wire-inval') < order.indexOf('load'),
    '先載資料才接線——第一次重繪時 invalidator 還不存在');
  assert.deepStrictEqual(order.slice(0, 5), ['ph', 'wire-inval', 'wire-sel', 'wire-btn', 'load']);
});

/* ── codex G3 高③：showState 必須用「送出當下」的範本 ────────────────── */

test('🔴 showState 帶了 sentTpl 時，結果記在那一則身上（不是現在選的那則）', () => {
  const { ctx } = ctxWith(['showState'], {
    CURRENT_TPL: 't2',                       // 送出等待期間她切到了 t2
    TEMPLATES: { t1: { id: 't1', title: '端午' }, t2: { id: 't2', title: '中秋' } },
  });
  vm.runInContext('showState({ ok:true, state:"sent", lastSentAt:"X" }, "t1")', ctx);
  assert.equal(ctx.LAST_STATUS.templateId, 't1',
    'A 的送出結果被記到 B 頭上 ⇒ B 看起來已送、實際一則都沒送');
});

test('對照組：沒帶 sentTpl 時退回 CURRENT_TPL（既有呼叫端不受影響）', () => {
  const { ctx } = ctxWith(['showState'], { CURRENT_TPL: 't2' });
  vm.runInContext('showState({ ok:true, state:"sent" })', ctx);
  assert.equal(ctx.LAST_STATUS.templateId, 't2');
});

test('🔴 已經切走時不可以把 A 的結果畫到 B 的狀態列上，但要講得出是哪一則', () => {
  const { ctx, calls } = ctxWith(['showState'], {
    CURRENT_TPL: 't2',
    TEMPLATES: { t1: { id: 't1', title: '端午節禮金發放' } },
  });
  vm.runInContext('showState({ ok:true, state:"sent", msg:"已送出 2 則。" }, "t1")', ctx);
  assert.deepStrictEqual(calls.status, [], '把 A 的結果畫到 B 的狀態列了');
  const note = calls.note.filter((n) => n.id === 'send-note').pop();
  assert.ok(note && note.text.indexOf('端午節禮金發放') >= 0,
    '沒講出是哪一則的結果：' + (note && note.text));
});

test('🔴 送出結果一到，所有在途的狀態查詢都要失效', () => {
  const { ctx } = ctxWith(['showState'], { CURRENT_TPL: 't1' });
  const before = ctx.STATUS_GEN;
  vm.runInContext('showState({ ok:true, state:"sent" }, "t1")', ctx);
  assert.ok(ctx.STATUS_GEN > before,
    '沒讓在途的查詢失效 ⇒ 較舊的回應仍可能蓋掉這次的結果');
});
