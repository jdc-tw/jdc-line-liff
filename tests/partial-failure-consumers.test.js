const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 「這個人為什麼不在可用名單裡」——**兩張頁面必須給同一個答案，而且答案要來自後端。**
 *
 * 🔴 為何存在（2026-09-02，第四輪外審）：
 * 承辦端的 showPerson() 找不到人時顯示寫死的「未回覆參加？」，
 * 掃描站的 applySnapshotPayload() 只顯示一個數字。
 * 兩邊都拿得到真正的原因（缺內部碼／名冊查無此碼／名冊為離職／格式錯／碼重複），
 * 都沒有用——**而「未回覆參加？」已知不成立，它會把排查方向導到錯的地方。**
 *
 * 這一組守的不是「某一頁顯示對了」，是**兩個消費端不可能分歧**：
 * 兩邊都只能透過 assets/partial-failure.js 取得結論。
 * 對照組證明這條斷言抓得到「單邊漂移」——只證明現在一致是不夠的。
 */

const A = path.join(__dirname, '..', 'assets');
const STATS = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');
const STAFF = fs.readFileSync(path.join(__dirname, '..', 'staff.html'), 'utf8');

function fnSrc(src, name, where) {
  const m = src.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
  assert.ok(m, `${where} 裡找不到 function ${name}——改名了就要同步改這支測試`);
  return m[0];
}

/** 共用模組的真貨。兩個消費端都吃這一份，替換掉就等於什麼都沒測。 */
function pfSrc(override) {
  const s = fs.readFileSync(path.join(A, 'partial-failure.js'), 'utf8');
  return override ? override(s) : s;
}

/* 同一份後端 payload，兩邊都拿它。
   乙缺內部碼、丙的碼在名冊查不到、丁重複回覆。甲是唯一簽得出來的。 */
const PAYLOAD = {
  ok: true, total: 4,
  rows: [{ internalId: 'JDC-BCDFGH', name: '甲', unit: 'A部', code: 'CHK|act|JDC-BCDFGH|S' }],
  unsigned: [
    { name: '乙', unit: 'A部', internalId: '', why: '缺內部碼' },
    { name: '丙', unit: 'B部', internalId: 'JDC-JKMNPQ', why: '名冊查無此碼' },
  ],
  duplicated: [{ name: '丁', unit: 'B部', internalId: 'JDC-RSTVWX' }],
};

/* ── 消費端一：承辦端 stats.html 的 showPerson ──────────────────────────── */

function runShowPerson(code, name, override) {
  const msgs = [];
  const ctx = {
    console, String, Object, Array, Number, Promise, JSON,
    qrRows: () => Promise.resolve(PAYLOAD),
    setMsg: (id, t, cls) => msgs.push(t),
    esc: (s) => String(s == null ? '' : s),
    actId: () => 'act',
    SB: { seats: [], actName: '年中聚餐' },
    // 走到「找得到」那條路才會用到的東西：這一組測的是「找不到」那條，不必給。
  };
  vm.createContext(ctx);
  vm.runInContext(pfSrc(override), ctx, { filename: 'partial-failure.js' });
  vm.runInContext([fnSrc(STATS, 'findQr', 'stats.html'),
                   fnSrc(STATS, 'showPerson', 'stats.html')].join('\n'),
                  ctx, { filename: 'stats.html-extract' });
  ctx.showPerson(code, name);
  return new Promise((r) => setTimeout(() => r(msgs.join('｜')), 20));
}

/* ── 消費端二：掃描站 staff.html 的 renderSkipped ───────────────────────── */

