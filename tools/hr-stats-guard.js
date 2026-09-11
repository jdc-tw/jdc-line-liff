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
 * 🔴 **`pub` 這一格是這支檔案蓋的，不要去入口層找它**（2026-09-10 語意轉換）：
 *    舊：`getHrStatsPublic` 自己在回應裡宣告 `pub: true`，這裡只檢查那面旗子在不在。
 *    新：入口層 `/v1/workforce/composition` **根本不產 `pub`**——查過 jdc-identity，
 *        全檔只有 `src/workforce.js` 的一處註解提到這個字，沒有任何程式碼寫出它。
 *        ⇒ 舊那條檢查是在驗一張沒人簽發的票。
 *    ⇒ 改由 guard 自己蓋，而且只在姓名檢查**真的跑過並通過**之後蓋。
 *        `pub` 的意義因此從「生產者的宣告」變成「下游由實際檢查推導出的結論」。
 *
 * 🔴 **`counts` 不經任何投影就原樣進公開 repo**（2026-09-10）：入口層 `server.js:273` 的
 *    payload 裡，只有 `stats` 過了 `assertFieldsDeclared` 與 `project` 兩道守門，
 *    `counts` 兩道都沒過。今天它安全是因為今天沒人往裡面加東西，**不是因為有機制擋著**。
 *    下面那條形狀斷言就是那個機制。
 *
 * ⚠️ **入口層那邊也有一份同樣的規則，兩份刻意可以分歧、不要收成一份**（2026-09-10 裁定）：
 *    jdc-identity `src/adapter.js` 的名冊列驗證（`typeof v === 'number'` 那一格）也在驗
 *    「是數字但不是有限值」，連
 *    `Number.isFinite` 與 `typeof === 'number'` 的差別都各自寫了一次註解。
 *    看起來是重複，但**它們分屬兩個信任域**：那一道在源頭 fail-fast，這一道是
 *    發布進 PUBLIC repo 之前的最後一關。收成一份的話，「入口層改了規則」就等於
 *    「發布關卡跟著改」——那正好消滅第二道存在的理由。
 *    ⇒ 它們哪天長得不一樣，那不是漂移，是設計。要改這一道之前不必去對齊那一道。
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
 * 走訪 counts 的所有葉節點，回 `{ checked, badTypes }`。
 *
 * 🔴 **寫成形狀斷言，不是欄位白名單**：白名單會變成第三份要跟上游同步的東西
 *    （adapter.js 一份、這裡一份、腦袋裡一份），而它腐爛時**沒有任何訊號**——
 *    新欄位從中間走過去，全綠。「每個葉節點都必須是有限數字」不會腐爛。
 *
 * 🔴 **只回型別、不回鍵名也不回值**。這支的錯誤訊息會進 PUBLIC repo 的 Actions log，
 *    而這條檢查要擋的正是「不該公開的東西被塞進 counts」——把它印出來就等於發布了它。
 */
function walkCounts(node, out) {
  out = out || { checked: 0, badTypes: [] };
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    Object.keys(node).forEach(function (k) { walkCounts(node[k], out); });
    return out;
  }
  out.checked++;
  if (!Number.isFinite(node)) {
    var t = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    if (out.badTypes.indexOf(t) < 0) out.badTypes.push(t);
  }
  return out;
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

  // 🔴 前端讀 `s.pub` 決定姓名欄要畫「需權限，載入中…」還是真名（`hr-stats.html` 退休名單
  //    那一列的 `s.pub ? … : esc(r.n)`；不寫行號，行號會漂）。入口層不產這一格（見檔頭），
  //    所以由這裡蓋——**而且必須蓋在上面兩條之後**，它才是「檢查過了」的結論而不是宣告。
  // ⚠️ 刻意不寫 `s.pub = true`：字面 true 被搬到 `scanNames` 之前**測不出來**
  //    （拋出的路徑上沒有輸出可看，突變會全綠）。寫成從 `scan` 推導，搬上去就會炸在
  //    `scan` 還不存在，零點那條當場紅。**這一行的位置本身就是要被保護的東西。**
  s.pub = scan.scanned > 0 && scan.leaked === 0;

  // 🔴 `generatedAt` 由入口層給，**原樣帶下來，絕對不要換成這次抓取的時間**。
  //    它的語意是「快照建立時間」——入口層 `server.js:213` 的註解逐字寫著
  //    「快取命中時它是舊的，**這正是重點**」。換成抓取時間的話，一份快取命中
  //    的舊快照會顯示成剛出爐的，**而那正是這一格要偵測的狀況**。
  // 🔴 缺了它就拒收，不要用現在時間補：補了就把「我不知道這份多舊」偽裝成「很新」。
  if (!r.generatedAt || !Date.parse(r.generatedAt))
    throw new Error('缺 generatedAt 或格式不對（拿到的是「' + r.generatedAt + '」）'
      + ' ⇒ 前端將分不出資料新舊，放棄更新');
  // 🔴 `counts` 原樣進公開 repo，兩道投影守門都沒經過（見檔頭）。這一條是它唯一的關卡。
  // ⚠️ 缺 counts 也拋，這比「每個葉節點都是數字」的字面要求多一步：空手通過與真的乾淨
  //    長得一模一樣，而這條鏈上寧可停下來，也不要靜默放行一個形狀已經漂掉的上游。
  if (!r.counts || typeof r.counts !== 'object' || Array.isArray(r.counts))
    throw new Error('缺 counts 或它不是物件 ⇒ 入口層回應的形狀變了。'
      + 'counts 不經投影守門、會原樣進公開 repo，形狀不明時不放行。');
  var cw = walkCounts(r.counts);
  if (cw.checked === 0)
    throw new Error('counts 是空的，一個葉節點都沒檢查到 ⇒ 這次檢查沒有鑑別力，放棄更新');
  if (cw.badTypes.length)
    throw new Error('counts 裡有葉節點不是有限數字（型別：' + cw.badTypes.join('、') + '）'
      + ' ⇒ 有人往 counts 加了非計數的欄位，而 counts 不經投影守門、會原樣進公開 repo。'
      + '先回 jdc-identity 看那個欄位是誰加的、能不能公開，不要在這裡放行。'
      + '（刻意不印鍵名與內容：這則訊息會進 PUBLIC repo 的 Actions log。）');

  return { value: r, scanned: scan.scanned, total: s.total, generatedAt: r.generatedAt,
    countsChecked: cw.checked };
}

module.exports = { checkPayload, scanNames, walkCounts, SHAPE };

// CLI：node tools/hr-stats-guard.js <輸入檔> <輸出檔>
if (require.main === module) {
  var fs = require('fs');
  var inFile = process.argv[2], outFile = process.argv[3];
  if (!inFile || !outFile) { console.error('用法：node tools/hr-stats-guard.js <in> <out>'); process.exit(2); }
  var out = checkPayload(fs.readFileSync(inFile, 'utf8'));
  fs.writeFileSync(outFile, JSON.stringify(out.value));
  console.log('✓ 在職 ' + out.total + ' ｜ 快照時間 ' + out.generatedAt
    + ' ｜ 姓名檢查掃過 ' + out.scanned + ' 格，0 外洩'
    + ' ｜ counts 檢查過 ' + out.countsChecked + ' 個葉節點，全是數字'
    + ' ｜ pub 由本檢查蓋章');
}
