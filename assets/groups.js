// 報到頁與人事看板「共用」的單位/職稱分組分類——只此一份，兩邊永不分歧。改分類只改這裡。
// 單位：兩組（分組一＝本部 set、分組二＝其餘）。職稱：依功能 4 組，未分類的新職稱自動落「其他」。
var JDC_HQ_UNITS = { '支店主管': 1, '管理部': 1, '施工部': 1, '工務管理': 1, '技術報價組': 1, '施工圖組': 1 };

// 職稱分組（有序；同組內依此順序顯示）。新職稱沒列到的→自動歸「其他」（免維護）。
var JDC_TITLE_GROUPS = [
  { label: '工務／工程', titles: ['工程師', '助理工程師', '總工程師', '施工主任', '品管工程師', '主任', '副主任', '組長', '領班', '安衛主任', '勞安主任'] },
  { label: '機電', titles: ['機電主任', '機電副主任', '機電工程師'] },
  { label: '繪圖／規劃', titles: ['繪圖工程師', '繪圖副主任', '繪圖組長', '規劃工程師', '規劃組長', '估算人員'] },
  { label: '行政／管理', titles: ['事務員', '人事主任', '會計主任', '財務出納'] }
];

function jdcEsc(s) {
  return (s == null ? '' : s).toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 產生分組的 <optgroup> 選項 HTML。kind:'unit'|'title'；current 會被選中
// （current 不在清單內，例如舊資料或「找不到」哨兵，額外保留成一個選項，不漏值）。
function jdcGroupedOptions(items, kind, current) {
  items = items || [];
  var html = '';
  if (current && items.indexOf(current) === -1 && current !== '__manual__') {
    html += '<option selected value="' + jdcEsc(current) + '">' + jdcEsc(current) + '</option>';
  }
  function grp(label, arr) {
    if (!arr.length) return '';
    var s = '<optgroup label="' + jdcEsc(label) + '">';
    arr.forEach(function (x) {
      s += '<option value="' + jdcEsc(x) + '"' + (x === current ? ' selected' : '') + '>' + jdcEsc(x) + '</option>';
    });
    return s + '</optgroup>';
  }
  if (kind === 'title') {
    var used = {};
    JDC_TITLE_GROUPS.forEach(function (g) {
      var arr = g.titles.filter(function (t) { return items.indexOf(t) !== -1; });
      arr.forEach(function (t) { used[t] = 1; });
      html += grp(g.label, arr);
    });
    html += grp('其他', items.filter(function (t) { return !used[t]; }));   // 未分類(新職稱)→其他
    return html;
  }
  // unit：兩組
  var a = [], b = [];
  items.forEach(function (x) { (JDC_HQ_UNITS[x] ? a : b).push(x); });
  return html + grp('分組一', a) + grp('分組二', b);
}
