/**
 * 產生進場牆（wall.html）UI 驗收用的測試頁。
 *
 * 手法沿用 veg-build-testpage.js：把 wall.html 原封複製，只在 <head> 最前面插一段 script
 * 覆寫 window.fetch，讓 GAS 請求依序回一連串「越來越多人報到」的假回應。
 * **只換網路層，不碰 DOM**——頁面仍走自己的啟動流程，所以語法錯誤、初始化早退、
 * CSS 破版、動畫沒動這些都還驗得到。
 *
 * 假資料不是手寫的：直接叫後端**真正的** buildArrivalWall 產生，形狀保證與線上一致
 * （手寫 fixture 曾經是「測了半天測的是自己捏的形狀」的來源）。
 *
 * 用法：
 *   node tests/manual/wall-build-testpage.js
 *   cd <輸出目錄> && python3 -m http.server 8898
 *   開 http://localhost:8898/wall-test.html?t=dummy&act=actTEST&tick=3
 *
 *   ?tick=<秒> 只縮短輪詢間隔（預設 15 秒太久，人眼要連看好幾輪）。不改任何產品邏輯。
 *
 * 產物全在輸出目錄（repo 一個檔都不多）：測試頁 ＋ 一個指回 repo assets/ 的 symlink。
 * 為什麼要 http 不用 file://：playwright MCP 擋 file: 協定。
 */
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'wall-ui');
const GAS = process.argv[3] ||
  path.join(__dirname, '..', '..', '..', 'jdc-line-gas', 'line-platform', 'event-checkin.js');

if (!fs.existsSync(GAS)) {
  console.error('找不到後端 event-checkin.js：' + GAS +
    '\n（第二個參數可指定路徑。刻意不做 fallback——手寫假資料會讓驗收驗到錯的形狀。）');
  process.exit(1);
}
const { buildArrivalWall } = require(GAS);

/* 刻意讓報到集中在特定單位，逼「未報到比例」的排名在幾輪之間換位——
   排名不換位的話，這次要驗的「逐一移動」根本不會發生。

   --big＝現場真實規模（137 人／15 個單位）。小測資看不出「人多時牆夠不夠大」，
   而那正是投在大螢幕上最吃版面的一刻。 */
const BIG = process.argv.indexOf('--big') > -1;
/* 單位名刻意長短不一——真實名冊就是這樣，而版面要撐得住最長的那個。
   只用「工務部」這種三字名測，右側對齊與截斷的問題永遠不會現形。 */
const UNITS = BIG
  ? [['工務管理組', 18], ['經營企劃管理室', 14], ['業務部', 13], ['技術部', 12],
     ['設計部', 11], ['安全衛生管理部', 10], ['採購部', 9], ['會計部', 9],
     ['資訊系統管理課', 8], ['人事部', 7], ['法務部', 6], ['品質管理部', 6],
     ['機電部', 6], ['台中營業所', 5], ['支店主管', 3]]
  : [['工務管理組', 12], ['經營企劃管理室', 9], ['業務部', 8], ['技術部', 7], ['支店主管', 4]];

/* 姓名要像真的姓名。第一版把測試用的人名取成「工務1」「業務7」，
   結果牆上顯示出來像是單位名——使用者以為程式顯示錯了，其實是測資取名的問題。 */
const 姓 = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高'.split('');
const 名 = ['彥廷', '宗翰', '雅婷', '怡君', '家豪', '育誠', '佩珊', '俊宏', '詩涵', '冠宇',
  '思穎', '建良', '美玲', '志偉', '淑芬', '孟儒', '品妤', '柏翰', '昱安', '欣怡'];
const PARTS = [];
let seq = 0;
UNITS.forEach(function (u, ui) {
  for (let i = 0; i < u[1]; i++, seq++) {
    PARTS.push({
      empNo: 'E' + ui + String(i).padStart(2, '0'),
      name: 姓[(seq * 7) % 姓.length] + 名[(seq * 3) % 名.length],
      unit: u[0],
    });
  }
});
const of = (ui, n) => PARTS.filter(p => p.empNo.startsWith('E' + ui)).slice(0, n).map(p => p.empNo);

/* 累積報到名單：各單位的報到進度刻意錯開（後面的單位晚開始），排名才會一路換位。
   最後幾步未到人數跌破 30，後端才開始給姓名——那一步的畫面變化也要驗到。 */
const STEPS = [0, 1, 2, 3, 4, 5].map(function (s) {
  let list = [];
  UNITS.forEach(function (u, ui) {
    const f = Math.max(0, Math.min(1, (s - ui * (BIG ? 0.22 : 0.35)) / 3.2));
    list = list.concat(of(ui, Math.round(u[1] * f)));
  });
  return list;
});

