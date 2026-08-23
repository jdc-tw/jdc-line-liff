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

/* ── gistOf（卡面摘要）─────────────────────────────── */

test('gistOf：跳過稱呼行，取第一行真正有內容的字', () => {
  assert.equal(V.gistOf('林俊宏 您好：\n\n您 8/18 的補登申請已核准。', 'text'),
    '您 8/18 的補登申請已核准。');
});

test('gistOf：沒有稱呼行時就取第一行（不做多餘的判讀）', () => {
  assert.equal(V.gistOf('【系統維護通知】\n本週六停機', 'text'), '【系統維護通知】');
});

test('gistOf：整段都是稱呼行時保留最後一行，不留白', () => {
  // 留白會讓人以為這批沒有內容——寧可顯示「您好」
  assert.equal(V.gistOf('您好', 'text'), '您好');
  assert.equal(V.gistOf('林俊宏 您好：\n您好，', 'text'), '您好，');
});

test('gistOf：「含有您好」的正文不可以被當成稱呼行吃掉', () => {
  const body = '如有問題請洽工務管理組，我們會盡快回覆您好嗎';
  assert.ok(body.length <= 40, '前提：這句沒到 40 字上限，不會被截斷');
  assert.equal(V.gistOf('林俊宏 您好：\n' + body, 'text'), body);
});

test('gistOf：稱呼行的認定只看「開頭很短又以您好收尾」', () => {
  assert.equal(V.gistOf('您好\n真正的內容', 'text'), '真正的內容');
  assert.equal(V.gistOf('您好，\n真正的內容', 'text'), '真正的內容');
  assert.equal(V.gistOf('黃淑芬 您好\n真正的內容', 'text'), '真正的內容');
  // 開頭超過 12 字就不是稱呼，照原樣留著
  const long = '這一行很長而且結尾剛好也是您好';
  assert.equal(V.gistOf(long + '\n第二行', 'text'), long);
});

test('gistOf：多則訊息存成 JSON 時，把裡面的文字挖出來（不顯示型別也不顯示 JSON）', () => {
  const payload = JSON.stringify([
    { type: 'text', text: '林俊宏 您好：\n您今年服務屆滿 15 年。' },
    { type: 'image', originalContentUrl: 'https://x/a.jpg' },
  ]);
  assert.equal(V.gistOf(payload, 'text+image'), '您今年服務屆滿 15 年。');
});

test('gistOf：JSON 裡沒有文字（純圖、flex）就退回顯示型別', () => {
  assert.equal(V.gistOf('[{"type":"image"},{"type":"image"}]', 'image+image'), '（image+image）');
  assert.equal(V.gistOf('{"type":"flex","contents":{}}', 'flex'), '（flex）');
});

test('gistOf：JSON 壞掉（截斷）不可以爆掉，退回顯示型別', () => {
  assert.equal(V.gistOf('[{"type":"text","text":"被截斷了', 'text'), '（text）');
});

test('textInPayload：只認 type 為 text 且真的有 text 的那一則', () => {
  assert.equal(V.textInPayload('[{"type":"text","text":""},{"type":"text","text":"第二則"}]'), '第二則');
  assert.equal(V.textInPayload('[{"type":"image"}]'), null);
  assert.equal(V.textInPayload('不是 JSON'), null);
});

test('gistOf：空內容給明確字樣，不留白', () => {
  assert.equal(V.gistOf('', 'text'), '（無內容）');
  assert.equal(V.gistOf('   ', 'text'), '（無內容）');
});

