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

test('整合：排位用檔產出＝真公式＋B32 凍結（用實際函式庫與 JSZip 走完全程）', async () => {
  // 瀏覽器版 xlsx-style 在 node 下會去 require('./cpexcel.js')（codepage 表）；
  // 我們只寫 UTF-8 xlsx 用不到 codepage 轉換，墊 stub 讓它載得起來即可。
  global.cptable = { utils: {
    decode: function (cp, arr) { return Buffer.from(arr).toString('utf8'); },
    encode: function (cp, s) { return Buffer.from(String(s), 'utf8'); },
  } };
  const XLSX = require('../assets/xlsx-style.min.js');
  const JSZip = require('../assets/jszip.min.js');
  const { buildSeatingAoa, TABLE_ROWS } = require('../assets/seating.js');

  const aoa = buildSeatingAoa(['工務管理組', '管理部'], { 工務管理組: ['甲', '乙'], 管理部: ['丙'] }, ['負責人A'], { 負責人A: ['來賓1'] }, 4);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const n = xlsxPostFormulas(ws);
  assert.ok(n >= 5, '至少檢核區4格+每欄剩餘: 轉了 ' + n);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '座位表');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const topLeft = 'B' + (TABLE_ROWS + 4);
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(path).async('string');
  zip.file(path, freezeSheetXml(xml, topLeft));
  zip.file('xl/workbook.xml', forceRecalcXml(await zip.file('xl/workbook.xml').async('string')));
  const out = await zip.generateAsync({ type: 'nodebuffer' });

  // 用 zip 內容直接驗（不依賴外部工具）：pane 在、公式以 <f> 存在、不再有文字型 '=…'
  const zip2 = await JSZip.loadAsync(out);
  const xml2 = await zip2.file(path).async('string');
  assert.match(xml2, /<pane xSplit="1" ySplit="31" topLeftCell="B32"[^>]*state="frozen"\/>/);
  assert.match(xml2, /<f>COUNTA\(/);
  const shared = zip2.file('xl/sharedStrings.xml');
  if (shared) {
    const ss = await shared.async('string');
    assert.doesNotMatch(ss, /=COUNTA/, '共享字串裡不得再有文字公式');
  }
});
