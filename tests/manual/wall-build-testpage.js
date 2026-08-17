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
const UNITS = BIG
  ? [['工務部', 18], ['管理部', 14], ['業務部', 13], ['技術部', 12], ['設計部', 11],
     ['安衛部', 10], ['採購部', 9], ['會計部', 9], ['資訊部', 8], ['人事部', 7],
     ['法務部', 6], ['品管部', 6], ['機電部', 6], ['營業所', 5], ['支店主管', 3]]
  : [['工務部', 12], ['管理部', 9], ['業務部', 8], ['技術部', 7], ['支店主管', 4]];
const PARTS = [];
UNITS.forEach(function (u, ui) {
  for (let i = 0; i < u[1]; i++) {
    PARTS.push({ empNo: 'E' + ui + String(i).padStart(2, '0'), name: u[0].slice(0, 2) + (i + 1), unit: u[0] });
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
const NAME = BIG ? 'wall-test-big.html' : 'wall-test.html';
fs.writeFileSync(path.join(OUT, NAME), src.replace('<head>', '<head>' + STUB));
const link = path.join(OUT, 'assets');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(__dirname, '..', '..', 'assets'), link);

console.log('✅ 產出 ' + path.join(OUT, NAME));
console.log('   共 ' + SEQ.length + ' 輪：' +
  SEQ.map(w => w.arrived + '/' + w.total).join(' → '));
console.log('   排序變化：\n     ' +
  SEQ.map(w => w.units.map(u => u.name).join(' > ')).join('\n     '));