test('gistOf：40 字上限是防呆，真正的截斷交給 CSS', () => {
  const long = '中' .repeat(60);
  const got = V.gistOf('您好：\n' + long, 'text');
  assert.equal(got.length, 41);
  assert.ok(got.endsWith('…'));
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
  assert.equal(b.gist, '綁定成功');
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

test('滑桿：兩個月以上停在「月」，不列到日', () => {
  const spec = V.railTicks(twoMonths);
  assert.equal(spec.mode, 'month');
  assert.deepEqual(spec.ticks.map((t) => t.level), ['year', 'month', 'month']);
  assert.deepEqual(spec.ticks.map((t) => t.label), ['2026', '08', '07']);
});

test('滑桿：未滿兩個月列到「日」，而且只列真的有訊息的日', () => {
  const spec = V.railTicks(oneMonth);
  assert.equal(spec.mode, 'day');
  assert.deepEqual(spec.ticks.map((t) => t.level), ['year', 'month', 'day', 'day', 'day']);
  assert.deepEqual(spec.ticks.map((t) => t.label), ['2026', '08', '21', '20', '19']);
  // 8/18、8/17… 沒有資料，就不該冒出來
  assert.equal(spec.ticks.filter((t) => t.level === 'day').length, 3);
});

test('滑桿：年只出現一次，不會每個月重複一條', () => {
  const spec = V.railTicks(twoMonths);
  assert.equal(spec.ticks.filter((t) => t.level === 'year').length, 1);
});

test('滑桿：跨年時每一年各一條', () => {
  const cross = V.groupBatches(H, [
    row({ 發送時間: '2026-01-05 09:00:00', 批次: 'a' }),
    row({ 發送時間: '2025-12-20 09:00:00', 批次: 'b' }),
  ]);
  const spec = V.railTicks(cross);
  assert.deepEqual(spec.ticks.map((t) => t.label), ['2026', '01', '2025', '12']);
});

test('滑桿：每一格都有捲動目標，年跳到該年最新的那個月', () => {
  const spec = V.railTicks(twoMonths);
  assert.deepEqual(spec.ticks.map((t) => t.anchor),
    ['m-2026-08', 'm-2026-08', 'm-2026-07']);
});

test('滑桿：日模式的日跳到當天第一張卡的錨點', () => {
  const spec = V.railTicks(oneMonth);
  const days = spec.ticks.filter((t) => t.level === 'day');
  assert.deepEqual(days.map((t) => t.anchor),
    ['d-2026-08-21', 'd-2026-08-20', 'd-2026-08-19']);
});

test('滑桿：同一天多批只算一格', () => {
  const sameDay = V.groupBatches(H, [
    row({ 發送時間: '2026-08-21 09:00:00', 批次: 'a', 訊息型別: 'text+image' }),
    row({ 發送時間: '2026-08-21 15:00:00', 批次: 'b' }),
  ]);
  const spec = V.railTicks(sameDay);
  assert.equal(spec.ticks.filter((t) => t.level === 'day').length, 1);
});

test('滑桿：完全沒資料時不炸，回空清單', () => {
  assert.deepEqual(V.railTicks([]).ticks, []);
  assert.deepEqual(V.railTicks(null).ticks, []);
});

/* ── 分類代號 ────────────────────────────────────────── */

test('手動發送的兩個代號翻成中文，不留英文代號在畫面上', () => {
  assert.equal(V.groupBatches(H, [row({ 來源: 'hub_path_test' })])[0].categoryLabel, '測試');
  assert.equal(V.groupBatches(H, [row({ 來源: 'correction' })])[0].categoryLabel, '測試');
});

/* ── 全文 ────────────────────────────────────────────── */

test('fullMessageOf：取第一個人收到的完整內文，不是截斷的主旨', () => {
  const long = '開頭。' + '中段'.repeat(40) + '結尾在很後面。';
  const b = V.groupBatches(H, [row({ 訊息內容: long })])[0];
  assert.notEqual(b.gist, long, '前提：卡面摘要確實被截斷了');
  assert.equal(V.fullMessageOf(b), long);
});

test('fullMessageOf：沒有內容時給明確字樣', () => {
  const b = V.groupBatches(H, [row({ 訊息內容: '' })])[0];
  assert.equal(V.fullMessageOf(b), '（無內容）');
});

test('cardHtml：內容與名單合併成同一個下拉（2026-08-23）', () => {
  const long = '第一行\n第二行是全文才看得到的';
  const b = V.groupBatches(H, [
    row({ 訊息內容: long, 對象姓名: '林淑芬' }),
    row({ 訊息內容: long, 對象姓名: '陳建宏' }),
  ]);
  const html = V.cardHtml(b[0], []);
  // 只有一個 <details>——兩個代表主旨那顆沒拆乾淨
  assert.equal(html.split('<details').length - 1, 1);
  // 同一個下拉裡同時有全文與名單
  const inner = html.slice(html.indexOf('<details'));
  assert.ok(inner.indexOf('class="fullmsg"') >= 0);
  assert.ok(inner.indexOf('第二行是全文才看得到的') >= 0);
  assert.ok(inner.indexOf('林淑芬') >= 0 && inner.indexOf('陳建宏') >= 0);
});

test('cardHtml：卡面第三列是摘要，不是「○○您好」那一行', () => {
  const b = V.groupBatches(H, [row({ 訊息內容: '林先生您好\n真正的內容在第二行' })])[0];
  const html = V.cardHtml(b, []);
  // ⚠️ 不可以用 indexOf('class="gist"') 之後的整段來檢查——那一段還含著下拉裡的
  //    全文，而全文本來就有稱呼行，這條就永遠綠（同型假測試 8/23 已犯過一次）。
  const m = html.match(/<div class="gist">([\s\S]*?)<\/div>/);
  assert.ok(m, '卡面要有摘要那一列');
  assert.equal(m[1], '真正的內容在第二行');
});

test('cardHtml：單人批次照樣印「1 人 1 則」（2026-08-23 使用者否決隱藏）', () => {
  // 曾經改成單人不畫那一列，理由是兩個數字恆為 1。使用者當場否決：
  // 他問的是那一列在呈現什麼，不是要拿掉——問題出在卡面沒有內容摘要。
  const b = V.groupBatches(H, [row({ 對象姓名: '林淑芬' })])[0];
  const html = V.cardHtml(b, []);
  assert.ok(html.indexOf('1<u>人</u>') >= 0);
  assert.ok(html.indexOf('1<u>則</u>') >= 0);
});

test('cardHtml：多人批次印人數與則數', () => {
  const b = V.groupBatches(H, Array.from({ length: 137 }, (_, i) => row({ 對象姓名: 'N' + i })))[0];
  const html = V.cardHtml(b, []);
  assert.ok(html.indexOf('137<u>人</u>') >= 0);
  assert.ok(html.indexOf('137<u>則</u>') >= 0);
});

test('cardHtml：一人收到多則時，則數大於人數', () => {
  const b = V.groupBatches(H, [
    row({ 對象姓名: 'A', 訊息型別: 'text+image' }),
    row({ 對象姓名: 'B', 訊息型別: 'text+image' }),
  ])[0];
  const html = V.cardHtml(b, []);
  assert.ok(html.indexOf('2<u>人</u>') >= 0);
  assert.ok(html.indexOf('4<u>則</u>') >= 0);
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
