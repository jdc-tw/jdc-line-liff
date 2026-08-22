// 來賓簽到表產檔的端到端驗證。
//
// 為何不只測純函式：buildSigninPages 只管「哪幾家、什麼順序」，版面（合併、列高、欄寬、
// 框線、灰字、列印頁首、分頁點）全在 stats.html 的 writeSigninXlsx_ 裡，而那一層正是
// 2026-08-07 排位用檔公式變文字、8/22 writer 不寫 headerFooter 這類問題的所在。
// 這支把 writeSigninXlsx_ 的**原始碼從 stats.html 抽出來**（不是另外抄一份等價的），
// 配 stub 跑真的產檔，再把 xlsx 解回 XML 斷言。抄一份就驗不到線上那份。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// 廠牌 xlsx-style 在 node 下會 require('./cpexcel.js')（瀏覽器不會走到）→ 給個空殼擋掉
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (/cpexcel\.js$/.test(req)) return {};
  return origLoad.call(this, req, parent, isMain);
};
const XLSX = require(path.join(ROOT, 'assets/xlsx-style.min.js'));
const JSZip = require(path.join(ROOT, 'assets/jszip.min.js'));
Module._load = origLoad;

const { buildSigninPages, SIGNIN_ROWS } = require(path.join(ROOT, 'assets/seating.js'));
const { pageSetupXml } = require(path.join(ROOT, 'assets/xlsx-post.js'));

/** 從 stats.html 抽出簽到表產檔那一段原始碼，用 stub 注入外部相依後取回函式本體。 */
function loadWriter() {
  const html = fs.readFileSync(path.join(ROOT, 'stats.html'), 'utf8');
  const a = html.indexOf('// ── 來賓簽到表');
  const b = html.indexOf("/** 「來賓名單」卡");
  assert.ok(a > 0 && b > a, '在 stats.html 找不到簽到表產檔區塊（標記被改動了？）');
  const src = html.slice(a, b);
  const captured = {};
  const make = new Function('XLSX', 'JSZip', 'SIGNIN_ROWS', 'pageSetupXml',
    '__tmLib', '__rdlToday', '__dlXlsxBlob',
    src + '\nreturn writeSigninXlsx_;');
  const fn = make(XLSX, JSZip, SIGNIN_ROWS, pageSetupXml,
    () => Promise.resolve(), () => '2026/08/22',
    (buf, name) => { captured.buf = buf; captured.name = name; });
  return { fn, captured };
}

/** 跑一次產檔，回 {sheetXml, name, ws}。 */
async function produce(guests, actName) {
  const { fn, captured } = loadWriter();
  await fn(buildSigninPages(guests), actName);
  assert.ok(captured.buf, '沒有觸發下載');
  const zip = await JSZip.loadAsync(captured.buf);
  return {
    name: captured.name,
    sheetXml: await zip.file('xl/worksheets/sheet1.xml').async('string'),
    styleXml: await zip.file('xl/styles.xml').async('string'),
    ws: XLSX.read(captured.buf, { type: 'array' }).Sheets['簽到表'],
  };
}

/** `<xf ...>` / `<border ...>` / `<font ...>` 這種單一元素的清單切片。 */
function elems(xml, tag) {
  const inner = new RegExp('<' + tag + 's[^>]*>([\\s\\S]*?)</' + tag + 's>').exec(xml);
  if (!inner) return [];
  return [...inner[1].matchAll(new RegExp('<' + tag + '\\b(?:[^>]*/>|[\\s\\S]*?</' + tag + '>)', 'g'))]
    .map(m => m[0]);
}

/**
 * 直接查產出檔裡某一格的**實際**樣式：sheet XML 拿 s= 索引 → styles.xml 的 cellXfs → border/font。
 * 刻意不用 XLSX.read({cellStyles:true})——那是同一支 lib 自己讀自己寫的，
 * 寫錯讀錯會互相抵銷，等於沒驗（2026-08-15 教訓：綠燈不證明測試有測到）。
 */
