/**
 * tpl-editor.js — 範本編輯器（鏡像層＋佔位符自動補完＋可選的 emoji palette）。
 *
 * **這個檔是從 stats.html 搬出來的**（2026-08-29），不是新寫的。
 * 搬出來的理由：報到碼通知、資深員工通知、福委會通知三個編輯器要共用一份，
 * 否則 emoji 得加三次、XSS 跳脫得驗三次，而三份一定會漂移。
 *
 * 🔴 **`paintMirror` / `phPopup` / `phList` 的簽章與搬動前逐字相同**
 *    ——stats.html 的六個呼叫點一個字都不用改。這是刻意的：
 *    行為不變的重構要讓 diff 小到看得完。
 *
 * 雙環境：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 * （assets/*.js 沒有自動 shim，檔尾那段 export 是手寫的，形狀照抄 messages-view.js。）
 */

/**
 * HTML 跳脫。
 *
 * 🔴 **刻意叫 `tplEsc` 不叫 `esc`**：
 *    `assets/stats-view.js` 已經定義了一個全域 `esc`，而它**只跳脫 `<`**；
 *    `stats.html` 在 inline script 之前就載入它，全頁有 68 處呼叫、
 *    `stats-view.js` 自己另有 6 處。本檔若也宣告 `function esc(...)`，
 *    **後載入的會覆寫前一個** ⇒ 那 74 處的跳脫行為全部改變，
 *    而這與範本編輯器毫無關係——「行為不變的重構」當場不成立。
 */
function tplEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── 佔位符 ──────────────────────────────────────────────────────────────
   一處定義、三處共用（清單顯示／點擊插入／打「{」跳選單／鏡像上底色）。
   使用者要求：「到底有多少佔位符，都請一次提供給需要佔位符的地方」。 */
var PH_SETS = {
  bc: [{ k: '姓名' }, { k: '單位' }, { k: '活動名' }, { k: '日期' }, { k: '桌次' },
       { k: '連結', why: '不能刪，沒有它同仁點不到報到碼' }],
  sn: [{ k: '姓名' }, { k: '單位' }, { k: '年資' }, { k: '年度' }, { k: '入社日' }]
};
function phList(set) { return PH_SETS[set] || []; }

/** 註冊一組新的佔位符（welfare 用）。既有兩組刻意留在上面當預設，diff 才看得出沒被動。 */
function registerPhSet(name, list) { PH_SETS[name] = list; }

/** 哪幾組要畫 emoji。一期只有 welfare；二期 bc 與 sn 才 enableEmoji。 */
var EMOJI_SETS = {};
function enableEmoji(setName, palette) { EMOJI_SETS[setName] = palette || true; }

/** 只接受 productId 為十六進位、emojiId 為三位數字。不合格式的當普通文字。 */
var MIRROR_EMOJI_RE = /\[\[e:([0-9a-f]+):(\d{3})\]\]/g;

/**
 * 鏡像層的 HTML。**跳脫必須在最前面**——若對原文做字串 replace 之後才塞 innerHTML，
 * 範本裡的 `<img src=x onerror=...>` 會在 campaign.jdc-corpn.com.tw 上執行，
 * 而網址列裡就有 token。這是儲存型 XSS，每次載入該範本都會觸發。
 *
 * 這個順序是**從 stats.html 搬過來的、已經在線上跑過的**——
 * 抽出比重寫安全的理由之一就在這裡。
 *
 * 注意：跳脫**先做**，所以下面比對的是已跳脫的字串。
 * `{姓名}` 與 emoji 標記 `[[e:...]]` 都只含不會被跳脫的字元，比對仍然成立；
 * 而 `{<b>}` 這種含角括號的假佔位符跳脫後就對不上——**那正是想要的**。
 */
function renderMirrorHtml(text, set) {
  var known = {};
  phList(set).forEach(function (p) { known[p.k] = 1; });
  var html = tplEsc(text).replace(/\{([^{}\n]{1,12})\}/g, function (m, k) {
    return known[k] ? '<mark>' + m + '</mark>' : m;   // 不認得的不上色＝一眼看出打錯字
  });
  if (!EMOJI_SETS[set]) return html;                  // 沒開 emoji 的組，行為與搬動前逐字相同
  MIRROR_EMOJI_RE.lastIndex = 0;
  return html.replace(MIRROR_EMOJI_RE, function (m, pid, eid) {
    // pid/eid 已被 regex 鎖死在 [0-9a-f] 與 \d，拼不出引號或角括號。
    // ⚠️ **若日後放寬那個字元集，這段就必須改用 createElement。**
    return '<img class="emo" alt="emoji ' + eid + '" src="'
         + 'https://stickershop.line-scdn.net/sticonshop/v1/sticon/'
         + pid + '/iPhone/' + eid + '.png">';
  });
}

/** 鏡像圖層：把 {…} 包成 <mark> 上底色。textarea 本身不能上色，只能疊一層同規格的 div。 */
function paintMirror(taId, mirrorId, set) {
  var ta = document.getElementById(taId), mi = document.getElementById(mirrorId);
  if (!ta || !mi) return;
  mi.innerHTML = renderMirrorHtml(ta.value, set) + '\n';  // 補一行，讓最後一行換行時高度跟得上
  mi.scrollTop = ta.scrollTop;
}

/**
 * 把佔位符畫成一排可點的碼標；點一下插進游標處。
 * ⚠️ 用 mousedown/touchstart ＋ preventDefault，不用 click：
 *    click 之前 textarea 已經失焦，行動裝置上游標位置會跑掉，插到的地方不是你按之前的位置。
 */
function renderPhs(set,boxId,taId){
  var box=document.getElementById(boxId);if(!box)return;
  box.innerHTML='<span class="ph-lead">點一下插入，或直接打「{」</span>';
  phList(set).forEach(function(p){
    var b=document.createElement('button');
    b.type='button';b.className='ph';
    b.textContent='{'+p.k+'}';
    if(p.why)b.title=p.why;
    var ins=function(e){e.preventDefault();insertAtCursor(taId,'{'+p.k+'}');};
    b.addEventListener('mousedown',ins);
    b.addEventListener('touchstart',ins,{passive:false});
    box.appendChild(b);
  });
}
function insertAtCursor(taId,text){
  var ta=document.getElementById(taId);if(!ta)return;
  var s=ta.selectionStart,e=ta.selectionEnd;
  if(s==null){s=e=ta.value.length;}                 // 從沒點過欄位時插到最後
  ta.value=ta.value.slice(0,s)+text+ta.value.slice(e);
  ta.focus();
  ta.selectionStart=ta.selectionEnd=s+text.length;  // focus 之後才設，否則會被 focus 重置到尾端
  ta.dispatchEvent(new Event('input'));
}
/**
 * 打出「{」（半形或全形）就跳出選單，選了自動補完整個佔位符。
 * 選單固定貼在欄位正下方、橫向一排——位置可預期，也不會蓋住剛打的字。
 * 全形「｛」也接：中文輸入法下打出來的多半是全形，只認半形等於這個功能對中文使用者不存在。
 */
function phPopup(taId,set){
  closePhPop();
  var ta=document.getElementById(taId);
  if(!ta)return;
  var s=ta.selectionStart,ch=ta.value.charAt(s-1);
  if(ch!=='{'&&ch!=='｛')return;
  var pop=document.createElement('div');
  pop.className='ph-pop';pop.id='ph-pop';
  phList(set).forEach(function(p){
    var b=document.createElement('button');
    b.type='button';b.textContent=p.k;
    var pick=function(e){
      e.preventDefault();
      var at=ta.selectionStart;
      ta.value=ta.value.slice(0,at-1)+'{'+p.k+'}'+ta.value.slice(at);   // 吃掉剛打的那個括號
      closePhPop();
      ta.focus();
      ta.selectionStart=ta.selectionEnd=at+p.k.length+1;
      ta.dispatchEvent(new Event('input'));
    };
    b.addEventListener('mousedown',pick);
    b.addEventListener('touchstart',pick,{passive:false});
    pop.appendChild(b);
  });
  (ta.closest('.tpl-wrap')||ta.parentNode).appendChild(pop);
  setTimeout(function(){document.addEventListener('click',closePhPop,{once:true});},0);
}
function closePhPop(){var p=document.getElementById('ph-pop');if(p)p.remove();}

/**
 * 本檔宣告的全域名稱。**放在 module.exports 之前**（全域衝突檢查會讀它；
 * 放在 export 之後會拿到 undefined，那條檢查呼叫 .filter() 時直接炸）。
 * 加新的頂層 function／var 時要同步加進來——有一條測試用 deepStrictEqual 比對。
 *
 * 🔴 **`GLOBALS_DECLARED` 自己也是一個頂層 var，所以它自己也要列進去。**
 */
var GLOBALS_DECLARED = ['GLOBALS_DECLARED', 'tplEsc', 'PH_SETS', 'phList',
  'registerPhSet', 'EMOJI_SETS', 'enableEmoji', 'MIRROR_EMOJI_RE', 'renderMirrorHtml',
  'paintMirror', 'renderPhs', 'insertAtCursor', 'phPopup', 'closePhPop'];

if (typeof module !== 'undefined' && module.exports) {
  // 🔴 **只匯出這個 commit 裡已經存在的東西。** renderEmojiPalette 還沒寫——
  //    現在寫進來的話，module.exports 求值時就是 ReferenceError。
  module.exports = {
    tplEsc: tplEsc, phList: phList, registerPhSet: registerPhSet,
    enableEmoji: enableEmoji, renderMirrorHtml: renderMirrorHtml,
    insertAtCursor: insertAtCursor, PH_SETS: PH_SETS,
    MIRROR_EMOJI_RE: MIRROR_EMOJI_RE, GLOBALS_DECLARED: GLOBALS_DECLARED,
  };
}
