/**
 * 產生 LINE 訊息紀錄（messages.html）UI 驗收用的測試頁。
 *
 * 手法沿用 wall-build-testpage.js：把 messages.html 原封複製，只在 <head> 最前面插一段
 * script 覆寫 window.fetch，讓 hub 的 listMessageLog 回一份假紀錄。
 * **只換網路層，不碰 DOM**——頁面仍走自己的啟動流程，所以語法錯誤、初始化早退、
 * CSS 破版這些都還驗得到。
 *
 * 假資料不是手寫的：直接叫 hub **真正的** buildRow / LOG_HEADER 產生，
 * 形狀保證與線上一致（手寫 fixture 曾經是「測了半天測的是自己捏的形狀」的來源）。
 *
 * 用法：
 *   node tests/manual/msg-build-testpage.js
 *   cd <輸出目錄> && python3 -m http.server 8897
 *   開 http://localhost:8897/messages-test.html?t=dummy
 *
 * 產物全在輸出目錄（repo 一個檔都不多）：測試頁 ＋ 一個指回 repo assets/ 的 symlink。
 * 為什麼要 http 不用 file://：playwright MCP 擋 file: 協定。
 */
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'msg-ui');
const GAS = process.argv[3] ||
  path.join(__dirname, '..', '..', '..', 'jdc-line-hub', 'hub', 'gateway.js');

if (!fs.existsSync(GAS)) {
  console.error('找不到 hub gateway.js：' + GAS +
    '\n（第二個參數可指定路徑。刻意不做 fallback——手寫假資料會讓驗收驗到錯的形狀。）');
  process.exit(1);
}
const { buildRow, LOG_HEADER } = require(GAS);

/* 姓名要像真的姓名。wall 的測試頁曾把人名取成「工務1」，結果看起來像單位名，
   使用者以為程式顯示錯了——其實是測資取名的問題。 */
const 姓 = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高'.split('');
const 名 = ['彥廷', '宗翰', '雅婷', '怡君', '家豪', '育誠', '佩珊', '俊宏', '詩涵', '冠宇',
  '思穎', '建良', '美玲', '志偉', '淑芬', '孟儒', '品妤', '柏翰', '昱安', '欣怡'];
/* 單位名長短不一：真實名冊就是這樣，版面要撐得住最長的那個。
   只用「工務部」這種三字名測，名單那一列的換行問題永遠不會現形。 */
const UNITS = ['工務管理組', '經營企劃管理室', '業務部', '安全衛生管理部',
  '資訊系統管理課', '技術部', '台中營業所'];

function person(i) {
  return {
    to: 'U' + String(i).padStart(6, '0') + 'abcdef',
    name: 姓[i % 姓.length] + 名[(i * 7) % 名.length],
    unit: UNITS[i % UNITS.length],
  };
}

/**
 * 一批。scenarios 涵蓋每一種「卡面長得不一樣」的情況——
 * 少一種就會有一種版面沒被人眼看過。
 */
function batch(o) {
  const rows = [];
  for (let i = 0; i < o.n; i++) {
    const p = person(o.seed + i);
    const bad = o.badAt && o.badAt.indexOf(i) > -1;
    const skip = o.skipAt && o.skipAt.indexOf(i) > -1;
    rows.push(buildRow(LOG_HEADER, {
      to: p.to, source: o.source, name: p.name, unit: p.unit,
      messages: o.messages(p),
    }, skip ? { ok: false, skipped: true, msg: '同一則 24 小時內已送達' }
       : bad ? { ok: false, code: 400, msg: 'The user hasn\'t added the LINE Official Account as a friend.' }
       : { ok: true, code: 200, msg: '' },
    { platform: 'line-platform', batchId: o.batchId, sentAt: o.sentAt }));
  }
  return rows;
}

const text = (s) => (p) => [{ type: 'text', text: s.replace(/\{name\}/g, p.name) }];

