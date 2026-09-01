/**
 * stats-view.js — 活動出席統計的共用渲染（stats.html 管理版 / attend.html 唯讀版共用）
 * 純函式、無 DOM 依賴：呼叫端自己把回傳的字串塞進自己的節點。
 * 雙環境：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 */

function esc(s){return (s==null?'':s).toString().replace(/</g,'&lt;');}

/**
 * 把值放進 **HTML 屬性裡的 JavaScript 字串**（`onclick="fn('…')"` 那種）。
 *
 * 🔴 **與 `esc()` 的分工：兩支服務兩個不同的問題，不可以互換、也不可以疊用。**
 *   `esc(v)`        → 值要顯示成**文字內容**（`<span>…</span>`）
 *   `escAttrJs(v)`  → 值要當成**屬性裡那段 JS 的字串常值**
 * 這兩個情境的正確逸出方式**互相衝突**（見下），所以一把尺量不了兩個問題。
 * ⚠️ 呼叫端**只呼叫其中一支**，不要寫成 `esc(escAttrJs(x))`——疊起來就又黏成一把尺，
 * 而「一把尺量兩個問題」正是這個缺陷的成因。這支自己涵蓋 `<`。
 *
 * 為何存在（2026-09-02）：`stats.html` 有 23 處把值拼進 `onclick`，而 `esc()` 只逸出
 * `<`。值裡只要有一個單引號，那顆按鈕點下去就毫無反應——**畫面完全正常**，
 * console 有 SyntaxError 而沒有人在看。實測會壞的有四種：
 * 單引號、雙引號、結尾反斜線、換行。其中**雙引號會提早結束 HTML 屬性**，
 * 後面的內容被當成新屬性解析——那不只是按鈕失效，是屬性注入。
 *
 * 🔴 **兩個字元要用兩種相反的機制，這是實測出來的（真 Chromium）：**
 *   單引號 → **反斜線** `\'`      （HTML 實體 `&#39;` 無效：瀏覽器會先解碼，解完就變成單引號）
 *   雙引號 → **HTML 實體** `&quot;`（反斜線無效：`"` 會先結束 HTML 屬性，輪不到 JS 看它）
 *
 * 🔴 **順序有講究**：`&` 要最先（否則資料裡本來就有的 `&#39;` 會被瀏覽器解成單引號），
 * 接著反斜線（否則後面加的反斜線會被自己再逸出一次），最後才是引號與其他。
 */
