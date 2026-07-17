// 員工名冊下載（單位總表＋逐人明細）——board.html／stats.html 共用。
// 用法：頁面載入 roster-wide.js 與本檔後，呼叫
//   rosterDlInit({ jsonp: jsonp, token: TOKEN, msg: function(text,type){...}, leaversId: 'checkbox-id' })
// 按鈕 onclick 掛 downloadRoster()（單位總表）／downloadRosterFlat()（逐人明細）。
var __rdl = null;
function rosterDlInit(cfg) { __rdl = cfg; }

// 產檔元件（~420KB）用到才載；載完自動續跑當次下載
function __rdlXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!window.__rdlLoading) {
    window.__rdlLoading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'assets/xlsx-style.min.js';
      s.onload = res;
      s.onerror = function () { window.__rdlLoading = null; rej(new Error('產檔元件載入失敗，請重試')); };
      document.body.appendChild(s);
    });
  }
  return window.__rdlLoading;
}
function __rdlToday() {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate());
}
function inclLeavers_() { var el = document.getElementById(__rdl.leaversId); return !!(el && el.checked); }
function dlDoneMsg_(active, total) { return '已下載 ✅（在職 ' + active + ' 人' + (total > active ? '，含離職 ' + (total - active) + ' 人' : '') + '）'; }

// 單位總表：getRosterList＋listOptions → buildRosterWide（恆只列在職；含離職只在逐人明細）
function downloadRoster() {
  __rdl.msg('產生中…', 'info');
  Promise.all([__rdlXlsx(), __rdl.jsonp('getRosterList', { token: __rdl.token }), __rdl.jsonp('listOptions', { token: __rdl.token })]).then(function (rs) {
    var r = rs[1], o = rs[2];
    if (!r || !r.ok) { __rdl.msg((r && r.msg) || '名冊載入失敗', 'err'); return; }
    if (!o || !o.ok) { __rdl.msg((o && o.msg) || '選項載入失敗', 'err'); return; }
    var aoa = buildRosterWide(r.rows || [], o.rows || [], __rdlToday());
    if (aoa.length < 2) { __rdl.msg('名冊沒有在職資料，暫不產檔。', 'err'); return; }
    writeStyledXlsx_(aoa, '單位總表', { headerRow: true });
    __rdl.msg('已下載 ✅（在職 ' + (aoa[1][aoa[1].length - 1]) + ' 人）', 'ok');
  }).catch(function (e) { __rdl.msg(String(e && e.message || e), 'err'); });
}
// 逐人明細：getRosterExport（名冊分頁顯示值原樣·預設只列在職·勾「含離職」帶 include=leavers），欄位與系統名冊 Sheet 一致
function downloadRosterFlat() {
  __rdl.msg('產生中…', 'info');
  var params = { token: __rdl.token };
  if (inclLeavers_()) params.include = 'leavers';
  Promise.all([__rdlXlsx(), __rdl.jsonp('getRosterExport', params)]).then(function (rs) {
    var r = rs[1];
    if (!r || !r.ok) { __rdl.msg((r && r.msg) || '名冊載入失敗', 'err'); return; }
    if (!r.rows || !r.rows.length) { __rdl.msg('名冊沒有在職資料，暫不產檔。', 'err'); return; }
    var aoa = [r.hdr].concat(r.rows);
    writeStyledXlsx_(aoa, '逐人明細', { leftAlign: ['信箱'], headerRow: true });
    __rdl.msg(dlDoneMsg_(r.active, r.rows.length), 'ok');
  }).catch(function (e) { __rdl.msg(String(e && e.message || e), 'err'); });
}
// 產檔共用：格線＋置中（指定欄靠左）＋欄寬自適應＋表頭粗體
function writeStyledXlsx_(aoa, label, opts) {
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  styleWs_(ws, aoa, opts || {});
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '員工名冊');
  XLSX.writeFile(wb, '員工名冊_' + label + '_' + __rdlToday().replace(/\//g, '-') + '.xlsx');
}
function styleWs_(ws, aoa, opts) {
  var leftIdx = (opts.leftAlign || []).map(function (h) { return aoa[0].indexOf(h); }).filter(function (i) { return i >= 0; });
  var bd = { style: 'thin', color: { rgb: 'B8B8B8' } };
  var border = { top: bd, bottom: bd, left: bd, right: bd };
  var widths = [];
  var wlen = function (v) { var n = 0, t = String(v == null ? '' : v); for (var i = 0; i < t.length; i++) n += t.charCodeAt(i) > 255 ? 2 : 1; return n; };
  for (var r = 0; r < aoa.length; r++) {
    for (var c = 0; c < aoa[r].length; c++) {
      widths[c] = Math.max(widths[c] || 0, wlen(aoa[r][c]));
      var ref = XLSX.utils.encode_cell({ r: r, c: c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };   // 空格也畫格線，表格才完整
      ws[ref].s = { border: border,
        alignment: { horizontal: (leftIdx.indexOf(c) >= 0 && r > 0) ? 'left' : 'center', vertical: 'center' },
        font: (opts.headerRow && r === 0) ? { bold: true } : undefined };
    }
  }
  ws['!cols'] = widths.map(function (w) { return { wch: Math.min(Math.max(w + 2, 6), 40) }; });
}
