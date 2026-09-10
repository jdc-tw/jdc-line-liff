/**
 * hr-stats-pub.json 入庫守門的測試。
 *
 * 為何存在：這道守門是「姓名進 PUBLIC repo」這條鏈上**唯一的機械關卡**，
 * 而它原本寫在 workflow 的一行 `node -e` 裡——只能被審查、不能被測試。
 *
 * ⚠️ 測試資料一律用代號（甲乙丙丁），不寫同仁真實姓名。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { checkPayload, scanNames } = require('../tools/hr-stats-guard.js');

const 快照時間 = '2026-09-09T22:10:00.000Z';

/** 一份形狀正確、已剝名的回應。想測某一格就改那一格。 */
function 好回應(over) {
  const base = {
    ok: true,
    // 入口層一定會給（`server.js:273` 的 `generatedAt: asOf`）。這裡刻意放一個**舊**時間，
    // 才驗得出「原樣保留」而不是「被換成現在」。
    generatedAt: 快照時間,
    stats: {
      pub: true, total: 50, unitOrder: ['總務部'],
      units: { 總務部: { count: 50, retire: { now: [], y1: [''], y3: ['', ''], y5: [], y10: [''] } } }
    }
  };
  return JSON.stringify(over ? over(base) : base);
}

// ─────────── ⬛ 零點：這把尺不是恆拋 ───────────

test('⬛ 零點：形狀正確的回應會通過（沒有這條，下面每一條「會拋」都不算數）', () => {
  const r = checkPayload(好回應());
  assert.equal(r.value.ok, true);
  assert.equal(r.total, 50);
  assert.equal(r.scanned, 4, '掃過的格數不對 ⇒ 掃描器本身壞了');
});

test('🔴 generatedAt 原樣保留，不可以被換成「現在」', () => {
  // 語意是「快照建立時間」——快取命中時它就是舊的，那正是要被看見的東西。
  // 換成抓取時間的話，一份命中快取的舊快照會顯示成剛出爐的。
  const got = checkPayload(好回應()).value.generatedAt;
  assert.equal(got, 快照時間);
  assert.ok(Date.now() - Date.parse(got) > 3600000, '拿到的時間太新 ⇒ 很可能被覆蓋成現在');
});

test('🔴 缺 generatedAt → 拋（不可以用現在時間補）', () => {
  assert.throws(() => checkPayload(好回應((b) => { delete b.generatedAt; return b; })),
    /generatedAt/, '用現在時間補＝把「我不知道這份多舊」偽裝成「很新」');
});

test('🔴 generatedAt 格式不對 → 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.generatedAt = '昨天'; return b; })),
    /generatedAt/);
});

// ─────────── 被擋在門外 ───────────

test('🔴 回應不是 JSON（Cloud Run 擋門的 HTML 錯誤頁）→ 拋，且訊息要指向「被擋」', () => {
  assert.throws(() => checkPayload('<html><body>403 Forbidden</body></html>'),
    /不是 JSON/, '把 HTML 錯誤頁 parse 成資料，會寫一份垃圾進公開 repo');
});

// ─────────── 內容異常 ───────────

test('ok:false → 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.ok = false; return b; })), /內容異常/);
});

test('total 是 0 → 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.stats.total = 0; return b; })), /total/);
});

test('缺 pub 旗標（疑似 gated 版）→ 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => { delete b.stats.pub; return b; })), /pub 旗標/);
});

test('🔴 退休名單裡有姓名 → 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => {
    b.stats.units.總務部.retire.y1 = ['甲']; return b;
  })), /姓名外洩/);
});

// ─────────── 🔴 這兩條是這次新增的鑑別力 ───────────

test('🔴 retire 是空物件 → 拋（掃 0 格＝這次檢查沒有鑑別力，不是「很乾淨」）', () => {
  assert.throws(() => checkPayload(好回應((b) => {
    b.stats.units.總務部.retire = {}; return b;
  })), /沒有鑑別力/);
});

test('🔴 新增第六個桶且含姓名 → 拋（不吃寫死的桶名清單）', () => {
  assert.throws(() => checkPayload(好回應((b) => {
    b.stats.units.總務部.retire.y20 = ['乙']; return b;
  })), /姓名外洩/);
});

// ─────────── 🔴 形狀對但內容空 ───────────

test('🔴 total 正常但 units 是空的 → 拋（舊版放行，看板會畫一張全空的圖）', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.stats.units = {}; return b; })),
    /形狀對但內容空/);
});

test('🔴 各單位人數加總對不上 total → 拋（資料不自洽）', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.stats.units.總務部.count = 3; return b; })),
    /對不上 total/);
});

// ─────────── ⬛ 對照組：證明這是「修正」不是「放寬／收緊」 ───────────

/** 舊版守門的判準，逐字照抄 update-hr-stats.yml:31，用來量差異。 */
function 舊版判準(payload) {
  const r = JSON.parse(payload);
  if (!r.ok || !r.stats || !r.stats.total) throw new Error('內容異常');
  if (!r.stats.pub) throw new Error('缺 pub');
  const nm = [];
  Object.keys(r.stats.units).forEach(function (n) {
    const R = r.stats.units[n].retire;
    ['now', 'y1', 'y3', 'y5', 'y10'].forEach(function (k) {
      (R[k] || []).forEach(function (v) { if (v) nm.push(v); });
    });
  });
  if (nm.length) throw new Error('姓名外洩');
  return true;
}

test('⬛ 對照組：舊版判準對「已知該擋的兩種」是綠的——差異恰好是這兩種，不是我把門收緊了', () => {
  const 空桶 = 好回應((b) => { b.stats.units.總務部.retire = {}; return b; });
  const 第六桶 = 好回應((b) => { b.stats.units.總務部.retire.y20 = ['乙']; return b; });

  // 舊版：兩種都放行 ⇒ 它們今天真的進得了公開 repo
  const 空單位 = 好回應((b) => { b.stats.units = {}; return b; });
  const 加總不符 = 好回應((b) => { b.stats.units.總務部.count = 3; return b; });

  assert.equal(舊版判準(空桶), true, '前提不成立：舊版本來就擋得住空桶，那這次沒修到東西');
  assert.equal(舊版判準(第六桶), true, '前提不成立：舊版本來就擋得住第六個桶');
  assert.equal(舊版判準(空單位), true, '前提不成立：舊版本來就擋得住空 units');
  assert.equal(舊版判準(加總不符), true, '前提不成立：舊版本來就擋得住加總不符');

  // 舊版對「已知該放行的」也是綠的 ⇒ 新舊的差集恰好是上面兩種，我沒有順手收緊別的
  assert.equal(舊版判準(好回應()), true);
  assert.doesNotThrow(() => checkPayload(好回應()), '新版把本來該過的擋掉了＝放寬的反面，一樣是錯');
});

test('scanNames：只數 retire 底下的陣列元素，形狀怪的不當成 0 也不當成有', () => {
  assert.deepEqual(scanNames({ A: { retire: { x: ['', '甲'] } } }), { scanned: 2, leaked: 1 });
  assert.deepEqual(scanNames({ A: { retire: null } }), { scanned: 0, leaked: 0 });
  assert.deepEqual(scanNames({ A: { retire: { x: '不是陣列' } } }), { scanned: 0, leaked: 0 });
  assert.deepEqual(scanNames(undefined), { scanned: 0, leaked: 0 });
});
