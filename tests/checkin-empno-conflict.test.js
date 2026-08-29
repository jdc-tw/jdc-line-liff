const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * C1：核准前的員編撞號警語（board.html）。
 *
 * 為何存在（2026-08-28 最終審查 C1）：留停者換 LINE 帳號回鍋報到時，
 * 人事按下「核准報到」＝**覆寫名冊上那一列**。拍板是放行，但畫面要先指名道姓
 * 講清楚覆寫的是誰。離職列原本是靜默覆寫，一併補上。
 *
 * ⚠️ 這支盯的是最容易做成裝飾品的那一半：新人報到表單**不收員編**
 *（index.html 沒有這個欄位，對照組見 `grep -c submitCheckin index.html`＝1、
 *  `grep -c 員編 index.html`＝0），員編是人事在這張卡上當場打的。
 * 警語如果只吃「這一列存檔的員編」，在最該出現的那一次永遠不會出現、零錯誤訊息。
 *
 * R23（2026-08-29 複審）：empWarnText 曾用 `st==='離職'` 的字面比對判斷是否顯示「已離職」，
 * 違反本專案「前端也禁止在職狀態字面比對」的規定（Ruling R15）。改用 assets/roster-wide.js
 * 匯出的 jdcIsSeparated，跟 board.html 942 行既有的用法、以及後端 binding.js 的
 * isSeparated 同一套語意，不在前端另立一套判斷。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'board.html'), 'utf8');
const ROSTER_WIDE = require('../assets/roster-wide.js');

/** 從頁面抽一支頂層函式的原始碼。抽不到就是簽名被改了，測試要跟著改。 */
function grab(name) {
  const re = new RegExp('^function ' + name + ' ?\\([^)]*\\) ?\\{[\\s\\S]*?^\\}', 'm');
  const m = HTML.match(re);
  assert.ok(m, `board.html 找不到 function ${name}(...)——改了簽名就要同步改這支測試`);
  return m[0];
}

function load(conflicts, opts) {
  const spyCalls = [];
  const ctx = {
    console, String, gEmpConflicts: conflicts || {},
    // 真貨（roster-wide.js 的 jdcIsSeparated），套一層記錄呼叫次數的殼——
    // 用真的判斷邏輯，同時能斷言 empWarnText 真的有呼叫它，不是巧合算對。
    jdcIsSeparated: function (st) { spyCalls.push(st); return ROSTER_WIDE.jdcIsSeparated(st); },
  };
  vm.createContext(ctx);
  vm.runInContext(grab('empConflictOf') + '\n' + grab('empWarnText'), ctx, { filename: 'board.html-extract' });
  ctx.__spyCalls = spyCalls;
  return ctx;
}

const IDX = {
  '02': { name: '留停乙', status: '留職停薪' },
  '03': { name: '離職丙', status: '離職' },
};

test('C1：人事當場打進留停者的員編 → 立刻查得到撞號（這一列存檔員編是空的）', () => {
  const ctx = load(IDX);
  assert.deepStrictEqual({ ...ctx.empConflictOf('02', '', null) }, IDX['02']);
});

test('C1：撞離職列同樣查得到（原本是靜默覆寫）', () => {
  const ctx = load(IDX);
  assert.deepStrictEqual({ ...ctx.empConflictOf('03', '', null) }, IDX['03']);
});

test('C1：撞在勤者或查無 → null（不製造假警報）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empConflictOf('01', '', null), null);
  assert.strictEqual(ctx.empConflictOf('99', '', null), null);
});

test('C1：空員編 → null（還沒填的卡不該掛警語）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empConflictOf('', '', null), null);
  assert.strictEqual(ctx.empConflictOf('   ', '', null), null);
  assert.strictEqual(ctx.empConflictOf(null, '', null), null);
});

test('C1：索引缺席（部署前存的舊快取）→ 退回後端算好的那一筆，不整張卡失去警語', () => {
  const ctx = load({});   // gEmpConflicts 空物件＝舊快取
  const orig = { name: '留停乙', status: '留職停薪' };
  assert.deepStrictEqual({ ...ctx.empConflictOf('02', '02', orig) }, orig);
});

test('C1：索引缺席且人事把員編改成別的 → 不得沿用上一個人的警語', () => {
  const ctx = load({});
  const orig = { name: '留停乙', status: '留職停薪' };
  assert.strictEqual(ctx.empConflictOf('77', '02', orig), null,
    '輸入值已經不是存檔值了還掛著舊警語＝畫面在說謊，比沒有警語更糟');
});

