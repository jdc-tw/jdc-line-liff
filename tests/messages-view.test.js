const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../assets/messages-view.js');

/** hub 的紀錄表欄序（jdc-line-hub/hub/gateway.js 的 LOG_HEADER，逐字對過）。 */
const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];

/** @param {object} o 只寫要改的欄位，其餘給合理預設 */
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

/* ── esc ─────────────────────────────────────────────── */

test('esc：四個字元都換掉（比 stats-view 嚴格是刻意的）', () => {
  assert.equal(V.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('esc：null / undefined 回空字串，不會印出 "null"', () => {
  assert.equal(V.esc(null), '');
  assert.equal(V.esc(undefined), '');
});

/* ── statusOf：三態不是兩態 ─────────────────────────────
   改版前這頁寫的是「不等於成功就算失敗」，把略過畫成了失敗。
   這幾條就是守著那個回歸。 */

test('statusOf：成功／失敗／略過是三種，略過不可以算成失敗', () => {
  assert.equal(V.statusOf('成功'), 'ok');
  assert.equal(V.statusOf('失敗'), 'bad');
  assert.equal(V.statusOf(V.SKIP_RESULT), 'skip');
  assert.notEqual(V.statusOf(V.SKIP_RESULT), 'bad');
});

test('statusOf：略過用前綴比對，日後 hub 改後綴文字也不會突然變成失敗', () => {
  assert.equal(V.statusOf('略過（疑似重複）'), 'skip');
  assert.equal(V.statusOf('略過（其他理由）'), 'skip');
});

test('statusOf：空字串／未知值一律當失敗——不明狀態不可以偽裝成成功', () => {
  assert.equal(V.statusOf(''), 'bad');
  assert.equal(V.statusOf(null), 'bad');
  assert.equal(V.statusOf('???'), 'bad');
});

test('一批裡三種狀態並存時，tally 三個數字要分得開', () => {
  const b = V.groupBatches(H, [
    row({ 對象姓名: 'A' }),
    row({ 對象姓名: 'B', 結果: '失敗', 錯誤: '400 Invalid to' }),
    row({ 對象姓名: 'C', 結果: V.SKIP_RESULT }),
  ])[0];
  assert.deepEqual(b.tally, { ok: 1, bad: 1, skip: 1 });
});

test('總燈：有失敗就紅；只有略過是灰；全成功才綠', () => {
  assert.equal(V.lampOf({ ok: 1, bad: 1, skip: 1 }), 'bad');
  assert.equal(V.lampOf({ ok: 2, bad: 0, skip: 1 }), 'skip');
  assert.equal(V.lampOf({ ok: 3, bad: 0, skip: 0 }), 'ok');
});

/* ── subjectOf ───────────────────────────────────────── */

test('subjectOf：紀錄表沒有主旨欄，取訊息內容第一行', () => {
  assert.equal(V.subjectOf('第一行\n第二行\n第三行', 'text'), '第一行');
});

test('subjectOf：超過 60 字截斷並加省略號', () => {
  const long = '字'.repeat(80);
  const got = V.subjectOf(long, 'text');
  assert.equal(got.length, 61);
  assert.ok(got.endsWith('…'));
});

test('subjectOf：多則訊息被 hub 存成 JSON，顯示型別比顯示 JSON 有用', () => {
  assert.equal(V.subjectOf('[{"type":"text"},{"type":"image"}]', 'text+image'), '（text+image）');
  assert.equal(V.subjectOf('{"type":"flex"}', 'flex'), '（flex）');
});

test('subjectOf：空內容給明確字樣，不留白', () => {
  assert.equal(V.subjectOf('', 'text'), '（無內容）');
  assert.equal(V.subjectOf('   ', 'text'), '（無內容）');
});

/* ── 則數 ────────────────────────────────────────────── */

test('則數：一列可以是多則，用訊息型別的 + 拆開加總', () => {
  assert.equal(V.msgCountOf([{ kind: 'text' }, { kind: 'text' }]), 2);
  assert.equal(V.msgCountOf([{ kind: 'text+image' }, { kind: 'text+image' }]), 4);
  assert.equal(V.msgCountOf([{ kind: 'text+image+flex' }]), 3);
});

test('則數：型別缺漏時當一則，不可以是 0（0 會讓整批看起來沒發）', () => {
  assert.equal(V.msgCountOf([{ kind: '' }, {}]), 2);
});

/* ── groupBatches ────────────────────────────────────── */

test('groupBatches：同一批次聚成一張卡，不平鋪', () => {
  const out = V.groupBatches(H, [
    row({ 對象姓名: 'A' }), row({ 對象姓名: 'B' }), row({ 對象姓名: 'C' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].rows.length, 3);
});

test('groupBatches：最新的批次排在最前面', () => {
  const out = V.groupBatches(H, [
    row({ 發送時間: '2026-08-19 10:00:00', 批次: 'b1' }),
    row({ 發送時間: '2026-08-21 10:00:00', 批次: 'b3' }),
    row({ 發送時間: '2026-08-20 10:00:00', 批次: 'b2' }),
  ]);
  assert.deepEqual(out.map((b) => b.batchId), ['b3', 'b2', 'b1']);
});

test('groupBatches：沒有批次號的列不會互相吃掉，收進「(無批次)」', () => {
  const out = V.groupBatches(H, [row({ 批次: '' }), row({ 批次: '' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].batchId, '(無批次)');
});

test('groupBatches：對象姓名空的時候退回 UserID，不留白', () => {
  const b = V.groupBatches(H, [row({ 對象姓名: '', 對象UserID: 'Uxyz' })])[0];
  assert.equal(b.rows[0].name, 'Uxyz');
});

test('groupBatches：來源代號翻成中文；未申報的照原樣顯示不吞掉', () => {
  assert.equal(V.groupBatches(H, [row({ 來源: 'senior_notice' })])[0].categoryLabel, '資深員工通知');
  assert.equal(V.groupBatches(H, [row({ 來源: 'brand_new' })])[0].categoryLabel, 'brand_new');
  assert.equal(V.groupBatches(H, [row({ 來源: '' })])[0].categoryLabel, '（未申報）');
});

test('groupBatches：依欄名對位，欄序調動不會靜默錯位', () => {
  const shuffled = ['批次', '結果', '發送時間', '來源', '對象姓名', '訊息內容',
                    '訊息型別', '對象單位', '對象UserID', '平台', '附件', '錯誤'];
  const r = shuffled.map((k) => ({
    批次: 'bx', 結果: '成功', 發送時間: '2026-08-21 09:12:00', 來源: 'bind_success',
    對象姓名: '林淑芬', 訊息內容: '綁定成功', 訊息型別: 'text', 對象單位: '工務組',
    對象UserID: 'U9', 平台: 'line-platform', 附件: '', 錯誤: '',
  }[k]));
  const b = V.groupBatches(shuffled, [r])[0];
  assert.equal(b.categoryLabel, '綁定成功');
  assert.equal(b.rows[0].name, '林淑芬');
  assert.equal(b.subject, '綁定成功');
});

/* ── 月份分段與滑桿 ──────────────────────────────────── */

const twoMonths = V.groupBatches(H, [
  row({ 發送時間: '2026-08-21 09:00:00', 批次: 'a' }),
  row({ 發送時間: '2026-08-19 09:00:00', 批次: 'b' }),
  row({ 發送時間: '2026-07-30 09:00:00', 批次: 'c' }),
]);
const oneMonth = V.groupBatches(H, [
  row({ 發送時間: '2026-08-21 09:00:00', 批次: 'a' }),
  row({ 發送時間: '2026-08-20 09:00:00', 批次: 'b' }),
  row({ 發送時間: '2026-08-19 09:00:00', 批次: 'c' }),
]);

test('monthGroups：每個月一段，並累計該月共幾則', () => {
  const g = V.monthGroups(twoMonths);
  assert.deepEqual(g.map((x) => x.month), ['2026-08', '2026-07']);
  assert.equal(g[0].batches.length, 2);
  assert.equal(g[0].msgCount, 2);
});

test('滑桿：兩個月以上列「月」', () => {
  const spec = V.railTicks(twoMonths);
  assert.equal(spec.mode, 'month');
  assert.deepEqual(spec.ticks.map((t) => t.key), ['2026-08', '2026-07']);
  assert.deepEqual(spec.ticks.map((t) => t.short), ['08', '07']);
});

test('滑桿：未滿兩個月列「日」，而且只列真的有訊息的日', () => {
  const spec = V.railTicks(oneMonth);
  assert.equal(spec.mode, 'day');
  assert.deepEqual(spec.ticks.map((t) => t.key), ['2026-08-21', '2026-08-20', '2026-08-19']);
  // 8/18、8/17… 沒有資料，就不該冒出來
  assert.equal(spec.ticks.length, 3);
});

test('滑桿：同一天多批只算一格，但批數與則數要累加', () => {
  const sameDay = V.groupBatches(H, [
    row({ 發送時間: '2026-08-21 09:00:00', 批次: 'a', 訊息型別: 'text+image' }),
    row({ 發送時間: '2026-08-21 15:00:00', 批次: 'b' }),
  ]);
  const spec = V.railTicks(sameDay);
  assert.equal(spec.ticks.length, 1);
  assert.equal(spec.ticks[0].n, 2);
  assert.equal(spec.ticks[0].msgs, 3);   // 2 + 1
});

test('滑桿：完全沒資料時不炸，回空清單', () => {
  assert.deepEqual(V.railTicks([]).ticks, []);
  assert.deepEqual(V.railTicks(null).ticks, []);
});

/* ── sinceWarning ────────────────────────────────────── */

test('sinceWarning：有設起始日就完全不顯示（使用者說「看就知道了」）', () => {
  assert.equal(V.sinceWarning('2026-08-19'), '');
});

test('sinceWarning：沒設起始日要出警告——留白會讓「還沒開始記」看起來像「沒發過」', () => {
  const w = V.sinceWarning('');
  assert.ok(w.length > 0);
  assert.ok(w.indexOf('未設定') >= 0);
});

/* ── highlight ───────────────────────────────────────── */

test('highlight：先逸出再標記，惡意內容不會變成標籤', () => {
  const got = V.highlight('<img src=x onerror=alert(1)>', ['img']);
  assert.ok(got.indexOf('<img') < 0);
  assert.ok(got.indexOf('&lt;<mark>img</mark>') >= 0);
});

test('highlight：沒有 token 就原樣逸出，不加任何 mark', () => {
  assert.equal(V.highlight('a<b', []), 'a&lt;b');
  assert.equal(V.highlight('a<b', null), 'a&lt;b');
});

test('highlight：token 不會標到標籤名稱裡（mark 這個字本身）', () => {
  const got = V.highlight('mark 這個字', ['mark']);
  assert.equal(got.split('<mark>').length - 1, 1);   // 只標一次，不會標到自己產生的標籤
});

test('highlight：大小寫不敏感', () => {
  assert.ok(V.highlight('Platform', ['platform']).indexOf('<mark>Platform</mark>') >= 0);
});

/* ── listHtml ────────────────────────────────────────── */

test('listHtml：照月分段時，每段標頭有「N 批　共 M 則」', () => {
  const html = V.listHtml(twoMonths, [], true);
  assert.ok(html.indexOf('id="m-2026-08"') >= 0);
  assert.ok(html.indexOf('2 批　共 2 則') >= 0);
});

test('listHtml：每天第一張卡有 d- 錨點，同一天第二張沒有', () => {
  const sameDay = V.groupBatches(H, [
    row({ 發送時間: '2026-08-21 09:00:00', 批次: 'a' }),
    row({ 發送時間: '2026-08-21 15:00:00', 批次: 'b' }),
    row({ 發送時間: '2026-08-20 09:00:00', 批次: 'c' }),
  ]);
  const html = V.listHtml(sameDay, [], true);
  assert.equal(html.split('id="d-2026-08-21"').length - 1, 1);
  assert.equal(html.split('id="d-2026-08-20"').length - 1, 1);
});

test('listHtml：搜尋結果不分段（分月會打散相關性排序）', () => {
  const html = V.listHtml(twoMonths, ['a'], false);
  assert.equal(html.indexOf('class="sec"'), -1);
});

test('listHtml：沒有結果時給明確字樣，不是空白', () => {
  assert.ok(V.listHtml([], [], true).indexOf('沒有符合的紀錄') >= 0);
});

test('cardHtml：24 則以內畫點，超過改畫比例條', () => {
  const small = V.groupBatches(H, Array.from({ length: 10 }, (_, i) => row({ 對象姓名: 'N' + i })))[0];
  const big = V.groupBatches(H, Array.from({ length: 30 }, (_, i) => row({ 對象姓名: 'N' + i })))[0];
  assert.ok(V.stripHtml(small).indexOf('class="dot') >= 0);
  assert.equal(V.stripHtml(small).indexOf('class="bar"'), -1);
  assert.ok(V.stripHtml(big).indexOf('class="bar"') >= 0);
});

test('cardHtml：分類代號會變成 class，讓 CSS 上得了色', () => {
  const b = V.groupBatches(H, [row({ 來源: 'pass_broadcast' })])[0];
  assert.ok(V.cardHtml(b, []).indexOf('class="tag pass_broadcast"') >= 0);
});

test('cardHtml：燈號 class 跟著三態走', () => {
  const skip = V.groupBatches(H, [row({ 結果: V.SKIP_RESULT })])[0];
  assert.ok(V.cardHtml(skip, []).indexOf('class="lamp skip"') >= 0);
});
