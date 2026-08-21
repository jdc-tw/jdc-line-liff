/**
 * xlsx-post.js — 產出 xlsx 的兩個後製（stats.html 與 node --test 共用）。
 *
 * 1) xlsxPostFormulas(ws)：aoa 裡以 '=' 開頭的字串轉成真公式。
 *    為何：SheetJS 的 aoa_to_sheet 把 '=COUNTA(...)' 當純文字（cell.t='s'），
 *    Excel 打開就是一串字——2026-08-07 排位用檔 31 格公式全變文字的病根。
 *    轉法＝設 cell.f、拿掉快取值 v（Excel/Numbers/LibreOffice 開檔時會對無快取值的公式自動重算）。
 *
 * 2) freezeSheetXml(xml, topLeft)：把凍結窗格 <pane> 插進 worksheet XML。
 *    為何：專案用的 xlsx-js-style 0.18.5 writer 不支援凍結（sheetView 只會寫 RTL/workbookViewId），
 *    只能在 zip 後製階段直接改 xl/worksheets/sheetN.xml。topLeft 例 'B32' ＝凍結 A 欄＋前 31 列。
 */

/** ws 內 '=' 開頭的字串儲存格 → 真公式。回傳轉換格數（驗證用）。 */
function xlsxPostFormulas(ws) {
  var n = 0;
  Object.keys(ws).forEach(function (ref) {
    if (ref.charAt(0) === '!') return;
    var cell = ws[ref];
    if (cell && cell.t === 's' && typeof cell.v === 'string' && cell.v.charAt(0) === '=') {
      cell.f = cell.v.slice(1);
      cell.t = 'n';        // 這批公式（COUNTA/SUM/參照）都回數字
      delete cell.v;       // 不留假快取值，逼開檔重算
      n++;
    }
  });
  return n;
}

/** 'B32' → {xSplit:1, ySplit:31}（凍結左邊 1 欄、上面 31 列）。 */
function splitOfTopLeft(topLeft) {
  var m = /^([A-Z]+)(\d+)$/.exec(String(topLeft || '').toUpperCase());
  if (!m) return null;
  var col = 0;
  for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { xSplit: col - 1, ySplit: Number(m[2]) - 1 };
}

/** worksheet XML 插入凍結 pane。已有 sheetViews 就塞進第一個 sheetView，沒有就整段補在 sheetData 系列元素前。 */
function freezeSheetXml(xml, topLeft) {
  var sp = splitOfTopLeft(topLeft);
  if (!sp || (sp.xSplit === 0 && sp.ySplit === 0)) return xml;
  var pane = '<pane' + (sp.xSplit ? ' xSplit="' + sp.xSplit + '"' : '')
           + (sp.ySplit ? ' ySplit="' + sp.ySplit + '"' : '')
           + ' topLeftCell="' + topLeft + '" activePane="'
           + (sp.xSplit && sp.ySplit ? 'bottomRight' : (sp.ySplit ? 'bottomLeft' : 'topRight'))
           + '" state="frozen"/>';
  if (/<sheetViews>/.test(xml)) {
    // ⚠️ regex 必須排除 <sheetViews>（sheetView 是它的前綴）——(\s[^>]*?)? 只接受「空白+屬性」或緊接結尾
    // 自閉合 <sheetView .../> → 展開塞 pane；已展開的把 pane 插在開標籤正後方（不動原本的閉合）
    if (/<sheetView(\s[^>]*?)?\/>/.test(xml)) {
      return xml.replace(/<sheetView(\s[^>]*?)?\/>/, '<sheetView$1>' + pane + '</sheetView>');
    }
    return xml.replace(/<sheetView(\s[^>]*)?>/, '<sheetView$1>' + pane);
  }
  // 無 sheetViews：照 schema 順序補在 sheetFormatPr / cols / sheetData 之前（取最先出現者）
  var anchor = xml.search(/<sheetFormatPr|<cols>|<cols |<sheetData[ >\/]/);
  if (anchor < 0) return xml;
  var block = '<sheetViews><sheetView workbookViewId="0">' + pane + '</sheetView></sheetViews>';
  return xml.slice(0, anchor) + block + xml.slice(anchor);
}

/**
 * workbook.xml 加 <calcPr fullCalcOnLoad="1"/>：開檔強制重算。
 * 為何：xlsxPostFormulas 刻意不留快取值（避免假數字），但少數 Excel 版本不會自動補算，
 * 檢核區就會顯示空白／0＝「公式對但數字不出現」。這個旗標要求開檔時整本重算。
 * writer 目前不產 calcPr（已實測）；有的話就補屬性、沒有就插在 </workbook> 前（schema 允許的位置）。
 */
