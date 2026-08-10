const { test } = require('node:test');
const assert = require('node:assert');
const { xlsxPostFormulas, splitOfTopLeft, freezeSheetXml, forceRecalcXml } = require('../assets/xlsx-post.js');

test('forceRecalcXml：無 calcPr 補整段／有 calcPr 補屬性／已有旗標不重複', () => {
  const bare = '<workbook><sheets/></workbook>';
  assert.match(forceRecalcXml(bare), /<calcPr calcId="191029" fullCalcOnLoad="1"\/><\/workbook>/);
  const withCalc = '<workbook><sheets/><calcPr calcId="123"/></workbook>';
  assert.match(forceRecalcXml(withCalc), /<calcPr fullCalcOnLoad="1" calcId="123"\/>/);
  const already = '<workbook><calcPr fullCalcOnLoad="1"/></workbook>';
  assert.strictEqual(forceRecalcXml(already), already);
});

// ── splitOfTopLeft ──────────────────────────────────────────────────────

test('splitOfTopLeft：B32=凍結A欄+31列；AA10 進位正確；壞輸入回 null', () => {
  assert.deepStrictEqual(splitOfTopLeft('B32'), { xSplit: 1, ySplit: 31 });
  assert.deepStrictEqual(splitOfTopLeft('B2'), { xSplit: 1, ySplit: 1 });
  assert.deepStrictEqual(splitOfTopLeft('AA10'), { xSplit: 26, ySplit: 9 });
  assert.strictEqual(splitOfTopLeft(''), null);
  assert.strictEqual(splitOfTopLeft('32'), null);
});

// ── xlsxPostFormulas ────────────────────────────────────────────────────

test('xlsxPostFormulas：=開頭字串轉真公式（f 設定、v 移除、t=n），其餘不動', () => {
  const ws = {
    '!ref': 'A1:B2',
    A1: { t: 's', v: '=COUNTA(B2:W29)' },
    A2: { t: 's', v: '姓名' },
    B1: { t: 'n', v: 42 },
    B2: { t: 's', v: '=SUM(B49:V49)', s: { font: { bold: true } } },
  };
  const n = xlsxPostFormulas(ws);
  assert.strictEqual(n, 2);
  assert.strictEqual(ws.A1.f, 'COUNTA(B2:W29)');
  assert.strictEqual(ws.A1.t, 'n');
  assert.strictEqual('v' in ws.A1, false);
  assert.deepStrictEqual(ws.A2, { t: 's', v: '姓名' });
  assert.deepStrictEqual(ws.B1, { t: 'n', v: 42 });
  assert.strictEqual(ws.B2.f, 'SUM(B49:V49)');
  assert.deepStrictEqual(ws.B2.s, { font: { bold: true } }, '樣式必須保留');
});

// ── freezeSheetXml ──────────────────────────────────────────────────────

test('freezeSheetXml：無 sheetViews → 在 sheetFormatPr 前補整段', () => {
  const xml = '<worksheet><dimension ref="A1:B2"/><sheetFormatPr defaultRowHeight="16"/><sheetData/></worksheet>';
  const out = freezeSheetXml(xml, 'B32');
  assert.match(out, /<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="31" topLeftCell="B32" activePane="bottomRight" state="frozen"\/><\/sheetView><\/sheetViews><sheetFormatPr/);
});

test('freezeSheetXml：自閉合 sheetView → 展開塞 pane', () => {
  const xml = '<worksheet><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData/></worksheet>';
  const out = freezeSheetXml(xml, 'B2');
  assert.match(out, /<sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/><\/sheetView>/);
  assert.strictEqual((out.match(/<\/sheetView>/g) || []).length, 1);
});

test('freezeSheetXml：展開式 sheetView → pane 插開標籤後、閉合不重複', () => {
  const xml = '<worksheet><sheetViews><sheetView workbookViewId="0"><selection activeCell="A1"/></sheetView></sheetViews><sheetData/></worksheet>';
  const out = freezeSheetXml(xml, 'B32');
  assert.match(out, /<sheetView workbookViewId="0"><pane [^>]*state="frozen"\/><selection/);
  assert.strictEqual((out.match(/<\/sheetView>/g) || []).length, 1);
});

test('freezeSheetXml：A1（無凍結量）與壞 topLeft 原樣返回', () => {
  const xml = '<worksheet><sheetData/></worksheet>';
  assert.strictEqual(freezeSheetXml(xml, 'A1'), xml);
  assert.strictEqual(freezeSheetXml(xml, ''), xml);
});

// ── 整合：真的走一遍 aoa → xlsx → zip 後製，驗最終檔案 ────────────────────