const SEQ = STEPS.map(function (arrived, i) {
  const w = buildArrivalWall(PARTS, arrived, 30);
  w.ok = true; w.actName = '驗收用活動'; w.eventDate = '2026/08/28';
  w.at = '18:' + String(i * 7).padStart(2, '0');
  return w;
});

const STUB = `<script>
(function(){
  var SEQ=${JSON.stringify(SEQ)},i=0;
  window.fetch=function(){
    var p=SEQ[Math.min(i,SEQ.length-1)];i++;
    console.log('[stub] 第 '+i+' 次輪詢：已到 '+p.arrived+'／未到 '+p.notArrived
      +'，排序＝'+p.units.map(function(u){return u.name;}).join('>'));
    var body='cb('+JSON.stringify(p)+')';
    return Promise.resolve({text:function(){return Promise.resolve(body);}});
  };
  var t=(location.search.match(/[?&]tick=(\\d+)/)||[])[1];
  if(t){var si=window.setInterval;window.setInterval=function(f,ms){return si(f,ms>=15000?t*1000:ms);};}
})();
</script>`;

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'wall.html'), 'utf8');
if (src.indexOf('<head>') === -1) { console.error('wall.html 找不到 <head>，插入點要重找'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });

/* --artifact＝產出可以遠端開的版本（人不在本機時用）。
   差別只在外殼：拆掉 <!DOCTYPE>/<html>/<head>（發布端會自己包一層），
   輪詢改成跑完循環回第一輪，並在角落標明這是模擬資料。牆本身一個字都不改。 */
if (process.argv.indexOf('--artifact') > -1) {
  const cuts = [
    [/^[\s\S]*?<head>/, ''],          // doctype/html/head 開頭
    [/<meta[^>]*>\s*/g, ''],          // charset/viewport/robots 由發布端提供
    [/<link[^>]*>\s*/g, ''],          // favicon 走發布參數，外部檔案會被 CSP 擋
    [/<\/head><body>/, ''],
    [/<\/body><\/html>\s*$/, ''],
    [/<title>.*?<\/title>/, '<title>進場牆預覽</title>'],
  ];
  let out = src;
  cuts.forEach(function (c, i) {
    if (!c[0].test(out)) { console.error('❌ 第 ' + (i + 1) + ' 條外殼裁切沒命中，wall.html 結構變了'); process.exit(1); }
    out = out.replace(c[0], c[1]);
  });
  // 主題第三態：原檔只處理了「系統偏好深色」，補上「檢視者手動選深色」
  const DARK_STAMP = `
  :root[data-theme="dark"] {
    --r: #e2879a;
    --ink: #e8e8e5; --ink2: #a9a9a4; --ink3: #7c7c78;
    --bg: #141413; --done: #232321;
    --scrim: rgba(20,20,19,.86);
  }
  #note { position: fixed; left: 14px; bottom: 12px; z-index: 3;
          font-size: 12px; color: var(--ink3); letter-spacing: .02em; }
`;
  out = out.replace('</style>', DARK_STAMP + '</style>');
  // 跑完回第一輪。遠端的人隨時打開都要看得到動畫，不能停在最後一格畫面
  const LOOP = STUB.replace('SEQ[Math.min(i,SEQ.length-1)]', 'SEQ[i%SEQ.length]');
  if (LOOP === STUB) { console.error('❌ 循環改寫沒命中'); process.exit(1); }
  out = LOOP + out;   // ⚠️ 一定要插進去。漏了這行＝頁面真的去打後端，畫面停在「無權限」
  out = out.replace('<div id="stage">',
    '<div id="note">模擬資料 · 每 4 秒推進一輪 · 跑完自動從頭開始</div>\n<div id="stage">');
  // 遠端看的人沒辦法在網址加 ?tick，把預設輪詢間隔直接壓到 4 秒
  out = out.replace('setInterval(tick,15000)', 'setInterval(tick,4000)');
  fs.writeFileSync(path.join(OUT, 'wall-artifact.html'), out);
  console.log('✅ 產出 ' + path.join(OUT, 'wall-artifact.html') + '（遠端預覽版）');
  process.exit(0);
}

const NAME = BIG ? 'wall-test-big.html' : 'wall-test.html';
fs.writeFileSync(path.join(OUT, NAME), src.replace('<head>', '<head>' + STUB));
const link = path.join(OUT, 'assets');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(__dirname, '..', '..', 'assets'), link);

console.log('✅ 產出 ' + path.join(OUT, NAME));
console.log('   共 ' + SEQ.length + ' 輪：' +
  SEQ.map(w => w.arrived + '/' + w.total).join(' → '));
console.log('   排序變化：\n     ' +
  SEQ.map(w => w.units.map(u => u.name).join(' > ')).join('\n     '));
