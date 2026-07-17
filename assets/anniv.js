// 年資里程碑（board/stats 兩看板共用）：當年度年資逢 5 倍數的在職者。
// 用法：頁面放 <div id="anniv-box">…</div>，載入後呼叫 annivInit(jsonp, token[, opts])。
// 預設名單空＝整塊不顯示（board 員工名冊分頁內嵌用）；opts.emptyText 有給＝空名單也顯示該訊息（stats 獨立分頁用）。
function annivInit(jsonpFn, token, opts) {
  var emptyText = opts && opts.emptyText;
  jsonpFn('getAnniversaries', { token: token }).then(function (r) {
    var box = document.getElementById('anniv-box');
    if (!box) return;
    var rows = (r && r.ok && r.rows) || [];
    if (!rows.length) {
      if (emptyText) { box.innerHTML = '<div class="empty">' + annivEsc_((r && !r.ok && r.msg) || emptyText) + '</div>'; box.style.display = ''; }
      return;
    }
    box.innerHTML = '<div class="card" style="border-left:4px solid #b8860b">'
      + '<div style="font-weight:700;margin-bottom:6px">🎖 年資里程碑（' + r.year + ' 年度期滿）</div>'
      + rows.map(function (o) {
          return '<div style="font-size:15px;margin:2px 0">' + annivEsc_(o.name) + '（' + annivEsc_(o.unit) + '）滿 <b>'
            + o.years + '</b> 年・入社日 ' + annivEsc_(o.date) + '</div>';
        }).join('')
      + '</div>';
    box.style.display = '';
  });
}
function annivEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
