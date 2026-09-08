/**
 * deny-no-role.js 的行為測試（2026-09-08 新增）。
 *
 * 🔴 **在此之前這支一條行為測試都沒有。** 全站唯一提到它的是
 *    tests/tpl-editor.test.js:146 的載入順序清單——那驗的是「有被載入」，
 *    不是「載入之後會做對的事」。而它管的是**整頁遮罩**：判錯一次，
 *    要嘛有權的人整頁看不到（2026-07-30 雅慧那次），要嘛沒權的人看到一片載入失敗。
 *
 * ⚠️ 手法：把 assets/deny-no-role.js 真的跑進 vm，用假的 document／setTimeout
 *    觀察遮罩有沒有被 appendChild。**不抄一份等價的判斷來測**——抄的那份會漂移，
 *    而漂移不報錯（沿用 welfare-page-wiring.test.js 的既有手法）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets', 'deny-no-role.js'), 'utf8');

/** 跑一次 denyNoRole，回報整頁遮罩有沒有被貼上去。 */
function overlayShown(resp, opt) {
  opt = opt || {};
  let timerFn = null;
  let timers = 0;
  let appended = 0;
  const ctx = {
    window: {},
    setTimeout(fn) { timers += 1; timerFn = fn; return timers; },
    document: {
      createElement: () => ({ setAttribute() {}, set innerHTML(_v) {} }),
      body: { appendChild() { appended++; } },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'deny-no-role.js' });
  const call = vm.runInContext('denyNoRole', ctx);
  (opt.before || []).forEach(call);
  call(resp);
  (opt.after || []).forEach(call);
  if (timerFn) timerFn();          // 讓那 2500ms 到期
  return { shown: appended > 0, timers: timers };
}

const 角色不符 = { ok: false, reason: 'role_mismatch', msg: '此連結非您的權限範圍。' };

test('角色不符（reason）⇒ 蓋整頁', () => {
  assert.equal(overlayShown(角色不符).shown, true,
    '後端送 reason:role_mismatch 時沒有蓋整頁——拿錯連結的人會看到一片普通的載入失敗');
});

test('🔴 舊的文案比對已經拿掉：只有那句話、沒有 reason ⇒ 不蓋整頁', () => {
  // 這條是 2026-09-08 這次改動的正向證據。它同時是「後端還沒送 reason 就合併」
  // 會出事的證明——那時整頁遮罩不會出現，而且沒有任何錯誤訊息。
  assert.equal(overlayShown({ ok: false, msg: '此連結非您的權限範圍。' }).shown, false,
    '還在比對 msg 的文字——後端一改措辭，這道處置就會在三頁靜默消失');
});

test('🔴 偽陽性已經消滅：別的訊息含「權限範圍」四個字 ⇒ 不蓋整頁', () => {
  // 實測過的真實危險：一句本來要幫忙的話，會把整頁蓋掉。
  const 好意的話 = { ok: false, msg: '若需要更多功能，請聯絡管理員擴大權限範圍。' };
  assert.equal(overlayShown(好意的話).shown, false,
    '一句幫忙的話把整頁蓋掉了——這是 2026-07-30 事故的同一形狀，入口換成文案');
});

test('附屬功能被擋、主功能有回來 ⇒ 不蓋整頁（2026-07-30 那條防線還在）', () => {
  assert.equal(overlayShown(角色不符, { after: [{ ok: true }] }).shown, false,
    '期間有 action 成功回來就代表有權進這一頁，只是某支附屬功能被擋，不該蓋整頁');
  assert.equal(overlayShown(角色不符, { before: [{ ok: true }] }).shown, false,
    '先成功再被擋也一樣——順序不該改變結論');
});

test('🔴 role_unresolved 不蓋整頁——這是本次改動唯一刻意改掉的行為', () => {
  // 後端 roles.js 的 scoped 分支：身分認出來了，但**算不出**他的角色（接線漏了／這把 token
  // 沒有內部碼／內部碼在授權名單上沒有生效的列）。它送的 msg 與 role_mismatch
  // 是同一句（`GATE_MSG_OUT_OF_SCOPE`）⇒ **舊的文案比對會把這一種一起蓋掉**。
  //
  // 🔴 這一條釘的是「不蓋」。行為變化如果沒有斷言，下一個人看到「這一種不蓋」
  //    會當成 bug 修回去，而他修回去之後**全套照樣綠**。
  //    理由是兩種的處置相反（見後端 GATE_REJECT 檔頭）：role_mismatch 該叫他
  //    換連結，role_unresolved 換了也不會好，多半是設定沒同步。拿「請改用您自己
  //    的看板連結」蓋住後者，等於叫他去做一件不會有用的事。
  //
  // ⚠️ 期望值 'role_unresolved' 逐字寫死，不從受測物或後端取——從受測物取的話，
  //    代號被改掉時這一條會跟著改，等於沒有在釘任何東西。
  const 算不出角色 = { ok: false, reason: 'role_unresolved', msg: '此連結非您的權限範圍。' };
  assert.equal(overlayShown(算不出角色).shown, false,
    'role_unresolved 被蓋了整頁——判準若寫成「有 reason 就蓋」，兩種相反的處置'
    + '會退化成一種，而後端把它們分開的整件事就是為了讓人分得出原因');
});

