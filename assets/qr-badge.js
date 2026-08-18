/**
 * qr-badge.js — 報到 QR 的統一畫法（看板與同仁手機共用同一支）。
 *
 * 為何存在（2026-08-18）：這支原本叫 __qrCanvas，只住在 stats.html 裡。於是
 * **看板座位表上那顆 QR 有中央膠囊（logo＋活動名＋姓名），同仁手機上那顆是光禿禿的
 * 黑白格**——使用者一眼就看出兩者「不一致」。
 *
 * ⚠️ 兩顆 QR 掃出來的字串本來就一模一樣（實測同一人：
 * `CHK|midyear2026|10010|ZwSIpip…`，一字不差）。差的只有外觀。
 * 所以要修的是「畫法住在誰家」，不是重簽發碼——把它搬出來，兩邊只剩一份畫法可用。
 *
 * 用法：qrBadgeReady().then(function(){ el.appendChild(qrBadgeCanvas(code, name, actName)); });
 */

/** 動態載入一支腳本；window[flag] 已存在就跳過（index.html 是靜態載入 qrcode-gen 的）。 */
function __qbLoad(src, flag) {
  if (window[flag]) return Promise.resolve();
  return new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = function () { rej(new Error('元件載入失敗，請重試')); };
    document.body.appendChild(s);
  });
}

var LOGO_DATA = null;
/** logo 轉成 Image（畫 canvas 用）。取過一次就記著。 */
function __logo() {
  if (LOGO_DATA) return Promise.resolve(LOGO_DATA);
  return fetch('assets/logo-mark.svg').then(function (r) { return r.text(); }).then(function (t) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { LOGO_DATA = img; res(img); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t)));
    });
  });
}

/** 畫 QR 前要先備妥的東西：qrcode 產生器＋logo。兩頁都必須先 await 這支。 */
function qrBadgeReady() {
  return Promise.all([__qbLoad('assets/qrcode-gen.js', 'qrcode'), __logo()]);
}

/**
 * QR 畫布：中央膠囊＝logo（原比例）＋活動名（與 logo 同寬）＋姓名（大一級），文字灰階。
 * 糾錯等級固定 'H'（30%）——中央蓋掉一塊還掃得到，靠的就是它，不要調低。
 * @param {string} code 報到碼（CHK|活動|員編|HMAC）
 * @param {string} name 姓名
 * @param {string} actName 活動名
 * @param {Image=} logo 省略則用模組內快取的那張
 */
function qrBadgeCanvas(code, name, actName, logo) {
  if (logo === undefined) logo = LOGO_DATA;
  name = String(name == null ? '' : name);
  actName = String(actName == null ? '' : actName);
  var qr = qrcode(0, 'H'); qr.addData(code); qr.make();
  var n = qr.getModuleCount(), cell = 8, quiet = 24, size = n * cell + quiet * 2;
  var cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(quiet + c * cell, quiet + r * cell, cell, cell);

  var LW = Math.round(size * 0.165);                       // logo 寬（原比例縮放）
  var lh = logo ? Math.round(LW * (logo.height / logo.width)) : Math.round(LW * 1.03);
  var FONT = function (px) { return '700 ' + px + 'px -apple-system,"PingFang TC","Noto Sans TC",sans-serif'; };
  // 真實墨水寬度（粗體中文的 advance width 會低估）
  var inkW = function (txt, px) {
    ctx.font = FONT(px);
    var m = ctx.measureText(txt);
    var l = m.actualBoundingBoxLeft, r2 = m.actualBoundingBoxRight;
    return (isFinite(l) && isFinite(r2)) ? (l + r2) : m.width;
  };
  var BASE = 20;
  var sAct = LW / Math.max(inkW(actName, BASE), 1);        // 活動名寬＝logo 寬
  var sNm = (LW * 1.18) / Math.max(inkW(name, BASE), 1);   // 姓名比活動名大一級
  var hAct = BASE * sAct, hNm = BASE * sNm;
  var wAct = LW, wNm = LW * 1.18;
  var pad = Math.round(size * 0.03), gap = Math.round(size * 0.008);
  var capW = Math.ceil(Math.max(LW, wAct, wNm)) + pad * 2;
  var capH = Math.ceil(lh + gap + hAct + gap + hNm) + pad * 2;
  var cx = size / 2, cy = size / 2, rx = cx - capW / 2, ry = cy - capH / 2, rr = Math.round(size * 0.02);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(rx + rr, ry);
  ctx.arcTo(rx + capW, ry, rx + capW, ry + capH, rr);
  ctx.arcTo(rx + capW, ry + capH, rx, ry + capH, rr);
  ctx.arcTo(rx, ry + capH, rx, ry, rr);
  ctx.arcTo(rx, ry, rx + capW, ry, rr);
  ctx.closePath(); ctx.fill();

  var y = ry + pad;
  if (logo) { ctx.drawImage(logo, cx - LW / 2, y, LW, lh); y += lh + gap; }
  ctx.fillStyle = '#767676'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  [[actName, sAct, hAct], [name, sNm, hNm]].forEach(function (t, i) {
    ctx.save(); ctx.translate(cx, y); ctx.scale(t[1], t[1]);
    ctx.font = FONT(BASE); ctx.fillText(t[0], 0, 0); ctx.restore();
    y += t[2] + (i === 0 ? gap : 0);
  });
  return cv;
}
