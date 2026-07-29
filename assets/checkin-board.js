function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function renderBoardHtml(s) {
  var unit = Object.keys(s.byUnit).map(function(u){
    var x=s.byUnit[u]; return '<div class="u">'+esc(u)+'：'+x.arrived+'/'+x.total+'</div>';
  }).join('');
  var na = s.notArrivedList.map(function(p){return '<li>'+esc(p.name)+'（'+esc(p.unit)+'）</li>';}).join('');
  var st = Object.keys(s.byStation).map(function(k){return esc(k)+' '+s.byStation[k];}).join('・');
  var walk = s.walkins > 0 ? '（含臨時 '+s.walkins+'）' : '';
  return '<div class="big">已到 '+s.arrived+' / '+s.total+walk+'　未到 '+s.notArrived+'</div>'
    + '<div class="st">'+st+'</div><div class="units">'+unit+'</div>'
    + '<details><summary>未到名單（'+s.notArrived+'）</summary><ul>'+na+'</ul></details>';
}
if (typeof module !== 'undefined') module.exports = { renderBoardHtml };
