const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../assets/messages-search.js');
const V = require('../assets/messages-view.js');

const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];

function row(o) {
  const d = {
    發送時間: '2026-08-21 09:12:00', 平台: 'line-platform', 來源: 'senior_notice',
    對象UserID: 'U1', 對象姓名: '陳志明', 對象單位: '管理部',
    訊息型別: 'text', 訊息內容: '恭喜服務滿 10 年', 附件: '',
    結果: '成功', 錯誤: '', 批次: 'line-platform-20260821091200',
  };
  Object.assign(d, o);
  return H.map((k) => d[k]);
}

/** 五筆涵蓋不同分類、日期、人數的假資料。 */
const ROWS = [
  row({ 批次: 'b1', 發送時間: '2026-08-21 09:12:00', 來源: 'senior_notice',
        訊息內容: '2026 年資深員工表揚通知 — 服務滿 10 年', 對象姓名: '陳志明' }),
  row({ 批次: 'b2', 發送時間: '2026-08-20 06:42:00', 來源: 'bind_success',
        訊息內容: '綁定成功，往後的通知都會發到這裡', 對象姓名: '林淑芬', 對象單位: '工務組' }),
  row({ 批次: 'b3', 發送時間: '2026-08-19 17:30:00', 來源: 'pass_broadcast',
        訊息內容: '8/28 秋季家庭日 — 報到碼與現場動線', 對象姓名: '黃建宏', 對象單位: '企劃部' }),
  row({ 批次: 'b4', 發送時間: '2026-07-11 14:48:00', 來源: 'checkin_done',
        訊息內容: '報到完成，感謝參加', 對象姓名: '張雅婷', 對象單位: '安衛室' }),
  row({ 批次: 'b5', 發送時間: '2026-06-15 16:20:00', 來源: 'refill_auto',
        訊息內容: '系統已自動為你補登，無須再操作', 對象姓名: '李俊傑',
        結果: '失敗', 錯誤: '400 Invalid to' }),
];
const BATCHES = V.groupBatches(H, ROWS);
const INDEX = S.buildIndex(BATCHES);
const ids = (r) => r.list.map((b) => b.batchId);

/* ── 基本行為 ────────────────────────────────────────── */

test('空字串回全部，且標記 all（呼叫端靠它決定要不要分月）', () => {
  const r = S.search(INDEX, '');
  assert.equal(r.list.length, 5);
  assert.equal(r.all, true);
});

test('只有空白也算空字串', () => {
  assert.equal(S.search(INDEX, '   ').all, true);
});

test('查無資料回空陣列，不是 null', () => {
  const r = S.search(INDEX, 'zzzzzzz');
  assert.deepEqual(r.list, []);
  assert.equal(r.all, false);
});

/* ── 前綴 ────────────────────────────────────────────── */

test('前綴：打「資深」就中「資深員工通知」，不必打完', () => {
  assert.deepEqual(ids(S.search(INDEX, '資深')), ['b1']);
});

test('前綴：英文也一樣，打 line- 中批次號', () => {
  assert.equal(S.search(INDEX, 'line-platform').list.length, 5);
});

/* ── 中文與姓名 ──────────────────────────────────────── */

test('中文姓名搜得到，單姓也算', () => {
  assert.deepEqual(ids(S.search(INDEX, '陳志明')), ['b1']);
  assert.deepEqual(ids(S.search(INDEX, '陳')), ['b1']);
});

test('單位搜得到', () => {
  assert.deepEqual(ids(S.search(INDEX, '工務組')), ['b2']);
});

test('錯誤訊息搜得到——回查失敗原因是這頁的主要用途之一', () => {
  assert.deepEqual(ids(S.search(INDEX, 'Invalid')), ['b5']);
});

test('狀態字搜得到：打「失敗」只出失敗那批', () => {
  assert.deepEqual(ids(S.search(INDEX, '失敗')), ['b5']);
});

