/**
 * messages-view.js — 訊息紀錄頁的共用渲染（messages.html 用）。
 * 純函式、無 DOM 依賴：呼叫端自己把回傳的字串塞進自己的節點。
 * 雙環境：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 *
 * 後端是 jdc-line-hub（獨立 GAS 專案），不是本站其他頁用的 line-platform。
 *
 * ⚠️ 這支的 esc() 比 assets/stats-view.js 的嚴格：那支只換 `<`，這支換
 *    & < > " 四個。差異是刻意的——本頁渲染的「來源」欄由**呼叫端**提供
 *    （line-platform 或日後的第二個平台），不是我方產生的字串，屬於
 *    不可信輸入。既有頁面不動，避免無謂的行為變更。
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
  });
}

/** 依欄名取值。找不到那一欄就回空字串，不用固定索引。 */
function col(header, row, name) {
  var i = header.indexOf(name);
  return i < 0 ? '' : String(row[i] == null ? '' : row[i]);
}

/**
 * 紀錄起始日的說明文字。
 * 沒設就明白說沒設——留白會讓「還沒開始記」看起來像「這段期間沒發過」。
 * @returns {{text:string, warn:boolean}}
 */
function sinceText(logSince) {
  if (logSince) {
    return { text: '紀錄自 ' + logSince + ' 起。在那之前發送的訊息沒有紀錄。', warn: false };
  }
  return { text: '⚠️ 紀錄起始日未設定，無法判斷這頁涵蓋哪一段期間。', warn: true };
}

/**
 * 依批次聚合成摺疊區塊。
 * 一次廣播 137 則平鋪的話，看不出那是同一次操作。
 *
 * ⚠️ 每一個進到 HTML 的值都必須經過 esc()，**批次標題那行也是**。
 *    「來源」與「發送時間」都存在試算表裡、由呼叫端寫入，是不可信輸入。
 * @returns {string} HTML
 */
function batchesHtml(header, rows) {
  var groups = {}, order = [];
  (rows || []).forEach(function (r) {
    var b = col(header, r, '批次') || '(無批次)';
    if (!Object.prototype.hasOwnProperty.call(groups, b)) { groups[b] = []; order.push(b); }
    groups[b].push(r);
  });

  return order.map(function (b) {
    var g = groups[b];
    var fail = g.filter(function (r) { return col(header, r, '結果') !== '成功'; }).length;
    var head = esc(col(header, g[0], '發送時間')) + '　' + esc(col(header, g[0], '來源'))
             + '　' + g.length + ' 則　成功 ' + (g.length - fail)
             + (fail ? '　<span class="fail">失敗 ' + fail + '</span>' : '');
    var body = g.map(function (r) {
      return '<tr><td>' + esc(col(header, r, '對象姓名') || col(header, r, '對象UserID')) + '</td>'
           + '<td>' + esc(col(header, r, '對象單位')) + '</td>'
           + '<td>' + esc(col(header, r, '訊息型別')) + '</td>'
           + '<td>' + esc(col(header, r, '訊息內容')) + '</td>'
           + '<td>' + esc(col(header, r, '附件')) + '</td>'
           + '<td>' + esc(col(header, r, '結果')) + ' ' + esc(col(header, r, '錯誤')) + '</td></tr>';
    }).join('');
    return '<details class="batch"><summary>' + head + '</summary><div class="wrap"><table>'
         + '<tr><th>對象</th><th>單位</th><th>型別</th><th>內容</th><th>附件</th><th>結果</th></tr>'
         + body + '</table></div></details>';
  }).join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc: esc, col: col, sinceText: sinceText, batchesHtml: batchesHtml };
}