function escAttrJs(s) {
  return (s == null ? '' : s).toString()
    .replace(/&/g, '&amp;')      // 先做：擋掉資料裡本來就有的 &#39; 這種寫法
    .replace(/\\/g, '\\\\')        // 再做：後面加的反斜線不可以被自己再逸出一次
    .replace(/'/g, "\\'")        // 單引號走反斜線（實體會被瀏覽器先解碼）
    .replace(/"/g, '&quot;')     // 雙引號走實體（反斜線來不及，" 會先結束 HTML 屬性）
    .replace(/\r\n?|\n/g, '\\n')   // 屬性值裡的真換行 = JS 字串常值裡的換行 = SyntaxError
    .replace(/</g, '&lt;');      // 自己涵蓋，呼叫端才不必再套一層 esc
}

// 依單位收納（保留原順序）；bodyFn(items) 決定每組內容。單位旁顯示人數。
/**
 * 依單位分組收納。
 * @param {Function} bodyFn 展開後的內容
 * @param {Function} [sumFn] 選填：回一段接在人數後面的 HTML（本組的補充統計）。
 *   2026-08-16 加，給「回覆明細」在每個單位標出不參加人數用。
 *   刻意做成選填——不參加／未填／未綁定那幾張清單裡整組都是同一種人，
 *   再標一次只是噪音。
 * 樣式寫 inline：這支 board.html 也在用，那頁沒有 stats.html 的 .tag class。
 */
function groupHtml(arr, bodyFn, sumFn){
  if(!arr.length) return '<div class="empty">（無）</div>';
  var m={},order=[];
  arr.forEach(function(o){if(!m[o.unit]){m[o.unit]=[];order.push(o.unit);}m[o.unit].push(o);});
  return order.map(function(u){
    return '<details class="grp"><summary>'+esc(u)+'<span class="cnt">'+m[u].length+' 人</span>'
      +(sumFn?sumFn(m[u]):'')
      +'</summary><div class="body">'+bodyFn(m[u])+'</div></details>';
  }).join('');
}
/** 小標籤（給 sumFn 用）。tone: '' 中性／'r' 紅。 */
function groupTag_(text, tone){
  var bg = tone==='r' ? '#fbeef1' : '#f1f1ef', fg = tone==='r' ? '#8f3040' : '#6b6b68';
  return '<span style="font-size:11px;line-height:1.75;padding:0 6px;border-radius:2px;'
    + 'background:'+bg+';color:'+fg+';font-weight:400;margin-left:6px;white-space:nowrap">'
    + esc(text) + '</span>';
}
// 純名字（橫排流式）
function listHtml(arr){
  return groupHtml(arr, function(items){
    return '<div class="names">'+items.map(function(o){return '<span>'+esc(o.name)+'</span>';}).join('')+'</div>';
  });
}
// 意見清單：每人一列，姓名＋參加/不參加標記＋意見
function opinionsHtml(arr){
  return groupHtml(arr, function(items){
    return items.map(function(o){
      var att=o.attend==='參加' ? '<span class="att att-y">參加</span>' : '<span class="att att-n">不參加</span>';
      return '<div class="p"><span class="n">'+esc(o.name)+'</span>'+att+'<span class="op">'+esc(o.opinion)+'</span></div>';
    }).join('');
  });
}

/**
 * 把 getActivityStats 的回應算成可直接塞進 DOM 的字串。
 * @param {Object} r  getActivityStats 回應
 * @param {Object} [opts] { fallbackMsg }
 * @returns {{ok:boolean, actId:string, titleText:string, metaText:string, bodyHtml:string}}
 */
function renderStatsHtml(r, opts){
  opts = opts || {};
  if(!r || !r.ok){
    return { ok:false, actId:'', titleText:'', metaText:'',
      bodyHtml:'<div class="empty">'+esc((r&&r.msg)||opts.fallbackMsg||'連結無效或已失效。')+'</div>' };
  }
  var a=r.activity, c=r.counts;
  var noReply=c.boundNoReply+c.notBound;
  return {
    ok:true,
    actId: a.id||'',
    titleText: a.name||opts.fallbackTitle||'',
    metaText: [a.eventDate?'活動日期：'+a.eventDate:'', a.deadlineText?'回覆截止：'+a.deadlineText:'',
               '狀態：'+a.status, '（'+r.who+'）'].filter(Boolean).join('　'),
    bodyHtml:
      '<div class="card"><div class="grid">'
        +'<div><div class="num green">'+c.attend+'</div><div class="cap">參加</div></div>'
        +'<div><div class="num red">'+c.absent+'</div><div class="cap">不參加</div></div>'
        +'<div><div class="num grey">'+noReply+'</div><div class="cap">未填</div></div>'
      +'</div><div class="sub">全員 '+c.total+'・已回覆 '+c.replied+'・葷 '+c.meat+'／素 '+c.veg+'</div>'
      // extraAttend＝母數外但特許填答的留停者（見 jdc-line-gas stats.js computeActivityStats）。
      // 「參加」數已含他們、但「已回覆」分母刻意不含 ⇒ 兩數對不上時要講清楚原因，不然像算錯。
      // 為 0 或欄位缺席（舊快取沒有這欄）整段不顯示，比照本卡三段人數的既有慣例。
      +(c.extraAttend?'<div class="sub">其中留停 '+c.extraAttend+' 人為特許填答（不列入回覆率分母）</div>':'')
      +'</div>'
      +'<div class="sec">意見（'+(r.opinions||[]).length+'）— 參加與不參加者填的意見</div>'+opinionsHtml(r.opinions||[])
      +'<div class="sec">不參加（'+c.absent+'）</div>'+listHtml(r.absentList)
      +'<div class="sec">已綁定未填（'+c.boundNoReply+'）— 催填問卷連結即可</div>'+listHtml(r.boundNoReply)
      +'<div class="sec">未綁定（'+c.notBound+'）— 要先完成身分綁定才能填</div>'+listHtml(r.notBound),
  };
}

/**
 * 決定進頁要顯示哪一場活動。listActivities 的 rows 是表列順序（最後一筆＝最新建立）。
 * 規則：網址指定 > 最新的開放中 > 最新建立的一場（不論開關）> 空。
 * 第三條是「活動關掉後仍看得到統計」的落點。
 * @param {Array} rows listActivities 回傳的 rows
 * @param {string} urlAct 網址上的 ?act=
 * @returns {string} 活動ID；沒有可顯示的活動回 ''
 */
function pickDefaultActivity(rows, urlAct){
  if(urlAct) return String(urlAct);
  if(!rows || !rows.length) return '';
  var openId='';
  for(var i=0;i<rows.length;i++){
    if(rows[i].status==='開放' && rows[i].open) openId=String(rows[i].id);
  }
  if(openId) return openId;
  return String(rows[rows.length-1].id);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc: esc, escAttrJs: escAttrJs, groupHtml: groupHtml, listHtml: listHtml,
    opinionsHtml: opinionsHtml, renderStatsHtml: renderStatsHtml, pickDefaultActivity: pickDefaultActivity };
}
