const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 桌次分頁「下載選單」的接線測試（2026-08-23）。
 *
 * 為何存在：buildAttendeeAoa 是純函式、已被 seating.test.js 蓋滿，但**它被餵什麼**
 * 是接線——參數順序寫反、unitOrder 沒接上、下拉索引對錯函式，純函式測試一條都抓不到，
 * 而且全都零錯誤訊息（檔案照樣產得出來，只是內容錯）。
 * 手法沿用 pass-diag-wiring：從 stats.html 抽原始碼配 stub 跑，不另抄一份等價的。
 */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');

function extract(re, what) {
  const m = SRC.match(re);
  assert.ok(m, `stats.html 裡找不到 ${what}——改名了就要同步改這支測試`);
  return m[0];
}
const fnSrc = (name) => extract(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'), `function ${name}`);
const menuSrc = () => extract(/^var DL_MENU = \[[\s\S]*?^\];/m, 'var DL_MENU');

/** 建一個裝了 stub 的 context，把指定的原始碼片段跑進去。 */
function ctxWith(opt) {
  opt = opt || {};
  const calls = { msg: [], aoa: [], write: [] };
  const els = {};
  const ctx = {
    console, Promise,
    SB: opt.SB === undefined ? null : opt.SB,
    setMsg: (id, text, cls) => calls.msg.push({ id, text, cls }),
    esc: (s) => String(s),
    __rdlXlsx: () => Promise.resolve(),
    seatCategories_: () => Promise.resolve(opt.groups || {
      unitOrder: ['管理部'], owners: ['王小明'], guestsByOwner: { 王小明: ['千容營造'] },
      byUnit: { 管理部: ['甲'] }, empCount: 1, guestSeats: 1,
    }),
    guestOwnerOrder: (owners) => owners.slice(),
    buildAttendeeAoa: (seats, ranks, unitOrder, ownerOrder) => {
      calls.aoa.push({ seats, ranks, unitOrder, ownerOrder });
      return [['單位', '姓名', '職稱', '桌次', '葷素']];
    },
    writeSeatXlsx_: (aoa, fname, sheet, o) => {
      calls.write.push({ aoa, fname, sheet, opts: o });
      return Promise.resolve();
    },
    document: { getElementById: (id) => (els[id] = els[id] || { innerHTML: '', value: '' }) },
  };
  vm.createContext(ctx);
  return { ctx, calls, els };
}

// ── dlAttendees：餵給 buildAttendeeAoa 的四個參數 ──────────────────────
const SEATS = [
  { kind: 'emp', name: '甲', unit: '管理部', title: '主任', table: '1' },
  { kind: 'guest', name: '千容營造', unit: '王小明', table: '' },
];
const SB_OK = { actName: '2026年中聚餐', seats: SEATS, ranks: { 主任: 4 } };

async function runAttendees(opt) {
  const h = ctxWith(opt);
  vm.runInContext(fnSrc('dlAttendees'), h.ctx);
  h.ctx.dlAttendees();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return h;
}

test('dlAttendees：把 SB.seats／SB.ranks／unitOrder／負責人順序照這個次序餵給 buildAttendeeAoa', async () => {
  const h = await runAttendees({ SB: SB_OK });
  assert.equal(h.calls.aoa.length, 1);
  const a = h.calls.aoa[0];
  assert.strictEqual(a.seats, SEATS);
  assert.deepEqual(a.ranks, { 主任: 4 });
  assert.deepEqual(a.unitOrder, ['管理部']);
  assert.deepEqual(a.ownerOrder, ['王小明']);
});

test('dlAttendees：檔名帶活動名、凍結首列', async () => {
  const h = await runAttendees({ SB: SB_OK });
  assert.equal(h.calls.write.length, 1);
  assert.equal(h.calls.write[0].fname, '全員桌次名單_2026年中聚餐');
  assert.equal(h.calls.write[0].opts.freeze, 'A2');
});

test('dlAttendees：有人未排桌時，訊息要講出來且標成警示', async () => {
  const h = await runAttendees({ SB: SB_OK });
  const last = h.calls.msg[h.calls.msg.length - 1];
  assert.match(last.text, /1 人未排桌/);
  assert.equal(last.cls, 'err');
});

test('dlAttendees：全部排好桌時訊息不提未排桌、標成 ok', async () => {
  const seats = [{ kind: 'emp', name: '甲', unit: '管理部', title: '主任', table: '1' }];
  const h = await runAttendees({ SB: { actName: 'A', seats, ranks: {} } });
  const last = h.calls.msg[h.calls.msg.length - 1];
  assert.doesNotMatch(last.text, /未排桌/);
  assert.equal(last.cls, 'ok');
});

test('dlAttendees：沒選活動就不產檔', async () => {
  const h = await runAttendees({ SB: null });
  assert.equal(h.calls.write.length, 0);
  assert.equal(h.calls.msg[0].text, '請先選活動');
});

test('dlAttendees：活動沒有出席名單就不產檔', async () => {
  const h = await runAttendees({ SB: { actName: 'A', seats: [], ranks: {} } });
  assert.equal(h.calls.write.length, 0);
  assert.equal(h.calls.msg[0].text, '此活動還沒有出席名單');
});

// ── 下拉：選項與路由 ────────────────────────────────────────────────────
/** DL_MENU 引用四支下載函式，先放同名 stub 佔位，才記得住誰被叫到。 */
function runMenu(pickValue) {
  const h = ctxWith({});
  const ran = [];
  ['dlAttendees', 'dlFormal', 'dlGuestFile', 'dlSignin'].forEach((n) => {
    h.ctx[n] = (msgId) => ran.push({ fn: n, msgId });
  });
  vm.runInContext(menuSrc(), h.ctx);
  vm.runInContext(fnSrc('dlMenuInit'), h.ctx);
  vm.runInContext(fnSrc('dlPick'), h.ctx);
  h.ctx.dlMenuInit();
  if (pickValue !== undefined) { h.els['dl-pick'].value = pickValue; h.ctx.dlPick(); }
  return { ...h, ran, menu: h.ctx.DL_MENU };
}

test('dlMenuInit：選項數量與標籤跟 DL_MENU 一致，value 是索引', () => {
  const h = runMenu();
  const html = h.els['dl-pick'].innerHTML;
  assert.equal((html.match(/<option/g) || []).length, h.menu.length);
  h.menu.forEach((it, i) => {
    assert.ok(html.includes('<option value="' + i + '">' + it.label + '</option>'),
      `第 ${i} 個選項應為 ${it.label}`);
  });
});

test('dlMenuInit：四個選項就是使用者拍板的那四份，順序固定', () => {
  const h = runMenu();
  assert.deepEqual(h.menu.map((x) => x.label),
    ['全員桌次名單', '正式座位表', '來賓名單', '來賓簽到表']);
});

test('dlPick：每一個選項都路由到自己那支函式，訊息一律印在 dl-msg', () => {
  const expect = ['dlAttendees', 'dlFormal', 'dlGuestFile', 'dlSignin'];
  expect.forEach((fn, i) => {
    const h = runMenu(String(i));
    assert.deepEqual(h.ran, [{ fn, msgId: 'dl-msg' }], `第 ${i} 個選項應叫 ${fn}`);
  });
});

test('dlPick：索引超出選單範圍時不叫任何函式', () => {
  const h = runMenu('99');
  assert.deepEqual(h.ran, []);
  assert.equal(h.calls.msg[0].text, '請選擇要下載的檔案');
});

// ── 舊的三支下載仍收下 msgId，否則訊息會印回原本的卡 ──────────────────
test('dlGuestFile／dlSignin／dlFormal 都接受 msgId，不給時各自維持原本的訊息位置', () => {
  [['dlGuestFile', 'gl-msg'], ['dlSignin', 'gl-msg'], ['dlFormal', 'sm-msg']].forEach(([fn, dflt]) => {
    const src = fnSrc(fn);
    assert.match(src, new RegExp('^function ' + fn + '\\(msgId\\)'),
      `${fn} 要收 msgId，否則下拉的訊息印不到 dl-msg`);
    assert.ok(src.includes("var M=msgId||'" + dflt + "';"),
      `${fn} 的預設訊息位置應為 ${dflt}`);
  });
});