/* ── 日期 ────────────────────────────────────────────── */

test('日期：完整、年月、月日、時刻都要中', () => {
  assert.deepEqual(ids(S.search(INDEX, '2026-08-19')), ['b3']);
  assert.deepEqual(ids(S.search(INDEX, '08-19')), ['b3']);
  assert.equal(S.search(INDEX, '2026-08').list.length, 3);
  assert.deepEqual(ids(S.search(INDEX, '17:30')), ['b3']);
});

/* ── 數字：不做錯字容忍 ──────────────────────────────── */

test('純數字不套錯字容忍——137 和 17 是不同的數，不是打錯', () => {
  const rows = [];
  for (let i = 0; i < 137; i++) rows.push(row({ 批次: 'big', 對象姓名: 'N' + i }));
  for (let i = 0; i < 17; i++) rows.push(row({ 批次: 'small', 對象姓名: 'M' + i }));
  const idx = S.buildIndex(V.groupBatches(H, rows));
  const r = S.search(idx, '137');
  assert.deepEqual(r.list.map((b) => b.batchId), ['big']);
  assert.equal(r.fuzzy, false, '數字命中不應該被標成模糊');
});

test('對照組：同一份資料用英文錯字，確實會走模糊路徑', () => {
  // 反證上一條不是因為「模糊功能整個壞掉」才回 false
  const r = S.search(INDEX, 'platfrom');   // platform 打錯
  assert.ok(r.list.length > 0, '錯字應該還是找得到');
  assert.equal(r.fuzzy, true);
});

/* ── 錯字容忍 ────────────────────────────────────────── */

test('錯字容忍：中文不套用——同音字打錯用編輯距離只會製造假命中', () => {
  // 「陣」與「陳」編輯距離 1，但語意無關；不該中
  assert.deepEqual(S.search(INDEX, '陣志明').list, []);
});

test('錯字容忍：太短的英文 token 不套用，避免 3 個字母亂中', () => {
  assert.equal(S.scoreField('ab', 'xyz'), 0);
});

test('錯字命中會扣分，拼對的一定排在拼錯的前面', () => {
  const exact = S.scoreField('platform', 'platform');
  const fuzzy = S.scoreField('platfrom', 'platform');
  assert.ok(exact > fuzzy);
});

/* ── 多詞 AND ────────────────────────────────────────── */

test('多個詞是 AND：兩個都中才算', () => {
  assert.deepEqual(ids(S.search(INDEX, '報到 家庭日')), ['b3']);
});

test('多個詞 AND：分屬不同批次的兩個詞 → 0 筆', () => {
  assert.deepEqual(S.search(INDEX, '資深 家庭日').list, []);
});

/* ── 相關性排序 ──────────────────────────────────────── */

test('主旨命中排在批次號命中前面（欄位有輕重）', () => {
  const rows = [
    row({ 批次: 'subject-hit', 訊息內容: '秋季家庭日通知', 對象姓名: 'A' }),
    row({ 批次: '家庭日-20260819', 訊息內容: '一般通知', 對象姓名: 'B' }),
  ];
  const idx = S.buildIndex(V.groupBatches(H, rows));
  const r = S.search(idx, '家庭日');
  assert.equal(r.list.length, 2);
  assert.equal(r.list[0].batchId, 'subject-hit');
});

test('同分時新的排在上面', () => {
  const rows = [
    row({ 批次: 'old', 發送時間: '2026-08-01 09:00:00', 訊息內容: '一樣的字' }),
    row({ 批次: 'new', 發送時間: '2026-08-21 09:00:00', 訊息內容: '一樣的字' }),
  ];
  const idx = S.buildIndex(V.groupBatches(H, rows));
  assert.deepEqual(S.search(idx, '一樣的字').list.map((b) => b.batchId), ['new', 'old']);
});

/* ── 工具函式 ────────────────────────────────────────── */

