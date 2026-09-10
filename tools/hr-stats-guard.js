/**
 * hr-stats-pub.json 的入庫守門——把入口層的回應驗過再寫檔。
 *
 * 🔴 **為何是一支檔案而不是 workflow 裡的 `node -e`**：原本這段寫在
 *    `update-hr-stats.yml` 的一行 `node -e` 裡，**那種東西只能被審查、不能被測試**。
 *    它擋的是「姓名進公開 repo」——這條鏈上唯一的機械關卡，而它自己沒有任何測試。
 *
 * 🔴 **舊版的兩個零鑑別力缺口，這一版明確修掉**：
 *    ① 舊版寫死五個桶名 `['now','y1','y3','y5','y10']`——**新增一個桶就從中間走過去**。
 *       這一版改成掃 `retire` 物件的所有鍵，沒有清單可漏。
 *    ② 舊版只問「有沒有掃到姓名」，不問「有沒有掃到東西」。`retire` 變成 `{}` 時
 *       掃到 0 個姓名 ⇒ **通過**，而那同時相容於「真的沒姓名」與「這次什麼都沒檢查」。
 *       這一版把「看過幾格」一起數出來，看過 0 格就是失敗。
 *
 * ⚠️ **回傳形狀是假設，不是查證**（2026-09-10）：`/v1/workforce/composition` 由線 B 實作中，
 *    我沒有看過它真正回什麼。下面 `SHAPE` 那一格就是這個假設的唯一落點——
 *    寫成會擋住的形狀（不合就拋），不是靜默轉接。線 B 的規格定了就改那一格。
 */

/** 入口層回應 → 靜態檔內容。⚠️ 這是上面那個假設的唯一落點。 */
function SHAPE(parsed) {
  // 假設：入口層直接回 `{ ok, stats }`，與 getHrStatsPublic 同形。
  // 若它回的是裸的 composition 物件，這裡要改成 `{ ok: true, stats: parsed }`——
  // **但不要靜默相容兩種**，那會讓「形狀變了」變得看不出來。
  return parsed;
}

/** 掃 retire 底下所有桶，回 { scanned, leaked }。不吃桶名清單——沒有清單可漏。 */
function scanNames(units) {
  var scanned = 0, leaked = 0;
  Object.keys(units || {}).forEach(function (n) {
    var R = (units[n] || {}).retire;
    if (!R || typeof R !== 'object') return;
    Object.keys(R).forEach(function (k) {
      var arr = R[k];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (v) { scanned++; if (v) leaked++; });
    });
  });
  return { scanned: scanned, leaked: leaked };
}

/**
 * 驗一份原始回應，回「可以寫進靜態檔的物件」。不合格一律拋。
 * @param {string} raw 入口層回來的原始文字
 */
function checkPayload(raw) {
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // 🔴 Cloud Run 擋門回的是 text/html 錯誤頁，不是 JSON。
    //    判「有沒有被擋在門外」不要靠狀態碼——401 也是本服務憑證失敗的碼。
    throw new Error('回應不是 JSON（很可能被 Cloud Run 擋在門外，或打到了錯誤頁）：'
      + String(raw).slice(0, 80));
  }

  var r = SHAPE(parsed);
  if (!r || !r.ok || !r.stats) throw new Error('hr-stats 內容異常（缺 ok／stats），放棄更新');
  var s = r.stats;
  if (!s.total) throw new Error('hr-stats 內容異常（total 是 0 或缺），放棄更新');
  if (!s.pub) throw new Error('缺 pub 旗標，疑似含姓名的 gated 版，放棄更新');
  if (!s.units || typeof s.units !== 'object') throw new Error('缺 units，姓名檢查無從做起');

  // 🔴 「形狀對但內容空」擋不住的話，看板會畫出一張全空的圖，而且不報錯。
  //    舊版只問 `total` 有沒有值——`total=151` 而 `units` 是空的，它照樣放行。
  //    這裡用**結構一致性**擋，不列舉欄位名：各單位人數加總必須等於 total。
  //    ⬛ 這個不變量拿 2026-09-10 的線上實檔量過：151 === 151，逐格相等。
  var unitNames = Object.keys(s.units);
  if (unitNames.length === 0) throw new Error('units 是空的，而 total=' + s.total + ' ⇒ 形狀對但內容空，放棄更新');
  var sum = unitNames.reduce(function (a, n) { return a + ((s.units[n] || {}).count || 0); }, 0);
  if (sum !== s.total)
    throw new Error('各單位人數加總 ' + sum + ' 對不上 total ' + s.total + ' ⇒ 資料不自洽，放棄更新');

  var scan = scanNames(s.units);
  // ⬛ 對照組內建：先問「有沒有檢查到東西」，再問「檢查結果是什麼」。
  //    順序反過來的話，0 格會被讀成「很乾淨」。
  if (scan.scanned === 0)
    throw new Error('姓名檢查一格都沒掃到 ⇒ 這次檢查沒有鑑別力（retire 是空的？形狀變了？），放棄更新');
  if (scan.leaked)
    throw new Error('偵測到姓名外洩(' + scan.leaked + ' 格)，放棄更新');

  // 🔴 `generatedAt` 由入口層給，**原樣帶下來，絕對不要換成這次抓取的時間**。
  //    它的語意是「快照建立時間」——入口層 `server.js:213` 的註解逐字寫著
  //    「快取命中時它是舊的，**這正是重點**」。換成抓取時間的話，一份快取命中
  //    的舊快照會顯示成剛出爐的，**而那正是這一格要偵測的狀況**。
  // 🔴 缺了它就拒收，不要用現在時間補：補了就把「我不知道這份多舊」偽裝成「很新」。
  if (!r.generatedAt || !Date.parse(r.generatedAt))
    throw new Error('缺 generatedAt 或格式不對（拿到的是「' + r.generatedAt + '」）'
      + ' ⇒ 前端將分不出資料新舊，放棄更新');
  return { value: r, scanned: scan.scanned, total: s.total, generatedAt: r.generatedAt };
}

module.exports = { checkPayload, scanNames, SHAPE };

// CLI：node tools/hr-stats-guard.js <輸入檔> <輸出檔>
if (require.main === module) {
  var fs = require('fs');
  var inFile = process.argv[2], outFile = process.argv[3];
  if (!inFile || !outFile) { console.error('用法：node tools/hr-stats-guard.js <in> <out>'); process.exit(2); }
  var out = checkPayload(fs.readFileSync(inFile, 'utf8'));
  fs.writeFileSync(outFile, JSON.stringify(out.value));
  console.log('✓ 在職 ' + out.total + ' ｜ 快照時間 ' + out.generatedAt
    + ' ｜ 姓名檢查掃過 ' + out.scanned + ' 格，0 外洩');
}
