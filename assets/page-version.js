/**
 * 看板頁尾的版本標示＋「抓最新版」連結（2026-08-24 使用者要求）。
 *
 * 為什麼存在：GitHub Pages 的 HTML 與 assets 都有 max-age=600 的快取，
 * 改版後使用者重新整理最多要等 10 分鐘才拿得到新版，而且畫面上看不出
 * 自己拿到的是哪一版。這支在頁尾放一行小字：部署時刻＋一個連結，
 * 點了就把本頁 HTML 與同源 assets 全部以 cache:'reload' 重抓（強制略過
 * HTTP 快取、同時覆寫快取條目），再重新載入頁面。
 *
 * 版本時刻＝document.lastModified（伺服器 Last-Modified 標頭，就是這份
 * HTML 部署到 Pages 的時間）。不用另建版本檔或改建置流程——原生機制就是原型。
 *
 * 掛法：各看板頁在 </body> 前加 <script src="assets/page-version.js" defer></script>。
 * 刻意不掛的頁：wall.html（投影幕，版面要純淨）、index.html／verify.html（同仁
 * 入口與驗證頁，不是看板）、staff.html／admin.html（工具頁）。
 */
(function () {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function refresh(link) {
    link.textContent = '抓取中…';
    // 本頁 HTML＋所有同源 script/樣式，全部 cache:'reload' 重抓。
    // reload 模式會略過快取直達伺服器，並用新回應覆寫快取條目，
    // 所以接下來的 location.reload() 拿到的一定是剛抓的那份。
    var urls = [location.href];
    var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    for (var i = 0; i < nodes.length; i++) {
      var u = nodes[i].src || nodes[i].href;
      if (u && u.indexOf(location.origin) === 0) urls.push(u);
    }
    var jobs = urls.map(function (u) {
      return fetch(u, { cache: 'reload', credentials: 'omit' }).catch(function () {});
    });
    // 全數完成或逾時（8 秒）都重載——連不上伺服器時 reload 也只會拿快取，不會更糟
    Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, 8000); })])
      .then(function () { location.reload(); });
  }

  function mount() {
    if (document.getElementById('pgver')) return;
    var bar = document.createElement('div');
    bar.id = 'pgver';
    // 抄各看板自己的變數（--ink2＝次要文字色），沒有就退灰
    bar.style.cssText = 'margin:20px 0 10px;text-align:center;font-size:11px;'
      + 'color:var(--ink2,#9a938b);-webkit-font-smoothing:antialiased;';
    var t = fmt(new Date(document.lastModified));
    bar.appendChild(document.createTextNode('版本 ' + (t || '未知') + '　'));
    var a = document.createElement('a');
    a.href = 'javascript:void 0';
    a.textContent = '抓最新版';
    a.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer;';
    a.addEventListener('click', function (e) { e.preventDefault(); refresh(a); });
    bar.appendChild(a);
    document.body.appendChild(bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
