// 報到頁與人事看板「共用」的單位/職稱分組分類——只此一份，兩邊永不分歧。
// 改分類只改這裡。新單位自動歸「工地專案」、新職稱自動歸「共通職稱」（免維護）。
var JDC_HQ_UNITS = { '支店主管': 1, '管理部': 1, '施工部': 1, '工務管理': 1, '技術報價組': 1, '施工圖組': 1 };
var JDC_BRANCH_TITLES = { '支店長': 1, '部長': 1, '經理': 1, '事務員': 1, '估算': 1, '建築繪圖人員': 1 };

function jdcEsc(s) {
  return (s == null ? '' : s).toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 產生分組的 <optgroup> 選項 HTML。kind:'unit'|'title'；current 會被選中
// （若 current 不在清單內，例如舊資料或哨兵，額外保留成一個選項，不漏值）。
function jdcGroupedOptions(items, kind, current) {
  var labelA, labelB, isB;
  if (kind === 'unit') { labelA = '本部單位'; labelB = '工地專案'; isB = function (x) { return !JDC_HQ_UNITS[x]; }; }
  else { labelA = '共通職稱'; labelB = '支店專有'; isB = function (x) { return !!JDC_BRANCH_TITLES[x]; }; }
  var a = [], b = [];
  (items || []).forEach(function (x) { (isB(x) ? b : a).push(x); });
  var inList = (items || []).indexOf(current) !== -1;
  var html = '';
  if (current && !inList && current !== '__manual__') {
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
  return html + grp(labelA, a) + grp(labelB, b);
}