test('整合：排位用檔產出＝真公式＋凍結到分類表頭（用實際函式庫與 JSZip 走完全程）', async () => {
  // 瀏覽器版 xlsx-style 在 node 下會去 require('./cpexcel.js')（codepage 表）；
  // 我們只寫 UTF-8 xlsx 用不到 codepage 轉換，墊 stub 讓它載得起來即可。
  global.cptable = { utils: {
    decode: function (cp, arr) { return Buffer.from(arr).toString('utf8'); },
    encode: function (cp, s) { return Buffer.from(String(s), 'utf8'); },
  } };
  const XLSX = require('../assets/xlsx-style.min.js');
  const JSZip = require('../assets/jszip.min.js');
  const { buildSeatingAoa } = require('../assets/seating.js');

  const sb = buildSeatingAoa(['工務管理組', '管理部'], { 工務管理組: ['甲', '乙'], 管理部: ['丙'] }, ['負責人A'], { 負責人A: ['來賓1'] }, 4);
  const aoa = sb.aoa;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const n = xlsxPostFormulas(ws);
  assert.ok(n >= 5, '至少檢核區4格+每欄剩餘: 轉了 ' + n);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '座位表');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const topLeft = sb.freezeTopLeft;
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(path).async('string');
  zip.file(path, freezeSheetXml(xml, topLeft));
  zip.file('xl/workbook.xml', forceRecalcXml(await zip.file('xl/workbook.xml').async('string')));
  const out = await zip.generateAsync({ type: 'nodebuffer' });

  // 用 zip 內容直接驗（不依賴外部工具）：pane 在、公式以 <f> 存在、不再有文字型 '=…'
  const zip2 = await JSZip.loadAsync(out);
  const xml2 = await zip2.file(path).async('string');
  assert.strictEqual(topLeft, 'B16', '12 席版面的分類表頭在第 15 列');
  assert.match(xml2, /<pane xSplit="1" ySplit="15" topLeftCell="B16"[^>]*state="frozen"\/>/);
  assert.match(xml2, /<f>SUMPRODUCT\(/);
  assert.doesNotMatch(xml2, /<f>COUNTA\(/, '不得再用 COUNTA（會數到畫格線用的空字串）');
  const shared = zip2.file('xl/sharedStrings.xml');
  if (shared) {
    const ss = await shared.async('string');
    assert.doesNotMatch(ss, /=SUMPRODUCT|=SUM\(|=AD/, '共享字串裡不得再有文字公式');
  }
});

test('整合：分類欄底色真的寫進檔案，且沒名字的格不上色', async () => {
  global.cptable = global.cptable || { utils: { decode: (c, a) => Buffer.from(a).toString('utf8'), encode: (c, s) => Buffer.from(String(s), 'utf8') } };
  const XLSX = require('../assets/xlsx-style.min.js');
  const { buildSeatingAoa, SEAT_ROWS } = require('../assets/seating.js');
  const sb = buildSeatingAoa(['管理部', '施工部'], { 管理部: ['甲', '乙'], 施工部: ['丙'] }, [], {}, 3);
  const ws = XLSX.utils.aoa_to_sheet(sb.aoa);
  const fill = {}; sb.fills.forEach(f => { fill[f[0] + ',' + f[1]] = f[2]; });
  // 模擬 writeSeatXlsx_ 的樣式迴圈（含空格補空字串）
  for (let r = 0; r < sb.aoa.length; r++) {
    for (let c = 0; c < (sb.aoa[r] || []).length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const bg = fill[r + ',' + c];
      ws[ref].s = { fill: bg ? { patternType: 'solid', fgColor: { rgb: bg } } : undefined };
    }
  }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '座位表');
  const JSZip = require('../assets/jszip.min.js');
  const zip = await JSZip.loadAsync(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const stylesXml = await zip.file('xl/styles.xml').async('string');

  // styles.xml：cellXfs 第 i 個 xf 的 fillId → fills 第 n 個的 fgColor
  const fillColors = (stylesXml.match(/<fills[\s\S]*?<\/fills>/) || [''])[0]
    .split('<fill>').slice(1).map(s => (s.match(/fgColor rgb="([0-9A-Fa-f]{6,8})"/) || [])[1] || null);
  const xfs = (stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0]
    .split(/<xf /).slice(1).map(s => Number((s.match(/fillId="(\d+)"/) || [])[1] || 0));
  const bgOf = (ref) => {
    const m = sheetXml.match(new RegExp('<c r="' + ref + '"[^>]*s="(\\d+)"'));
    if (!m) return null;
    const c = fillColors[xfs[Number(m[1])]];
    return c ? c.slice(-6).toUpperCase() : null;   // 去掉 alpha
  };
  const h = SEAT_ROWS + 2;                       // 分類表頭 0-based → Excel 第 h+1 列
  const R = (r) => r + 1;
  assert.strictEqual(bgOf('B' + R(h)), fill[h + ',1'], '管理部表頭底色寫進檔案');
  assert.strictEqual(bgOf('B' + R(h + 1)), fill[h + ',1'], '甲（有名字）同欄同色');
  assert.strictEqual(bgOf('B' + R(h + 2)), fill[h + ',1'], '乙（有名字）同欄同色');
  assert.strictEqual(bgOf('C' + R(h + 2)), null, '施工部只有 1 人 → 第 2 列不得有底色');
  assert.notStrictEqual(bgOf('B' + R(h)), bgOf('C' + R(h)), '兩欄顏色不同');
});

test('整合：正式座位表的底色與紅字同時寫進檔案，且與排位用檔同色', async () => {
  global.cptable = global.cptable || { utils: { decode: (c, a) => Buffer.from(a).toString('utf8'), encode: (c, s) => Buffer.from(String(s), 'utf8') } };
  const XLSX = require('../assets/xlsx-style.min.js');
  const { buildSeatingAoa, buildFormalAoa, categoryPalette, guestOwnerOrder, SEAT_ROWS } = require('../assets/seating.js');
  const units = ['管理部', '施工部'], owners = ['王小明'];
  const byUnit = { 管理部: ['甲'], 施工部: ['乙'] };
  const guestsByOwner = { 王小明: ['賓1'] };
  const seats = [
    { name: '甲', kind: 'emp', unit: '管理部', table: '1' },
    { name: '乙', kind: 'emp', unit: '施工部', table: '1' },
    { name: '賓1', kind: 'guest', unit: '王小明', table: '1' },
  ];
  const pal = categoryPalette(units, guestOwnerOrder(owners, guestsByOwner));
  const r = buildFormalAoa(seats, {}, pal);

  // 模擬 writeSeatXlsx_ 的樣式迴圈（底色與紅字疊在同一格上）
  const ws = XLSX.utils.aoa_to_sheet(r.aoa);
  const fill = {}; r.fills.forEach(f => { fill[f[0] + ',' + f[1]] = f[2]; });
  const red = {}; r.guestCells.forEach(rc => { red[rc[0] + ',' + rc[1]] = 1; });
  for (let rr = 0; rr < r.aoa.length; rr++) {
    for (let c = 0; c < (r.aoa[rr] || []).length; c++) {
      const ref = XLSX.utils.encode_cell({ r: rr, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const bg = fill[rr + ',' + c];
      ws[ref].s = { fill: bg ? { patternType: 'solid', fgColor: { rgb: bg } } : undefined,
                    font: { name: 'Microsoft JhengHei', color: red[rr + ',' + c] ? { rgb: 'C00000' } : undefined } };
    }
  }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '正式座位表');
  const JSZip = require('../assets/jszip.min.js');
  const zip = await JSZip.loadAsync(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const stylesXml = await zip.file('xl/styles.xml').async('string');
  const fillColors = (stylesXml.match(/<fills[\s\S]*?<\/fills>/) || [''])[0]
    .split('<fill>').slice(1).map(s => (s.match(/fgColor rgb="([0-9A-Fa-f]{6,8})"/) || [])[1] || null);
  const fontColors = (stylesXml.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0]
    .split('<font>').slice(1).map(s => (s.match(/color rgb="([0-9A-Fa-f]{6,8})"/) || [])[1] || null);
  const xf = (ref) => {
    const m = sheetXml.match(new RegExp('<c r="' + ref + '"[^>]*s="(\\d+)"'));
    return m ? (stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0].split(/<xf /).slice(1)[Number(m[1])] : null;
  };
  const pick = (ref, attr, table) => {
    const s = xf(ref); if (!s) return null;
    const c = table[Number((s.match(new RegExp(attr + '="(\\d+)"')) || [])[1] || 0)];
    return c ? c.slice(-6).toUpperCase() : null;
  };
  const bgOf = (ref) => pick(ref, 'fillId', fillColors);
  const fgOf = (ref) => pick(ref, 'fontId', fontColors);

  // 正式表：1 桌那欄＝甲(B2)、乙(B3)、賓1(B4)
  assert.strictEqual(bgOf('B2'), pal.unit['管理部']);
  assert.strictEqual(bgOf('B3'), pal.unit['施工部']);
  assert.strictEqual(bgOf('B4'), pal.guest['王小明']);
  assert.strictEqual(fgOf('B4'), 'C00000', '來賓格底色與紅字要能並存（不會被彼此蓋掉）');
  assert.strictEqual(bgOf('B1'), null, '表頭（桌號）不上色');
  assert.strictEqual(bgOf('A2'), null, '席位序號欄不上色');

  // 同一份資料的排位用檔：同一個人取到同一個色（跨兩份檔案、都走真 writer）
  const sb = buildSeatingAoa(units, byUnit, owners, guestsByOwner, 3);
  const h = SEAT_ROWS + 2;
  const seatingHdrColor = (name) => (sb.fills.find(f => f[0] === h && f[1] === sb.aoa[h].indexOf(name)) || [])[2];
  assert.strictEqual(bgOf('B2'), seatingHdrColor('管理部'), '甲：兩份檔案同色');
  assert.strictEqual(bgOf('B3'), seatingHdrColor('施工部'), '乙：兩份檔案同色');
  assert.strictEqual(bgOf('B4'), seatingHdrColor('王小明'), '賓1：兩份檔案同色');
});