function styleOf(sheetXml, styleXml, ref) {
  const cell = new RegExp('<c r="' + ref + '"([^>]*)').exec(sheetXml);
  assert.ok(cell, ref + ' 這一格不存在');
  const si = /\bs="(\d+)"/.exec(cell[1]);
  assert.ok(si, ref + ' 沒有掛任何樣式');
  const xf = cellXfs(styleXml)[Number(si[1])];
  assert.ok(xf, ref + ' 的 xf 索引查不到');
  const pick = (attr) => { const m = new RegExp('\\b' + attr + '="([^"]*)"').exec(xf); return m ? m[1] : null; };
  const border = elems(styleXml, 'border')[Number(pick('borderId') || 0)] || '';
  const font = elems(styleXml, 'font')[Number(pick('fontId') || 0)] || '';
  const side = (name) => {
    const m = new RegExp('<' + name + '(?: style="([^"]*)")?').exec(border);
    return m ? (m[1] || null) : null;
  };
  const al = /<alignment\b([^>]*)\/?>/.exec(xf);
  const alAttr = (a) => { if (!al) return null; const m = new RegExp('\\b' + a + '="([^"]*)"').exec(al[1]); return m ? m[1] : null; };
  const fattr = (tag, a) => { const m = new RegExp('<' + tag + '[^>]*\\b' + a + '="([^"]*)"').exec(font); return m ? m[1] : null; };
  return {
    left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom'),
    sz: fattr('sz', 'val'), fontName: fattr('name', 'val'), colorRgb: fattr('color', 'rgb'),
    bold: /<b\/>|<b /.test(font),
    halign: alAttr('horizontal'), wrap: alAttr('wrapText'),
  };
}

/** cellXfs 區段（styles.xml 裡有 cellStyleXfs 與 cellXfs 兩份 <xf> 清單，要取後者）。 */
function cellXfs(styleXml) {
  const seg = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styleXml);
  if (!seg) return [];
  return [...seg[1].matchAll(/<xf\b(?:[^>]*\/>|[\s\S]*?<\/xf>)/g)].map(m => m[0]);
}

function vendors(n, tables) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ owner: 'a', name: 'V' + i, seatNo: 1, table: String(tables ? tables[i - 1] : i) });
  return out;
}

test('簽到表：一頁＝標題列＋表頭列＋24 列，49 家吐兩頁（每頁 26 列）', async () => {
  const { ws } = await produce(vendors(49), '年中聚餐');
  const range = XLSX.utils.decode_range(ws['!ref']);
  assert.equal(range.e.r + 1, 52, '兩頁 × 26 列');
  assert.equal(range.e.c, 7, 'A..H 八欄');
  assert.equal(ws['A1'].v, '廠商');
  assert.equal(ws['A2'].v, 'No');
  assert.equal(ws['D2'].v, '簽名');
  assert.equal(ws['A27'].v, '廠商');        // 第二頁的標題列
  assert.equal(ws['A29'].v, 49);            // 第二頁第一家
  assert.equal(ws['E3'].v, 25);             // 第一頁右欄從第 25 家開始
});

test('簽到表：標題列每頁都合併 A:H', async () => {
  const { ws } = await produce(vendors(49), 'x');
  const refs = ws['!merges'].map(m => XLSX.utils.encode_range(m));
  assert.deepEqual(refs, ['A1:H1', 'A27:H27']);
});

test('簽到表：列高與欄寬照範本（標題／資料 28.25、表頭 23；簽名欄 33）', async () => {
  const { sheetXml } = await produce(vendors(3), 'x');
  assert.match(sheetXml, /<row r="1" ht="28.25" customHeight="1"/);
  assert.match(sheetXml, /<row r="2" ht="23" customHeight="1"/);
  assert.match(sheetXml, /<row r="3" ht="28.25" customHeight="1"/);
  // 欄寬直接比範本量到的原始值：用 {wch:} 會被 writer 加 0.83 內距逐欄偏移
  const cols = [...sheetXml.matchAll(/<col min="\d+" max="\d+"[^>]*width="([\d.]+)"/g)]
    .map(m => Number(m[1]));
  assert.deepEqual(cols, [3.59765625, 10.19921875, 3.19921875, 33, 4, 10.59765625, 3.19921875, 33]);
});

test('簽到表：姓名欄不自動折行（長廠商名折行會撐高列高，24 列就塞不進一頁）', async () => {
  const { sheetXml, styleXml } = await produce(vendors(3), 'x');
  assert.equal(styleOf(sheetXml, styleXml, 'B3').wrap, null, '姓名欄不折行');
  assert.equal(styleOf(sheetXml, styleXml, 'F3').wrap, null, '右半邊姓名欄也不折行');
  assert.equal(styleOf(sheetXml, styleXml, 'C3').wrap, 'true', '人數欄窄，要折行');
  assert.equal(styleOf(sheetXml, styleXml, 'A2').wrap, 'true', '表頭「No」要折行');
});

test('簽到表：數字開頭的活動名不會把列印字級吃掉', async () => {
  const { sheetXml } = await produce(vendors(1), '2026年中聚餐');
  assert.match(sheetXml, /<oddHeader>&amp;C&amp;18&amp;"微軟正黑體,粗體"2026年中聚餐簽到表<\/oddHeader>/);
});