const BATCHES = [
  // ① 137 人大批次：測比例條、人數、名單很長時的下拉
  { n: 137, seed: 1, source: 'pass_broadcast', batchId: 'line-platform-20260821093000-pass',
    sentAt: '2026-08-21 09:30:00', badAt: [3, 40, 88], skipAt: [12, 55],
    messages: text('{name} 您好：\n\n2026 年度員工大會的報到碼已經產生，請於入場時出示。\n\n報到時間：09:00–09:30\n地點：台北國際會議中心 201 室\n\n如有問題請洽工務管理組。') },

  // ② 2 人、text+image：則數（4）≠ 人數（2），這一列才該印出來
  { n: 2, seed: 200, source: 'senior_notice', batchId: 'line-platform-20260821140000-senior',
    sentAt: '2026-08-21 14:00:00',
    messages: (p) => [{ type: 'text', text: p.name + ' 您好：\n\n您今年服務屆滿 15 年，公司將於年度大會表揚。' },
                      { type: 'image', originalContentUrl: 'https://example.com/a.jpg', previewImageUrl: 'https://example.com/a-s.jpg' }] },

  // ③ 單人單則：驗「1 人 1 則」那一列真的消失了
  { n: 1, seed: 300, source: 'bind_success', batchId: 'line-platform-20260820101500-bind',
    sentAt: '2026-08-20 10:15:00',
    messages: text('{name} 您好：\n\n您的 LINE 帳號已完成綁定，往後的公司通知都會送到這裡。') },
  { n: 1, seed: 301, source: 'refill_grant', batchId: 'line-platform-20260820163000-refill',
    sentAt: '2026-08-20 16:30:00',
    messages: text('{name} 您好：\n\n您 8/18 的補登申請已核准。') },
  // ④ 單人但失敗：燈號要紅，而卡面沒有數字那一列
  { n: 1, seed: 302, source: 'bind_expired', batchId: 'line-platform-20260819110000-exp',
    sentAt: '2026-08-19 11:00:00', badAt: [0],
    messages: text('{name} 您好：\n\n您的綁定連結即將到期，請重新綁定。') },

  // ⑤ 上個月：逼滑桿進「月」模式（兩個月以上就不列日）
  { n: 8, seed: 400, source: 'checkin_done', batchId: 'line-platform-20260730090000-chk',
    sentAt: '2026-07-30 09:00:00', skipAt: [2],
    messages: text('{name} 您好：\n\n您已完成報到，座位為 A 區 12 桌。') },
];

const rows = BATCHES.reduce((acc, o) => acc.concat(batch(o)), []);
const payload = { ok: true, header: LOG_HEADER, rows: rows, logSince: '2026-07-01' };

/* ── 組測試頁 ─────────────────────────────────────────── */
const src = path.join(__dirname, '..', '..', 'messages.html');
let html = fs.readFileSync(src, 'utf8');

const stub = `<script>
/* 只換網路層：頁面自己的 callApi 仍照原路跑（fetch → 剝 JSONP 殼）。 */
(function () {
  var PAYLOAD = ${JSON.stringify(payload)};
  var real = window.fetch;
  window.fetch = function (url, opt) {
    if (String(url).indexOf('script.google.com') > -1) {
      return Promise.resolve({ ok: true, text: function () {
        return Promise.resolve('cb(' + JSON.stringify(PAYLOAD) + ');');
      } });
    }
    return real.apply(this, arguments);
  };
})();
</script>
`;
html = html.replace('<head>', '<head>\n' + stub);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'messages-test.html'), html);
const link = path.join(OUT, 'assets');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(__dirname, '..', '..', 'assets'), link, 'dir');

console.log('測試頁：' + path.join(OUT, 'messages-test.html'));
console.log('批次 ' + BATCHES.length + ' 筆、列 ' + rows.length + ' 筆');
console.log('跑法：cd ' + OUT + ' && python3 -m http.server 8897');
console.log('     開 http://localhost:8897/messages-test.html?t=dummy');
