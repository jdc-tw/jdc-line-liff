// 年資里程碑提示卡（board/stats 兩看板共用）：當年度年資逢 5 倍數的在職者；名單空就不顯示。
// 用法：頁面放 <div id="anniv-box" style="display:none"></div>，載入後呼叫 annivInit(jsonp, token)。
function annivInit(jsonpFn, token) {
  jsonpFn('getAnniversaries', { token: token }).then(function (r) {
    if (!r || !r.ok || !r.rows || !r.rows.length) return;
    var box = document.getElementById('anniv-box');
    if (!box) return;
    box.innerHTML = '<div class="card" style="border-left:4px solid #b8860b">'
      + '<div style="font-weight:700;margin-bottom:6px">🎖 年資里程碑（' + r.year + ' 年度期滿）</div>'
      + r.rows.map(function (o) {
          return '<div style="font-size:15px;margin:2px 0">' + annivEsc_(o.name) + '（' + annivEsc_(o.unit) + '）滿 <b>'
            + o.years + '</b> 年・入社日 ' + annivEsc_(o.date) + '</div>';
        }).join('')
      + '</div>';
    box.style.display = '';
  });
}
function annivEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