test('簽到表：列印頁首＝活動名＋簽到表，每頁重複；A4 直向縮成一頁寬', async () => {
  const { sheetXml } = await produce(vendors(3), '2026年中聚餐');
  assert.match(sheetXml, /<oddHeader>&amp;C&amp;18&amp;"微軟正黑體,粗體"2026年中聚餐簽到表<\/oddHeader>/);
  assert.match(sheetXml, /<pageSetup [^>]*paperSize="9"[^>]*orientation="portrait"/);
  assert.match(sheetXml, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
});

test('簽到表：頁與頁之間釘死分頁點（不靠列高剛好塞滿一頁）', async () => {
  const one = await produce(vendors(10), 'x');
  assert.ok(!/<rowBreaks/.test(one.sheetXml), '只有一頁時不該有分頁點');
  const two = await produce(vendors(49), 'x');
  assert.match(two.sheetXml, /<rowBreaks count="1" manualBreakCount="1"><brk id="26"/);
  const three = await produce(vendors(97), 'x');
  assert.match(three.sheetXml, /<rowBreaks count="2"[^>]*><brk id="26"[^>]*\/><brk id="52"/);
});

test('簽到表：桌號印在簽名欄、靠右、淺灰（簽名區留白給人簽）', async () => {
  const { ws, sheetXml, styleXml } = await produce(vendors(2, ['7', '12']), 'x');
  assert.equal(ws['D3'].v, '7桌');
  assert.equal(ws['D4'].v, '12桌');
  const sign = styleOf(sheetXml, styleXml, 'D3');
  assert.equal(sign.halign, 'right');
  assert.equal(sign.colorRgb, 'D9D9D9');
  assert.equal(sign.sz, '12');
  const name = styleOf(sheetXml, styleXml, 'B3');
  assert.equal(name.halign, 'center');
  assert.equal(name.colorRgb, null, '廠商名維持黑字');
  assert.equal(styleOf(sheetXml, styleXml, 'A1').bold, true, '標題粗體');
  assert.equal(styleOf(sheetXml, styleXml, 'A1').sz, '16');
  assert.equal(styleOf(sheetXml, styleXml, 'C3').sz, '8', '人數欄字小（欄窄）');
});

test('簽到表：外框粗、左右半邊用雙線隔開、區塊最後一列封底', async () => {
  const { sheetXml, styleXml } = await produce(vendors(3), 'x');
  const S = (ref) => styleOf(sheetXml, styleXml, ref);
  assert.equal(S('A1').top, 'medium');
  assert.equal(S('A1').bottom, 'medium');
  assert.equal(S('A3').left, 'medium');
  assert.equal(S('H3').right, 'medium');
  assert.equal(S('E3').left, 'double', '左右半邊用雙線隔開');
  assert.equal(S('B3').left, 'hair');
  assert.equal(S('D3').right, null, '簽名欄右邊不畫線（由 E 欄的雙線負責）');
  assert.equal(S('A26').bottom, 'medium', '第 24 列資料＝區塊底線');
  assert.equal(S('A25').bottom, 'thin');
});

test('簽到表：填不滿的格子仍有框線（空白格被丟掉就會缺格線）', async () => {
  const { ws, sheetXml, styleXml } = await produce(vendors(3), 'x');
  assert.ok(ws['E3'], '右欄沒人也要有格子');
  assert.equal(ws['E3'].v, '');
  assert.equal(styleOf(sheetXml, styleXml, 'E3').top, 'thin');
  assert.equal(styleOf(sheetXml, styleXml, 'H26').right, 'medium', '最後一列右欄也要有外框');
});

test('簽到表：檔名帶活動名與產檔日期', async () => {
  const { name } = await produce(vendors(1), '2026年中聚餐');
  assert.equal(name, '來賓簽到表_2026年中聚餐_2026-08-22.xlsx');
});

test('簽到表：沒有廠商名稱的來賓，姓名欄印聯絡人的人名', async () => {
  const { ws } = await produce([
    { _row: 2, owner: 'a', name: '', contact: '王大明', seatNo: 1, table: '3' },
    { _row: 3, owner: 'a', name: '甲營造', contact: '李小華', seatNo: 1, table: '4' },
  ], 'x');
  assert.equal(ws['B3'].v, '王大明');
  assert.equal(ws['C3'].v, 1);
  assert.equal(ws['D3'].v, '3桌');
  assert.equal(ws['B4'].v, '甲營造', '有廠商名稱的不受影響');
});

test('簽到表：兩欄都沒名字的來賓仍佔一列（席位不會憑空消失）', async () => {
  const { ws } = await produce([
    { _row: 2, owner: '王小明', name: '', contact: '', seatNo: 1, table: '3' },
    { _row: 3, owner: '王小明', name: '', contact: '', seatNo: 2, table: '3' },
  ], 'x');
  assert.equal(ws['A3'].v, 1);
  assert.equal(ws['B3'].v, '', '姓名留白等人工補');
  assert.equal(ws['C3'].v, 2, '人數照算，不會漏掉席位');
  assert.equal(ws['D3'].v, '3桌');
});
