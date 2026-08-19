// 年資里程碑（board/stats 兩看板共用）：當年度年資逢 5 倍數的在職者。
// 用法：頁面放 <div id="anniv-box">…</div>，載入後呼叫 annivInit(jsonp, token[, opts])。
// 預設名單空＝整塊不顯示（board 員工名冊分頁內嵌用）；opts.emptyText 有給＝空名單也顯示該訊息（stats 獨立分頁用）。
function annivInit(jsonpFn, token, opts) {
  var emptyText = opts && opts.emptyText;
  var painted = false;
  // 秒顯（2026-08-20）：這一支本來只寫進快取、沒有任何地方讀回來——姓名在磁碟躺七天卻零好處。
  // 補上讀取端之後，重開頁時這張卡跟名冊列表同時出現，不會晚一步才「長出來」。
  // typeof 防護：本檔在 board.html 的 <script> 順序中排在 board-cache.js **之前**，
  // 而且將來若有頁面單獨引用它、沒有快取模組，直接取用會 ReferenceError 整段掛掉。
  if (typeof CACHE_READY !== 'undefined' && typeof cacheGet === 'function' && typeof N !== 'undefined') {
    CACHE_READY.then(function () {
      var c = cacheGet(N.anniversaries);
      if (c) { annivPaint_(c.value, emptyText); painted = true; }
    });
  }
  jsonpFn('getAnniversaries', { token: token }).then(function (r) {
    // 失敗時只有「畫面上還沒有東西」才蓋上去，否則會把剛秒顯的內容抹掉
    if ((r && r.ok) || !painted) annivPaint_(r, emptyText);
  });
}
// 只負責畫。成功與失敗兩種輸入都收，快取與網路兩條路才能共用同一份繪製邏輯。
function annivPaint_(r, emptyText) {
  {
    var box = document.getElementById('anniv-box');
    if (!box) return;
    var rows = (r && r.ok && r.rows) || [];
    if (!rows.length) {
      if (emptyText) { box.innerHTML = '<div class="empty">' + annivEsc_((r && !r.ok && r.msg) || emptyText) + '</div>'; box.style.display = ''; }
      return;
    }
    // 2026-08-16 改版（使用者逐項指定）：
    // ① 拿掉 🎖 與 border-left:4px solid #b8860b（他說的那條「奇怪的黃色直線」）
    // ② 不再自己包一層 .card——呼叫端（stats/board）已經放在卡片裡，內層再包就是卡中卡
    // ③ 改標籤語彙：名字大、單位與入社日縮成小標籤（淺底淡字）
    // ④ 以年資分組，由高到低——這份名單的用途就是「今年誰滿幾年」，年資才是主鍵，不是姓名
    // 樣式寫成 inline：這支 board.html 也在用，那頁沒有 stats.html 的 class，
    // 靠 class 會在其中一頁變成裸文字（而且不會報錯）。
    var TAG = 'display:inline-block;font-size:11px;line-height:1.75;padding:0 6px;'
      + 'border-radius:2px;background:#f1f1ef;color:#6b6b68;vertical-align:2px;white-space:nowrap';
    var groups = {}, order = [];
    rows.forEach(function (o) {
      var y = Number(o.years) || 0;
      if (!groups[y]) { groups[y] = []; order.push(y); }
      groups[y].push(o);
    });
    order.sort(function (a, b) { return b - a; });          // 年資高的在前
    box.innerHTML = '<div style="font-size:12px;color:#9a9a96;margin-bottom:2px">'
      + annivEsc_(r.year) + ' 年度期滿</div>'
      + order.map(function (y) {
          return '<div style="font-size:12px;color:#9a9a96;font-weight:600;letter-spacing:.05em;'
            + 'margin:12px 0 2px">滿 ' + y + ' 年　' + groups[y].length + ' 人</div>'
            + groups[y].map(function (o) {
                return '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;'
                  + 'padding:5px 0;border-bottom:1px solid #f4f4f2">'
                  + '<span style="font-size:15.5px;font-weight:600;color:#2c2c2b">'
                  + annivEsc_(o.name) + '</span>'
                  + '<span style="' + TAG + '">' + annivEsc_(o.unit) + '</span>'
                  + '<span style="' + TAG + '">' + annivEsc_(o.date) + '</span></div>';
              }).join('');
        }).join('');
    box.style.display = '';
  }
}
function annivEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