function forceRecalcXml(xml) {
  if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(xml)) return xml;
  if (/<calcPr/.test(xml)) return xml.replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"');
  return xml.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
}

/** XML 文字節點逸出（頁首字串會整段塞進 <oddHeader>）。 */
function xmlEsc_(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * pageSetupXml(xml, opts)：把「列印頁首＋A4 版面＋分頁點」補進 worksheet XML。
 *
 * 為何：xlsx-js-style 0.18.5 的 writer 只吐 dimension/sheetViews/cols/sheetData/mergeCells
 *（＋結尾的 ignoredErrors），**完全不寫 sheetPr、pageMargins、pageSetup、headerFooter、rowBreaks**
 *（2026-08-22 實測），所以簽到表要的「每頁重複的大標題」與「一個區塊一頁」只能在 zip 後製階段補。
 * 走的是跟 freezeSheetXml 同一條路（產檔 → JSZip 開 → 改 sheet XML → 重新打包）。
 *
 * 兩個位置是硬規，插錯 Excel 會判檔案損毀：
 *  - `<sheetPr>` 必須是 `<worksheet>` 的**第一個**子元素。
 *  - `pageMargins → pageSetup → headerFooter → rowBreaks` 這串，在 schema 裡排在 `ignoredErrors`
 *    **之前**；而 writer 剛好會吐 ignoredErrors，所以不能無腦附在 `</worksheet>` 前。
 *
 * 分頁不靠「列高剛好塞滿一頁」——那在不同印表機／縮放下會漂掉，改用 manual rowBreaks 釘死。
 *
 * @param {string} xml worksheet XML
 * @param {{header?:string, headerFont?:string, headerSize?:number,
 *          margins?:{left,right,top,bottom}, rowBreaks?:number[]}} [opts]
 *        header＝置中頁首文字（每頁重複）；rowBreaks＝在第 n 列**之後**分頁（1-based）。
 * @returns {string} 沒有 header 也沒有 rowBreaks 時原樣回傳
 */
function pageSetupXml(xml, opts) {
  opts = opts || {};
  var breaks = opts.rowBreaks || [];
  if (!opts.header && !breaks.length) return xml;
  var m = opts.margins || { left: 0.51, right: 0.51, top: 0.75, bottom: 0.75 };
  var out = xml;

  // 1) sheetPr（fitToPage 旗標）——必須是第一個子元素
  if (!/<sheetPr[ >\/]/.test(out)) {
    out = out.replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  }

  // 2) 列印區塊。頁首語法：&C=置中、&"字型,樣式"、&級數；文字本身的 & 要先加倍才不會被當格式碼
  var block = '<pageMargins left="' + m.left + '" right="' + m.right
    + '" top="' + m.top + '" bottom="' + m.bottom + '" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
  if (opts.header) {
    // ⚠️ 順序是 &C → &級數 → &"字型" → 文字。字級碼是「& 後面接連續數字」，
    // 若緊接著標題文字（活動名常以年份開頭，例：2025年度…），解析器會把 18 和 2025 讀成一個數字
    //（&18 + 2025 → 182025），字級整個歪掉——2026-08-22 拿範本逐格對照才抓到，Excel 開檔不會報錯。
    // 把字型碼墊在中間，字級碼後面永遠是 '&'，數字就斷得乾淨。
    var code = '&C' + (opts.headerSize ? '&' + opts.headerSize : '')
      + (opts.headerFont ? '&"' + opts.headerFont + '"' : '')
      + String(opts.header).replace(/&/g, '&&');
    block += '<headerFooter><oddHeader>' + xmlEsc_(code) + '</oddHeader></headerFooter>';
  }
  if (breaks.length) {
    block += '<rowBreaks count="' + breaks.length + '" manualBreakCount="' + breaks.length + '">'
      + breaks.map(function (r) { return '<brk id="' + r + '" max="16383" man="1"/>'; }).join('')
      + '</rowBreaks>';
  }

  // 3) 插在 schema 上排在 headerFooter/rowBreaks 之後的第一個元素前面
  var after = out.search(/<colBreaks[ >]|<customProperties[ >]|<cellWatches[ >]|<ignoredErrors[ >]|<smartTags[ >]|<drawing[ \/>]|<legacyDrawing[ \/>]|<picture[ \/>]|<oleObjects[ >]|<controls[ >]|<tableParts[ >]|<extLst[ >]|<\/worksheet>/);
  return out.slice(0, after) + block + out.slice(after);
}

if (typeof module !== 'undefined') {
  module.exports = { pageSetupXml, xlsxPostFormulas, splitOfTopLeft, freezeSheetXml, forceRecalcXml };
}
