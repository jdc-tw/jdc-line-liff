// 報到頁與人事看板「共用」的單位/職稱分組——分組來源＝選項清單「分類」欄（roster.json / getCheckinOptions
// 帶下來的 unitGroups/titleGroups，各頁載入後塞進 window.JDC_GROUPS）；沒帶到時退回本檔預設規則。
// 要調整某單位/職稱的分組：改「選項清單」分頁的「分類」欄即可，不用改程式。
var JDC_HQ_UNITS = { '支店主管': 1, '管理部': 1, '施工部': 1, '工務管理組': 1, '技術報價組': 1, '施工圖組': 1 };

// 職稱分組預設（後備）＋組內顯示順序（低階層→高階層）；資料層分組進來的未知職稱組內排最後（依筆畫）。
var JDC_TITLE_GROUPS = [
  { label: '工務／工程', titles: ['領班', '助理工程師', '工程師', '品管工程師', '組長', '副主任', '主任', '安衛主任', '勞安主任', '總工程師'] },
  { label: '機電', titles: ['機電工程師', '機電副主任', '機電主任'] },
  { label: '繪圖／規劃', titles: ['估算人員', '繪圖工程師', '規劃工程師', '繪圖組長', '規劃組長', '繪圖副主任'] },
  { label: '行政／管理', titles: ['事務員', '財務出納', '會計主任', '人事主任'] }
];
var JDC_TITLE_GROUP_ORDER = ['工務／工程', '機電', '繪圖／規劃', '行政／管理', '其他'];
var JDC_TITLE_RANK = (function () {
  var m = {}, i = 0;
  JDC_TITLE_GROUPS.forEach(function (g) { g.titles.forEach(function (t) { m[t] = ++i; }); });
  return m;
})();

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
  var maps = (typeof window !== 'undefined' && window.JDC_GROUPS) || {};
  if (kind === 'title') {
    var tmap = maps.titleGroups || {};
    function titleGroupOf(t) {
      if (tmap[t]) return tmap[t];
      for (var i = 0; i < JDC_TITLE_GROUPS.length; i++) {
        if (JDC_TITLE_GROUPS[i].titles.indexOf(t) >= 0) return JDC_TITLE_GROUPS[i].label;
      }
      return '其他';
    }
    var buckets = {};
    items.forEach(function (t) { var g = titleGroupOf(t); (buckets[g] = buckets[g] || []).push(t); });
    var labels = JDC_TITLE_GROUP_ORDER.filter(function (l) { return buckets[l]; })
      .concat(Object.keys(buckets).filter(function (l) { return JDC_TITLE_GROUP_ORDER.indexOf(l) < 0; }));
    labels.forEach(function (l) {
      buckets[l].sort(function (a, b) { return (JDC_TITLE_RANK[a] || 999) - (JDC_TITLE_RANK[b] || 999) || a.localeCompare(b, 'zh-Hant'); });
      html += grp(l, buckets[l]);
    });
    return html;
  }
  // unit：總公司／工地（＋主檔自訂的其他分類附於其後）。
  var umap = maps.unitGroups || {};
  function unitGroupOf(x) { return umap[x] || (JDC_HQ_UNITS[x] ? '總公司' : '工地'); }
  var ub = {};
  items.forEach(function (x) { var g = unitGroupOf(x); (ub[g] = ub[g] || []).push(x); });
  var uLabels = ['總公司', '工地'].filter(function (l) { return ub[l]; })
    .concat(Object.keys(ub).filter(function (l) { return l !== '總公司' && l !== '工地'; }));
  uLabels.forEach(function (l) { html += grp(l, ub[l]); });
  return html;
}
