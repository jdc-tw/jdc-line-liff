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
const { checkPayload, scanNames, walkCounts } = require('../tools/hr-stats-guard.js');

const 快照時間 = '2026-09-09T22:10:00.000Z';

/**
 * 一份形狀正確、已剝名的回應。想測某一格就改那一格。
 *
 * 🔴 **這份刻意「沒有 pub」**——入口層 `/v1/workforce/composition` 不產這個欄位。
 *    夾具寫成入口層真正會回的樣子，`pub` 由 guard 蓋；夾具裡先放一個 `pub: true`
 *    的話，「guard 有沒有蓋」與「夾具本來就帶著」會長得一模一樣，這一維就零鑑別力。
 */
function 好回應(over) {
  const base = {
    ok: true,
    // 入口層一定會給（`server.js:273` 的 `generatedAt: asOf`）。這裡刻意放一個**舊**時間，
    // 才驗得出「原樣保留」而不是「被換成現在」。
    generatedAt: 快照時間,
    // `adapter.js:105/:132` 產的計數，全部是整數。它不經投影守門、原樣進公開 repo。
    counts: { sourceRows: 60, included: 50, excluded: { 離職: 8, 未驗證: 1 }, invalid: 1 },
    stats: {
      total: 50, unitOrder: ['總務部'],
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
  assert.equal(r.countsChecked, 5, 'counts 檢查過的葉節點數不對 ⇒ 走訪器本身壞了');
  // ⬛ 這一條同時是「蓋章那行的位置」的哨兵：把 `s.pub = …` 搬到 scanNames 之前，
  //    `scan` 還不存在 ⇒ 這裡當場紅。字面 `true` 搬上去則不會紅，所以那行不能寫字面。
  assert.equal(r.value.stats.pub, true, 'guard 沒有蓋 pub ⇒ 前端會以為這是含姓名的 gated 版');
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
  // ⚠️ 各單位人數要一起歸零。只改 total 的話，真正攔下它的是後面那道「加總對不上」——
  //    而它的訊息剛好也含「total」⇒ 這條會**因為別的原因而綠**，`!s.total` 那道拿掉也照樣過。
  //    （2026-09-10 突變測試挖出來的既有假通過。比對訊息也一起收緊。）
  assert.throws(() => checkPayload(好回應((b) => {
    b.stats.total = 0; b.stats.units.總務部.count = 0; return b;
  })), /total 是 0 或缺/);
});

// ─────────── 🔴 pub：從「上游宣告」改成「下游檢查推導出的結論」 ───────────

test('🔴 pub 不是無條件蓋章：姓名檢查沒通過時，一個 pub 都出不去', () => {
  // 三種通不過的樣子，逐一確認 guard 拋而不是蓋章放行。
  const 有姓名 = 好回應((b) => { b.stats.units.總務部.retire.y1 = ['甲']; return b; });
  const 掃零格 = 好回應((b) => { b.stats.units.總務部.retire = {}; return b; });
  const 沒units = 好回應((b) => { delete b.stats.units; return b; });
  // ⚠️ 這裡逐條比對**訊息**，不是只斷言「有拋」。只斷言有拋的話，把蓋章那行搬到
  //    姓名檢查之前（`scan` 還不存在 ⇒ TypeError）也算通過——這條就變成恆綠。
  [[有姓名, /姓名外洩/], [掃零格, /沒有鑑別力/], [沒units, /缺 units/]].forEach(([p, re]) => {
    assert.throws(() => checkPayload(p), re,
      '這份該被擋下來，卻走到了會蓋 pub 的那一行 ⇒ 蓋章變成無條件的');
  });
});

test('🔴 上游自己送 pub:true 也救不了一份含姓名的回應（不採信宣告）', () => {
  // 舊版守門對這一份是綠的：它只看旗子在不在，而旗子在。
  assert.throws(() => checkPayload(好回應((b) => {
    b.stats.pub = true;                              // 上游宣告「我是公開版」
    b.stats.units.總務部.retire.y1 = ['甲'];          // 但它含姓名
    return b;
  })), /姓名外洩/, '採信了上游的宣告 ⇒ 這一格又變回空頭支票');
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

/**
 * 🔴 量「桶名清單」那一維之前，必須先幫舊版把 `pub` 補上。
 *
 * 為什麼：舊版的第一道就是 `!r.stats.pub`，而入口層根本不產 `pub` ⇒ 舊版對**每一份**
 * 真實回應都拋「缺 pub」。不補的話，受測項與對照組會因為**同一個無關原因**一起被擋，
 * 那一輪什麼都沒測到——而且拿到的是「兩邊都拋」這種看起來很合理的結果。
 */
function 加上pub(payload) {
  const o = JSON.parse(payload); o.stats.pub = true; return JSON.stringify(o);
}

test('⬛ 對照組的前提：舊版對真實入口層回應（沒有 pub）全拒——這就是換掉它的理由', () => {
  assert.throws(() => 舊版判準(好回應()), /缺 pub/,
    '舊版居然放行了沒有 pub 的回應 ⇒ 我對舊版判準的抄寫錯了，下面整組對照都不算數');
  assert.doesNotThrow(() => checkPayload(好回應()), '新版擋掉了入口層的正常回應');
});

test('⬛ 對照組：舊版判準對「已知該擋的四種」是綠的——差異恰好是這四種，不是我把門收緊了', () => {
  const 空桶 = 加上pub(好回應((b) => { b.stats.units.總務部.retire = {}; return b; }));
  const 第六桶 = 加上pub(好回應((b) => { b.stats.units.總務部.retire.y20 = ['乙']; return b; }));
  const 空單位 = 加上pub(好回應((b) => { b.stats.units = {}; return b; }));
  const 加總不符 = 加上pub(好回應((b) => { b.stats.units.總務部.count = 3; return b; }));
  const counts髒 = 加上pub(好回應((b) => { b.counts.備註 = '甲的離職原因'; return b; }));

  // 舊版：五種都放行 ⇒ 它們今天真的進得了公開 repo
  assert.equal(舊版判準(空桶), true, '前提不成立：舊版本來就擋得住空桶，那這次沒修到東西');
  assert.equal(舊版判準(第六桶), true, '前提不成立：舊版本來就擋得住第六個桶');
  assert.equal(舊版判準(空單位), true, '前提不成立：舊版本來就擋得住空 units');
  assert.equal(舊版判準(加總不符), true, '前提不成立：舊版本來就擋得住加總不符');
  assert.equal(舊版判準(counts髒), true, '前提不成立：舊版本來就看 counts');

  // 新版：五種全擋
  [空桶, 第六桶, 空單位, 加總不符, counts髒].forEach((p) => assert.throws(() => checkPayload(p)));

  // 舊版對「已知該放行的」也是綠的 ⇒ 新舊的差集恰好是上面五種，我沒有順手收緊別的
  assert.equal(舊版判準(加上pub(好回應())), true);
  assert.doesNotThrow(() => checkPayload(好回應()), '新版把本來該過的擋掉了＝放寬的反面，一樣是錯');
});

// ─────────── 🔴 counts：不經投影守門，原樣進公開 repo ───────────

test('🔴 counts 裡出現非數字葉節點 → 拋', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.counts.備註 = '不是計數'; return b; })),
    /counts 裡有葉節點不是有限數字/);
});

