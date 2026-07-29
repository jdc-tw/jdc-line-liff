/** 我的獎金卡純渲染（index.html pass 區塊用·node 可測）。 */
function renderLotteryCard(d) {
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function money(n){return Number(n||0).toLocaleString('zh-TW');}
  if (!d || !d.wins) {
    return '<div class="lot-none">🎰 尚未中獎，好運在後頭！</div>';
  }
  var badge = { '已領獎':'✅', '待確認':'🕓', '棄權':'✖', '作廢':'✖' };
  var rows = (d.rounds || []).map(function (r) {
    return '<li>' + esc(r.round) + '｜' + money(r.amount) + ' 元｜'
      + (badge[r.status] || '') + esc(r.status) + '</li>';
  }).join('');
  var pending = d.pendingTotal > 0
    ? '<div class="lot-pending">另有待確認 ' + money(d.pendingTotal) + ' 元</div>' : '';
  return '<div class="lot-head">全場第 ' + Number(d.rank) + ' 名｜中獎 ' + Number(d.wins)
    + ' 次｜累積 <b>' + money(d.total) + ' 元</b></div>'
    + '<ul class="lot-rounds">' + rows + '</ul>' + pending
    + '<div class="lot-note">累積與名次以「已領獎」為準，與現場大螢幕一致</div>';
}
if (typeof module !== 'undefined') module.exports = { renderLotteryCard };