test('norm：全形轉半形、大小寫統一（NFKC）', () => {
  assert.equal(S.norm('ＡＢＣ１２３'), 'abc123');
});

test('tokenize：多重空白不會產生空 token', () => {
  assert.deepEqual(S.tokenize('  a   b  '), ['a', 'b']);
});

test('editDist：超過上限提早放棄，回傳值大於上限即可', () => {
  assert.equal(S.editDist('abc', 'abc', 1), 0);
    assert.equal(S.editDist('abc', 'abd', 1), 1);
  assert.ok(S.editDist('abc', 'xyz', 1) > 1);
});

test('hasCJK：中文 true、純英數 false', () => {
  assert.equal(S.hasCJK('陳'), true);
  assert.equal(S.hasCJK('abc123'), false);
});

test('indexBatch：整份資料都進得來，含人數與則數這種數字', () => {
  const ix = S.indexBatch(BATCHES[0]);
  assert.ok(ix.subject.length > 0);
  assert.ok(ix.name.length > 0);
  assert.ok(ix.num.indexOf('1') >= 0, '一人一則的批次，人數 1 要在索引裡');
});

/* ── 12 欄全覆蓋 ─────────────────────────────────────────
   使用者要的是「搜尋範圍遍佈全部的文字、數字」。
   2026-08-22 第一版漏了平台／UserID／附件／完整內文四項，是測試抓到的。
   這一組就是守著那個回歸——每一欄各給一條，漏一欄就紅。 */

const FULL = V.groupBatches(H, [row({
  批次: 'line-platform-20260821091200-2026-10',
  平台: 'line-platform',
  來源: 'senior_notice',
  對象UserID: 'Uabcdef0123456789',
  對象姓名: '陳志明',
  對象單位: '管理部',
  訊息型別: 'text+image',
  訊息內容: '恭喜你服務屆滿十年。' + '前置贅字'.repeat(20) + '關鍵字在很後面：紀念品領取地點在三樓',
  附件: 'https://example.com/photo-abc.jpg',
  結果: '失敗',
  錯誤: '400 Invalid to',
})]);
const FULL_IX = S.buildIndex(FULL);
const hit = (q) => S.search(FULL_IX, q).list.length;

test('12 欄全覆蓋：平台', () => { assert.equal(hit('line-platform'), 1); });
test('12 欄全覆蓋：來源代號與中文分類', () => {
  assert.equal(hit('senior_notice'), 1);
  assert.equal(hit('資深員工通知'), 1);
});
test('12 欄全覆蓋：對象UserID', () => { assert.equal(hit('Uabcdef0123456789'), 1); });
test('12 欄全覆蓋：對象姓名', () => { assert.equal(hit('陳志明'), 1); });
test('12 欄全覆蓋：對象單位', () => { assert.equal(hit('管理部'), 1); });
test('12 欄全覆蓋：訊息型別', () => { assert.equal(hit('image'), 1); });
test('12 欄全覆蓋：附件網址', () => { assert.equal(hit('photo-abc.jpg'), 1); });
test('12 欄全覆蓋：結果', () => { assert.equal(hit('失敗'), 1); });
test('12 欄全覆蓋：錯誤', () => { assert.equal(hit('Invalid'), 1); });
test('12 欄全覆蓋：批次號', () => { assert.equal(hit('20260821091200'), 1); });
test('12 欄全覆蓋：發送時間', () => { assert.equal(hit('08-21'), 1); });

test('12 欄全覆蓋：訊息內容要收完整的，不是只收畫面上那 60 字的主旨', () => {
  // 這個詞落在第 60 字之後，只索引主旨的話一定搜不到
  assert.equal(FULL[0].subject.indexOf('紀念品'), -1, '前提：主旨確實截斷在那個詞之前');
  assert.equal(hit('紀念品'), 1);
});

test('12 欄全覆蓋：數字（人數／則數／成功失敗數）', () => {
  assert.equal(hit('2'), 1, '一人兩則，則數 2 要搜得到');
});