test('C1：警語指名道姓，並說出「核准將覆寫該列」', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText(IDX['02']),
    '⚠️ 此員編屬留職停薪同仁 留停乙，核准將覆寫該列。');
  assert.strictEqual(ctx.empWarnText(IDX['03']),
    '⚠️ 此員編屬已離職同仁 離職丙，核准將覆寫該列。');
});

test('C1：沒有撞號 → 空字串（渲染端據此收起整塊）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText(null), '');
});

test('C1：名冊未填姓名也要有話講（不得印出 undefined）', () => {
  const ctx = load(IDX);
  assert.strictEqual(ctx.empWarnText({ name: '', status: '留職停薪' }),
    '⚠️ 此員編屬留職停薪同仁 （名冊未填姓名），核准將覆寫該列。');
});

test('R23：empWarnText 真的呼叫 jdcIsSeparated 判斷離職，不是自己重建字面比對', () => {
  const ctx = load(IDX);
  ctx.empWarnText(IDX['03']);   // status: '離職'
  assert.ok(ctx.__spyCalls.indexOf('離職') >= 0,
    'jdcIsSeparated 沒被呼叫＝board.html 還在用自己的 st===\'離職\' 字面比對（R23 未收掉）');
});

test('R23 接線：原始碼不得殘留 st===\'離職\' 這種前端字面比對（一律走 jdcIsSeparated）', () => {
  const src = grab('empWarnText');
  assert.ok(!/===\s*['"]離職['"]/.test(src),
    'empWarnText 裡還有直接比對「離職」字面值——本專案規定在職狀態一律用 jdcIsSeparated／jdcIsOnDuty 判斷');
  assert.ok(/jdcIsSeparated\(/.test(src),
    'empWarnText 沒有呼叫 jdcIsSeparated——R23 要求改用 assets/roster-wide.js 匯出的判斷式');
});

// ── 接線：光有函式沒接上去＝警語永遠不出現，而且零錯誤訊息 ──────────────────
test('C1 接線：renderRow 在開卡當下就畫一次警語', () => {
  const src = grab('renderRow');
  assert.ok(/paintEmpWarn\(\);/.test(src),
    'renderRow 沒有在渲染當下呼叫 paintEmpWarn＝曾核准過又重送報到的列開卡看不到警語');
});

test('C1 接線：員編輸入框要掛 input 監聽（主要情境是人事當場打員編）', () => {
  const src = grab('renderRow');
  assert.ok(/addEventListener\('input',\s*paintEmpWarn\)/.test(src),
    '員編欄沒有掛 input 監聽＝人事打進留停者員編時警語不會出現，而那正是 C1 的情境');
});

test('C1 接線：renderLoad 要把後端的 empNoConflicts 收進索引', () => {
  const src = grab('renderLoad');
  assert.ok(/gEmpConflicts\s*=\s*r\.empNoConflicts\s*\|\|\s*\{\}/.test(src),
    '索引沒有從回應收進來＝empConflictOf 永遠查空，警語形同不存在');
});

// ── R22（2026-08-29 複審）：SWR 髒旗標把警語鎖在空索引上 ──────────────────────
// gEmpConflicts 只在網路那一發（load() 的 Promise.all）被賦值。如果 isDirty('pending')
// 成立就整段 early-return，索引會停在部署後第一次開頁的快取版（{}）——那一整場都不會出現
// 警語，且不重整頁面永遠不會補出現。修法：在 early-return 之前先接住索引，
// 並對已開的卡重畫一次警語（只動 .empwarn，不動任何 input）。

test('R22：髒旗標成立時（整段重繪被跳過），索引仍然要被更新，且不觸發整版重繪', async () => {
  const cardsBox = [];
  const calls = { hintStale: [], renderLoad: [], watchDirty: [], repaint: [] };
  const ctx = {
    console, Promise, String, Object,
    document: { getElementById: (id) => (id === 'pending' ? { innerHTML: '' } : null) },
    CACHE_READY: Promise.resolve(),
    cacheGet: () => null,   // 沒有磁碟快取 → co/cp 維持 null，走「載入中…」那支
    N: { checkinOptions: 'co', checkinPending: 'cp' },
    pick: (action) => {
      if (action === 'getCheckinOptions') return Promise.resolve({ ok: true, units: [] });
      if (action === 'getCheckinPending') {
        return Promise.resolve({
          ok: true,
          rows: [], done: [], who: '人事甲',
          empNoConflicts: { '02': { name: '留停乙', status: '留職停薪' } },
        });
      }
      return Promise.resolve(null);
    },
    isDirty: () => true,   // 模擬人事正在下面編輯：SWR 第二次繪製必須整段跳過
    hintStale: (id) => calls.hintStale.push(id),
    renderLoad: (rs) => calls.renderLoad.push(rs),
    watchDirty: (id) => calls.watchDirty.push(id),
    repaintEmpWarnings: () => calls.repaint.push(true),
    gEmpConflicts: {},   // 舊快取的空索引
  };
  vm.createContext(ctx);
  vm.runInContext(grab('load'), ctx, { filename: 'board.html-extract-load' });
  ctx.load();
  // load() 內部是兩條各自 .then 的 promise 鏈，非同步等它們跑完（同檔案其他測試同樣手法，見 board-cache-wiring.test.js）。
  await new Promise((res) => setTimeout(res, 10));

  assert.deepStrictEqual(ctx.gEmpConflicts, { '02': { name: '留停乙', status: '留職停薪' } },
    '索引沒有更新＝人事在批次回來前就開始打員編，那一整場都不會出現警語（R22 症狀）');
  assert.strictEqual(calls.hintStale.length, 1, 'isDirty 成立時仍要照舊提示「有較新資料」');
  assert.strictEqual(calls.repaint.length, 1, '索引更新後要重畫已開的卡，不然更新了也不會反映在畫面上');
  assert.strictEqual(calls.renderLoad.length, 0, '早退的既有行為不能被拿掉——不准整版重繪蓋掉人事正在打的字');
});

test('R22：repaintEmpWarnings 重畫警語框，不動 input 的值（真的走 renderRow）', () => {
  // 手刻一個最小但「真的能查」的 DOM：querySelector 依選擇字串回傳固定的元素，
  // 讓 renderRow 抽出來的原始碼可以真的跑，而不是只驗字串接線。
  const cards = [];
  const doc = {
    createElement() {
      const registry = new Map();
      function get(sel) {
        if (!registry.has(sel)) {
          registry.set(sel, {
            value: '', className: '', textContent: '', innerHTML: '',
            addEventListener() {}, focus() {},
          });
        }
        return registry.get(sel);
      }
      return { className: '', innerHTML: '', querySelector: get, remove() {} };
    },
    querySelectorAll(sel) { return sel === '#pending .card' ? cards : []; },
  };
  const ctx = {
    console, String, Object,
    document: doc,
    gEmpConflicts: {},   // 開卡當下沒有撞號
    jdcIsSeparated: ROSTER_WIDE.jdcIsSeparated,
    esc: (s) => (s == null ? '' : String(s)),
    unitSelectHtml: () => '',
    buildTitleField: () => {},
    emailPrefix: (s) => s || '',
    EMAIL_DOMAIN: '@x',
  };
  vm.createContext(ctx);
  vm.runInContext(
    [grab('empConflictOf'), grab('empWarnText'), grab('renderRow'), grab('repaintEmpWarnings')].join('\n'),
    ctx, { filename: 'board.html-extract-repaint' },
  );

  const row = { '報到日期': '', '姓名': '甲', '單位': '', '職稱': '', '生日': '', '公司信箱': '', '員編': '', empNoConflict: null };
  const d = ctx.renderRow(row);
  cards.push(d);

  const empInput = d.querySelector('[data-k="員編"]');
  const warnBox = d.querySelector('[data-empwarn]');
  assert.strictEqual(warnBox.className, 'empwarn', '開卡當下員編是空的，不該掛警語');

  // 模擬：人事正在打員編（值已經在框裡），同時背景那批網路資料剛好帶回撞號索引。
  empInput.value = '02';
  ctx.gEmpConflicts = { '02': { name: '留停乙', status: '留職停薪' } };
  ctx.repaintEmpWarnings();

  assert.strictEqual(empInput.value, '02', 'repaintEmpWarnings 不准動到 input 的值——這是 SWR 吃字事故的同一形狀');
  assert.strictEqual(warnBox.className, 'empwarn show', '索引剛更新，重畫後應該要出現警語，不然更新了也沒用');
  assert.strictEqual(warnBox.textContent,
    '⚠️ 此員編屬留職停薪同仁 留停乙，核准將覆寫該列。');
});

test('R22 接線：renderRow 要把 paintEmpWarn 掛在卡片元素上，repaintEmpWarnings 才叫得到', () => {
  const src = grab('renderRow');
  assert.ok(/_paintEmpWarn\s*=\s*paintEmpWarn/.test(src),
    'renderRow 沒有把 paintEmpWarn 存到卡片元素上＝repaintEmpWarnings 沒有東西可以呼叫');
});

test('R22 接線：repaintEmpWarnings 只呼叫存好的 paintEmpWarn，不直接碰 input', () => {
  const src = grab('repaintEmpWarnings');
  assert.ok(/_paintEmpWarn\(\)/.test(src));
  assert.ok(!/\.value\s*=/.test(src),
    'repaintEmpWarnings 裡出現對 .value 賦值＝跟這支要防的 SWR 吃字事故同一形狀');
});
