/**
 * send-modal.js — 傳送狀態視窗（共用元件）。
 *
 * 為何存在（2026-08-21，使用者實測後指出）：「狀態說明的文字位置很不明顯」。
 * 當天 17:29 那一次三次呼叫、其中兩次被 hub 的冪等網攔下——
 * **看不到回饋就會再按一次**，那正是 2026-08-20 誤發事故的形狀。
 * 所以「傳送中」用擋住整個畫面的視窗，讓底下的按鈕**按不到**：
 * 防呆靠版面擋住，不靠使用者的自制力，也不只靠 disabled（那個沒有視覺重量）。
 *
 * ⚠️ **完全自足，不依賴任何頁面的 CSS。** stats.html 有一整組 CSS 變數與
 *    .btn-pri2，board.html **一個都沒有**（實測：--ink／--ink3／--bad／btn-pri2
 *    在 board.html 全部 0 命中）。沿用變數會讓它在 board.html 變成透明字。
 *    所以顏色一律寫死，取自 stats.html 的色票：
 *      #2c2c2b 主文字（--ink）／#9a9a96 弱文字（--ink3）
 *      #8f3040 例外（--r-dim）／#2f4858 動作藍（--b）
 *
 * ⚠️ **busy 視窗沒有關閉鍵、點背景也不關。唯一的出口是請求回來。**
 *    呼叫端必須保證「一定會回來」——liff 的 jsonp() 最後一段 catch 會把任何
 *    失敗（含逾時）轉成 {ok:false}，所以 .then 一定執行。用在別的呼叫方式上
 *    之前，先確認同一件事成立，否則使用者會被鎖在畫面上。
 */
var _SENDMODAL = null;

function sendModalClose() {
  if (_SENDMODAL && _SENDMODAL.parentNode) _SENDMODAL.parentNode.removeChild(_SENDMODAL);
  _SENDMODAL = null;
}

/**
 * @param {'busy'|'done'|'err'} state busy＝擋住畫面且不可關閉
 * @param {string} text 換行用 \n；一律以 textContent 寫入，不吃 HTML
 */
function sendModal(state, text) {
  sendModalClose();
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;'
    + 'display:flex;align-items:center;justify-content:center;padding:20px';
  var card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:4px;padding:22px 20px;'
    + 'max-width:320px;width:100%;text-align:center;'
    + 'font-family:inherit;box-shadow:0 8px 28px rgba(0,0,0,.18)';
  var msg = document.createElement('div');
  msg.style.cssText = 'font-size:15.5px;line-height:1.55;white-space:pre-line;color:'
    + (state === 'err' ? '#8f3040' : '#2c2c2b');
  msg.textContent = text;
  card.appendChild(msg);
  if (state === 'busy') {
    var sub = document.createElement('div');
    sub.style.cssText = 'margin-top:12px;font-size:13px;color:#9a9a96';
    sub.textContent = '請不要關閉頁面';
    card.appendChild(sub);
  } else {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = '知道了';
    b.style.cssText = 'margin-top:16px;width:100%;padding:11px 14px;border:0;'
      + 'border-radius:3px;background:#2f4858;color:#fff;font-size:14.5px;'
      + 'font-weight:600;cursor:pointer;font-family:inherit';
    b.onclick = sendModalClose;
    card.appendChild(b);
    ov.onclick = function (e) { if (e.target === ov) sendModalClose(); };
  }
  ov.appendChild(card);
  document.body.appendChild(ov);
  _SENDMODAL = ov;
  if (state !== 'busy') card.querySelector('button').focus();
}
