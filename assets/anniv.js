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
    // 2026-08-16 改版：拿掉 🎖 與 border-left:4px solid #b8860b（使用者看到的那條「奇怪的黃色直線」），
    // 也不再自己包一層 .card ——呼叫端（stats/board）已經把它放在卡片裡，內層再包一張就是卡中卡。
    // 年度改成標題旁的小字，不另起一行搶版面。
    box.innerHTML = '<div style="font-size:12px;color:#9a9a96;margin-bottom:6px">'
      + annivEsc_(r.year) + ' 年度期滿</div>'
      + rows.map(function (o) {
          return '<div style="font-size:14.5px;margin:3px 0">' + annivEsc_(o.name)
            + '<span style="color:#9a9a96;font-size:12.5px">（' + annivEsc_(o.unit) + '）</span>滿 '
            + o.years + ' 年<span style="color:#9a9a96;font-size:12.5px">・'
            + annivEsc_(o.date) + '</span></div>';
        }).join('');
    box.style.display = '';
  });
}
function annivEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
