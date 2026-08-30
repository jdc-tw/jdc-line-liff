const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * mode=bind 也要過加好友閘的「接線」測試（2026-08-29）。
 *
 * 為何存在：這是控制流，純函式測不到。換帳號的人必定是全新 LINE 帳號、
 * 必定沒加好友——閘沒接上的症狀是安靜的（他綁定成功、但收不到任何通知，
 * 而且自己不會發現）。手法：從 index.html 抽 applyState 原始碼配 stub 跑。
 */
function extractFn(name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = src.match(new RegExp('^    function ' + name + '\\([\\s\\S]*?^    }', 'm'));
  assert.ok(m, `index.html 裡找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

/** @param {{mode:string, state:object}} opt */
function runApplyState(opt, source) {
  const shown = [], hidden = [], gateCalls = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, textContent: '', innerHTML: '', appendChild() {} });
  const ctx = {
    console,
    document: { getElementById: el, querySelectorAll: () => [] },
    show: (id) => shown.push(id),
    hide: (id) => hidden.push(id),
    getMode: () => opt.mode,
    getAct: () => '',
    ensureFriendThenOnboard: () => gateCalls.push('onboard'),
    ensureFriendThenBind: () => gateCalls.push('bind'),
    showClosedIfReplied: () => {},
    escHtml: (s) => s,
    jsonp: () => Promise.resolve({ ok: false }),
    gActivityId: null, gUserId: 'U_TEST',
  };
  vm.createContext(ctx);
  vm.runInContext(source || extractFn('applyState'), ctx);
  ctx.applyState(opt.state);
  return { shown, hidden, gateCalls };
}

test('★mode=bind：顯示綁定表單，而且過加好友閘', () => {
  const { shown, gateCalls } = runApplyState({ mode: 'bind', state: { bound: false } });
  assert.ok(shown.includes('section-bind'), '綁定表單要顯示');
  assert.deepStrictEqual(gateCalls, ['bind'],
    '★沒呼叫 ensureFriendThenBind ⇒ 換帳號的人綁完收不到任何通知，而且不會發現');
});

test('一般入口（無 mode）：顯示引導卡，不過閘', () => {
  const { shown, gateCalls } = runApplyState({ mode: '', state: { bound: false } });
  assert.ok(shown.includes('section-need-verify'));
  assert.ok(!shown.includes('section-bind'), '綁定表單不該對不相干的人常開');
  assert.deepStrictEqual(gateCalls, []);
});

test('mode=onboard：仍走報到那道閘（沒被這次改動弄壞）', () => {
  const { shown, gateCalls } = runApplyState({ mode: 'onboard', state: null });
  assert.ok(shown.includes('section-onboard'));
  assert.deepStrictEqual(gateCalls, ['onboard']);
});

test('★對照組：把 bind 分支的閘拿掉，第一條必須翻紅', () => {
  const src = extractFn('applyState');
  const mutated = src.replace(/ensureFriendThenBind\(\);/, '');
  assert.notStrictEqual(mutated, src, '突變沒注入成功——先確認真的改到字了');
  const { gateCalls } = runApplyState({ mode: 'bind', state: { bound: false } }, mutated);
  assert.deepStrictEqual(gateCalls, [],
    '拿掉之後就沒有人呼叫閘 ⇒ ★那條斷言確實抓得到');
});

test('★兩道閘用不同的 DOM id（同 id 會讓其中一道按不動）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['ob-gate', 'ob-body', 'bind-gate', 'bind-body',
                    'btn-addfriend', 'btn-friend-recheck', 'btn-addfriend-bind', 'btn-recheck-bind']) {
    const hits = src.split(`id="${id}"`).length - 1;
    assert.strictEqual(hits, 1, `id="${id}" 出現 ${hits} 次——重複的 id 會讓 getElementById 只拿到第一個`);
  }
});

test('ensureFriendThenBind 指向 bind 那組 DOM，不是報到那組', () => {
  const fn = extractFn('ensureFriendThenBind');
  assert.match(fn, /gate:\s*'bind-gate'/);
  assert.match(fn, /body:\s*'bind-body'/);
  assert.match(fn, /add:\s*'btn-addfriend-bind'/);
  assert.ok(!/ob-gate|ob-body|setupOnboard/.test(fn),
    '綁定的閘指到報到那組 DOM ⇒ 閘永遠不會出現在綁定頁上');
});

test('★bind-body 預設隱藏——閘判定完成前表單不可見', () => {
  // 2026-08-30 突變測試抓到這個缺口：拿掉 display:none，上面六條照樣全綠。
  // getFriendship() 是**非同步**的，resolve 之前表單若可見就可填可送，那道閘等於沒有。
  // 這是外部審查第一輪的第 5 條（fail-open）。
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src, /<div id="bind-body" style="display:none">/,
    '★bind-body 沒有 display:none ⇒ 閘 resolve 前表單就能填能送，那道閘形同虛設');
});

test('對照組：報到頁的 ob-body 目前沒有這個保護——那是既有缺陷，不要複製到 bind', () => {
  // 這條不是斷言 ob-body 該怎樣，是把「兩者不同」這件事釘住：
  // 若哪天有人「順手統一」把 bind-body 的保護也拿掉，上面那條會紅。
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes('<div id="ob-body">'),
    'ob-body 的形狀變了——若是有人補上保護那是好事，把這條測試一起更新即可');
});