test('🔴 別的 reason 不蓋整頁（只有 role_mismatch 這一種該蓋）', () => {
  // ⚠️ 這裡的值全部取自後端真的送得出來的東西，**不編**。
  //    線上有**兩套** reason 字彙，這裡各取一個：
  //    · 第一套＝角色守門（`gateAction`）：只有 `role_mismatch`／`role_unresolved`。
  //    · 第二套＝福委會第二道守門（`welfareStrictGate_`），與第一套共用同一個 JSONP
  //      信封 `{ok:false, msg, reason}`。字面值有 `token`／`unbound`／`bad_binding`，
  //      另外 `verify_*` 與 `identity_*` 是**動態拼出來的**（`'verify_' + v.reason`）。
  //    🔴 動態拼的那兩支**列不完** ⇒ 判準只能是白名單（「只有 role_mismatch 蓋」），
  //       不能是黑名單。這一條測的就是白名單這個形狀。
  //    ⚠️ 第二套今天走不到這三頁：`welfare.html` 沒有載入本檔（2026-09-08 實測，
  //       `grep -ln deny-no-role *.html` 只有 board／stats／hr-stats／messages）。
  //       列在這裡是防判準日後被放寬成「有 reason 就蓋」，不是宣稱這三頁會收到它。
  //    「沒有 reason 欄位」則是今天最常見的一種：`gateAction` 8 處拒絕裡有 5 處
  //    不帶 reason，全部落在這一格。
  const 別種 = [
    ['福委會身分未綁定（unbound）', { ok: false, reason: 'unbound', msg: '這把連結還沒綁定身分。' }],
    ['第二套字彙的動態值（verify_no_token）',
      { ok: false, reason: 'verify_no_token', msg: '無權限或連結已失效' }],
    ['沒有 reason 欄位', { ok: false, msg: '無權限或連結已失效。' }],
  ];
  const 誤蓋的 = 別種.filter(([, r]) => overlayShown(r).shown).map(([name]) => name);
  assert.deepEqual(誤蓋的, [],
    `這幾種情況被誤蓋了整頁：${誤蓋的.join('、')}`
    + '——判準若寫成「有 reason 就蓋」，各自不同的處置會退化成一種。');
});

test('多支同時被擋只排一次計時器（用數的，不是看有沒有）', () => {
  const r = overlayShown(角色不符, { after: [角色不符, 角色不符] });
  assert.equal(r.shown, true, '被擋了卻沒蓋整頁');
  assert.equal(r.timers, 1,
    `三支被擋排了 ${r.timers} 個計時器——每個到期都會 appendChild 一層遮罩，疊在一起`);
});

test('三頁都把 denyNoRole 接在 jsonp 的解析出口（少接一頁＝那頁沒有這道處置）', () => {
  const 頁 = ['board.html', 'stats.html', 'hr-stats.html'];
  const 沒接的 = 頁.filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('denyNoRole('));
  assert.deepEqual(沒接的, [],
    `這幾頁沒有接上 denyNoRole：${沒接的.join('、')}`
    + '——那幾頁拿錯連結的人只會看到普通的載入失敗。'
    + '（messages.html 刻意不接，理由寫在它自己的 callApi 檔頭，不要加進這張清單。）');
});

test('stats.html 的 surfaceErr 不會把 reason 吃掉（它多包了一層，另兩頁沒有）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'stats.html'), 'utf8');
  const m = html.match(/^function surfaceErr\([\s\S]*?^}/m);
  assert.ok(m, 'stats.html 找不到 surfaceErr——改名了就要同步改這支測試');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(m[0], ctx, { filename: 'stats.html:surfaceErr' });
  const out = vm.runInContext('surfaceErr', ctx)({ ok: false, reason: 'role_mismatch', msg: 'x' });
  assert.equal(out.reason, 'role_mismatch',
    'surfaceErr 把 reason 弄丟了 ⇒ stats.html 這一頁的整頁遮罩永遠不會出現，而另兩頁正常');
});

test('跨 repo 對齊的那個字面值：代號必須是 role_mismatch', () => {
  // 這條釘的是本 repo 這一半。另一半（後端 roles.js 三個出口）沒有任何機械的東西
  // 逼它相等——只改一邊，兩邊的測試都會綠。見 deny-no-role.js 檔頭。
  assert.match(SRC, /DENY_REASON_ROLE_MISMATCH = 'role_mismatch';/,
    '代號被改掉了——後端 roles.js 那三個出口要同一次改動一起改');
});