test('🔴 巢狀深處的非數字也要抓到（不是只看第一層）', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.counts.excluded.明細 = ['甲']; return b; })),
    /counts 裡有葉節點不是有限數字/);
});

test('🔴 錯誤訊息不可以印出鍵名或內容（它會進 PUBLIC repo 的 Actions log）', () => {
  // 這條檢查要擋的正是「不該公開的東西被塞進 counts」——把它印出來就等於發布了它。
  let msg = '';
  try { checkPayload(好回應((b) => { b.counts.離職原因 = '甲：家庭因素'; return b; })); }
  catch (e) { msg = e.message; }
  assert.ok(msg, '前提不成立：這份沒有被擋下來，下面兩條就沒在測東西');
  assert.ok(msg.indexOf('離職原因') < 0, '訊息印出了鍵名');
  assert.ok(msg.indexOf('家庭因素') < 0, '訊息印出了內容');
  assert.ok(msg.indexOf('string') >= 0, '訊息連型別都沒給 ⇒ 收到的人無從下手');
});

test('🔴 counts 是空物件 → 拋（檢查 0 個葉節點＝零鑑別力，不是「很乾淨」）', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.counts = {}; return b; })), /沒有鑑別力/);
});

test('🔴 缺 counts → 拋（形狀漂掉時停下來，不靜默放行）', () => {
  assert.throws(() => checkPayload(好回應((b) => { delete b.counts; return b; })), /缺 counts/);
});

test('🔴 counts 是陣列 → 拋（陣列不是計數物件）', () => {
  assert.throws(() => checkPayload(好回應((b) => { b.counts = [1, 2]; return b; })), /缺 counts/);
});

test('🔴 不吃欄位白名單：新增一個合法的計數欄位照樣放行', () => {
  // 白名單寫法會在這裡紅。形狀斷言不會——這正是選形狀斷言的理由。
  assert.doesNotThrow(() => checkPayload(好回應((b) => { b.counts.新欄位 = 7; return b; })));
});

test('walkCounts：只認有限數字，NaN／Infinity／null／陣列／字串全算壞的', () => {
  assert.deepEqual(walkCounts({ a: 1, b: { c: 2 } }), { checked: 2, badTypes: [] });
  assert.deepEqual(walkCounts({ a: 'x' }), { checked: 1, badTypes: ['string'] });
  assert.deepEqual(walkCounts({ a: null }), { checked: 1, badTypes: ['null'] });
  assert.deepEqual(walkCounts({ a: [1] }), { checked: 1, badTypes: ['array'] });
  assert.deepEqual(walkCounts({ a: NaN }), { checked: 1, badTypes: ['number'] });
  assert.deepEqual(walkCounts({ a: Infinity }), { checked: 1, badTypes: ['number'] });
  assert.deepEqual(walkCounts({}), { checked: 0, badTypes: [] });
});

test('scanNames：只數 retire 底下的陣列元素，形狀怪的不當成 0 也不當成有', () => {
  assert.deepEqual(scanNames({ A: { retire: { x: ['', '甲'] } } }), { scanned: 2, leaked: 1 });
  assert.deepEqual(scanNames({ A: { retire: null } }), { scanned: 0, leaked: 0 });
  assert.deepEqual(scanNames({ A: { retire: { x: '不是陣列' } } }), { scanned: 0, leaked: 0 });
  assert.deepEqual(scanNames(undefined), { scanned: 0, leaked: 0 });
});