function runRenderSkipped(res, override) {
  const box = { innerHTML: '' };
  const ctx = {
    console, String, Object, Array, Number,
    esc: (s) => String(s == null ? '' : s),
    document: { getElementById: (id) => (id === 'snapskip' ? box : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(pfSrc(override), ctx, { filename: 'partial-failure.js' });
  vm.runInContext(fnSrc(STAFF, 'renderSkipped', 'staff.html'), ctx,
                  { filename: 'staff.html-extract' });
  ctx.renderSkipped(res);
  return box.innerHTML;
}

/* ── 一條斷言綁兩個消費端 ───────────────────────────────────────────────── */

test('★★同一個原因，兩個消費端都要講得出來（承辦端 showPerson／掃描站 renderSkipped）', async () => {
  // 丙：有內部碼，但名冊查無此碼。這是「去確認他在不在職」，不是「他沒回覆參加」。
  const stats = await runShowPerson('JDC-JKMNPQ', '丙');
  const staff = runRenderSkipped({ unusable: 2, skippedPeople: PAYLOAD.unsigned });

  assert.match(stats, /名冊查無此碼/, '承辦端沒講原因。實際：' + stats);
  assert.match(staff, /名冊查無此碼/, '掃描站沒講原因。實際：' + staff);
  assert.match(staff, /丙/, '掃描站只給數字＝門口的人答不出是誰');
});

/**
 * 註解也算原始碼。第一版這條判準寫「這個字串不得出現在 stats.html」，
 * 結果被我自己的註解（「舊版寫死『未回覆參加？』——那句話已知不成立」）打紅。
 * 那種判準最糟的形態是**永遠響的紅燈**：執行者學會無視那一格，比沒有判準更糟。
 * ⇒ 掃註解以外的碼，並且附一個零點對照證明它還響得起來。
 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

test('🔴★寫死的「未回覆參加？」不可以再出現在 stats.html 的碼裡——那句話已知不成立', () => {
  assert.equal(codeOnly(STATS).indexOf('未回覆參加？'), -1,
    '真正的原因就在 payload 裡，寫死一句猜測會把排查導向錯的方向');
});

test('對照組：上面那條判準響得起來（否則它只是一格恆綠的裝飾）', () => {
  const withIt = codeOnly(STATS + "\nsetMsg('sm-msg','找不到此人的報到碼（未回覆參加？）','err');\n");
  assert.ok(withIt.indexOf('未回覆參加？') >= 0, 'codeOnly 把碼也濾掉了＝那條判準永遠不會紅');
  const onlyComment = codeOnly("// 舊版寫死「未回覆參加？」，已移除\nvar a = 1;\n");
  assert.equal(onlyComment.indexOf('未回覆參加？'), -1, '註解沒被濾掉＝那條判準會永遠紅');
});

test('★payload 沒講原因時，說「沒有列出原因」，不可以自己編一個', async () => {
  const t = await runShowPerson('JDC-WXYZBC', '戊');   // 這個碼不在任何一份清單裡
  assert.match(t, /沒有列出原因/, '實際：' + t);
});

test('🔴★pfWhy 只認內部碼，不用姓名比對——同名的人會拿到別人的理由', () => {
  const { pfWhy } = require('../assets/partial-failure.js');
  const res = { unsigned: [{ name: '李明', unit: 'A部', internalId: 'JDC-JKMNPQ', why: '名冊為離職' }] };
  assert.equal(pfWhy(res, 'JDC-BCDFGH'), null, '碼不同卻回了理由＝姓名 fallback 又長回來了');
  assert.equal(pfWhy(res, ''), null, '空碼不可以命中任何人');
  assert.equal(pfWhy(res, 'JDC-JKMNPQ'), '名冊為離職');
});

/* ── 對照組：證明這條斷言抓得到「單邊漂移」 ─────────────────────────────── */

test('對照組：只讓 pfWhy 漂掉（回 null），承辦端那半要紅', async () => {
  // 只證明「現在兩邊一致」不夠——要證明這條斷言在其中一邊變了的時候會響。
  const kill = (s) => s.replace('  if (hit && hit.why) return hit.why;', '  if (hit && hit.why) return null;');
  const stats = await runShowPerson('JDC-JKMNPQ', '丙', (s) => {
    const out = kill(s);
    assert.notEqual(out, s, '這個對照組的替換沒套上，它什麼都沒證明');
    return out;
  });
  assert.doesNotMatch(stats, /名冊查無此碼/, '把 pfWhy 弄壞了畫面卻沒變＝上面那條沒在讀它');
});

test('對照組：只讓 pfPeople 漂掉（回空陣列），掃描站那半要紅', () => {
  const kill = (s) => s.replace('  return a.concat(b);', '  return [];');
  const staff = runRenderSkipped({ unusable: 2, skippedPeople: PAYLOAD.unsigned }, (s) => {
    const out = kill(s);
    assert.notEqual(out, s, '這個對照組的替換沒套上，它什麼都沒證明');
    return out;
  });
  assert.equal(staff, '', '把 pfPeople 弄壞了展開區卻還在＝那塊不是從共用模組來的');
});

test('對照組：0 人時兩邊都一個字都不多——天天出現的告警會被訓練成無視', () => {
  const clean = { ok: true, total: 1, rows: PAYLOAD.rows, unsigned: [], duplicated: [] };
  assert.equal(runRenderSkipped(clean), '');
  const { pfText } = require('../assets/partial-failure.js');
  assert.equal(pfText(clean), '');
});

test('🔴★展開區抬頭的人數＝具名人數＋未分類人數（兩者不可以各自算）', () => {
  // 🔴 為何是不變量而不是「等於 3」：抬頭與清單是**同一份資料的兩種呈現**，
  // 各自算就會漂開——現場會看到「⚠ 2 人掃不進去」而清單列了 3 個人，
  // 而那種畫面會讓人以為自己看錯，不會讓人去查。
  // 實測：把抬頭的 `people.length + gap` 改成 `people.length`，原本那條斷言全綠。
  // ⚠️ 不是「抬頭＝<li> 筆數」——那條我寫錯過：清單裡「另有 3 人」**一行代表 3 個人**。
  //    正確的不變量是「**抬頭的人數 ＝ 具名的人數 ＋ 那一行自己宣稱的人數**」。
  const res = { unusable: 5, skippedPeople: PAYLOAD.unsigned, unclassified: 3 };
  const html = runRenderSkipped(res);
  const head = html.match(/⚠ (\d+) 人掃不進去/);
  assert.ok(head, '抬頭抓不到人數，這條判準沒跑到。實際：' + html);
  const gapLine = html.match(/另有 (\d+) 人/);
  const gapN = gapLine ? Number(gapLine[1]) : 0;
  const named = (html.match(/<li>/g) || []).length - (gapLine ? 1 : 0);
  assert.equal(Number(head[1]), named + gapN,
    '抬頭說 ' + head[1] + ' 人，而清單交代得出來的是具名 ' + named + ' ＋ 未分類 ' + gapN
    + '——兩邊各自算就會這樣漂開，而現場只會覺得自己看錯。實際產出：' + html);
});

test('★清單比權威數字少人時要講出來（unclassified＞0）', () => {
  // 減法得到的數字是權威的，列舉出來的清單可能漏一整類。
  // 不講的話，操作者會把這份清單讀成完整的。
  const res = { unusable: 5, skippedPeople: PAYLOAD.unsigned, unclassified: 3 };
  const html = runRenderSkipped(res);
  assert.match(html, /另有 3 人/, '實際：' + html);
  assert.match(html, /比實際少人/);
});
