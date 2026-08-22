/**
 * messages-search.js — 訊息紀錄頁的即時搜尋（messages.html 用）。
 * 純函式、無 DOM 依賴：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 *
 * 為何自己寫、不引程式庫（2026-08-22）：
 * 這頁跑在 GitHub Pages，多一個 CDN 就多一個「它掛掉整頁停擺」的相依，
 * 而全站已經因為外部相依吃過虧（見 messages.html 裡 AbortController 那段註解）。
 * 需要的東西也就四樣，加起來不到 150 行。
 *
 * 四樣是：
 *   ① 即時      —— 每次按鍵重算（去抖在呼叫端做）
 *   ② 前綴      —— 打「資深」要中「資深員工通知」，不必打完
 *   ③ 錯字容忍  —— 編輯距離；**只對英數，不對中文也不對純數字**（理由見 scoreField）
 *   ④ 相關性排序 —— 欄位有輕重、命中方式也有輕重
 */

/** 欄位權重：越是「人在找的東西」越重。 */
var FIELD_W = {
  subject: 5, category: 4, name: 3.5, date: 3, content: 2.5,
  unit: 2, kind: 1.5, error: 1.5, batchId: 1, num: 1,
  userId: 1, attach: 1, platform: 1,
};

/** 命中方式的權重。完全相等 > 前綴 > 包含 > 錯字。 */
var HIT_W = { exact: 1, prefix: 0.8, contains: 0.62, fuzzy: 0.34 };

/** 錯字命中會扣總分，讓「拼對的」永遠排在「拼錯的」前面。 */
var FUZZY_PENALTY = 0.5;

function norm(s) {
  s = String(s == null ? '' : s);
  if (s.normalize) s = s.normalize('NFKC');
  return s.toLowerCase();
}

var CJK_RE = /[㐀-鿿豈-﫿]/;
function hasCJK(s) { return CJK_RE.test(s); }

/**
 * 編輯距離，超過 max 就提早放棄。
 * 我們只需要「有沒有超過」，不需要真值，所以逐列檢查最小值就能剪枝。
 */
function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    var best = cur[0];
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur.slice();
  }
  return prev[b.length];
}

var WORD_SPLIT = /[\s\-_:,/．。、／]+/;

/**
 * 一個 token 對一個欄位值的命中分數；0 代表沒中。
 *
 * ⚠️ 錯字容忍**刻意排除兩種 token**：
 *   - 中文：打錯多半是同音字（陳／陣），編輯距離只看字形，會把不相干的字算成很近，
 *     製造大量假命中，弊遠大於利。
 *   - 純數字：「137」和「17」是不同的數，不是打錯。2026-08-22 實測不擋的話
 *     搜 137 會連 121、17 一起中，把精確查詢變成模糊查詢。
 */
function scoreField(tok, val) {
  if (!val || !tok) return 0;
  if (val === tok) return HIT_W.exact;
  if (val.indexOf(tok) === 0) return HIT_W.prefix;

  var words = val.split(WORD_SPLIT), i;
  for (i = 0; i < words.length; i++) {
    if (words[i] && words[i].indexOf(tok) === 0) return HIT_W.prefix * 0.95;
  }
  if (val.indexOf(tok) >= 0) return HIT_W.contains;

  if (!hasCJK(tok) && tok.length >= 3 && !/^[0-9]+$/.test(tok)) {
    var max = tok.length >= 6 ? 2 : 1;
    for (i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || hasCJK(w)) continue;
      if (Math.abs(w.length - tok.length) <= max && editDist(tok, w, max) <= max) {
        return HIT_W.fuzzy;
      }
    }
  }
  return 0;
}

/**
 * 把一筆批次攤成「欄位 → 可搜尋字串陣列」。
 * 整份資料都進得來，包含數字與狀態字。
 * @param {object} batch groupBatches() 產出的其中一筆
 */
function indexBatch(batch) {
  // 紀錄表 12 欄一個都不漏——使用者要的是「搜尋範圍遍佈全部的文字、數字」。
  // ⚠️ 內文要收**完整的**，不能只收畫面上那個截斷成 60 字的主旨：
  //    長訊息中段的字會搜不到（2026-08-22 被測試抓到）。
  var names = [], units = [], errors = [], kinds = [], ids = [], attaches = [], contents = [];
  var push = function (arr, v) { if (v && arr.indexOf(v) < 0) arr.push(v); };
  (batch.rows || []).forEach(function (r) {
    push(names, r.name); push(units, r.unit); push(errors, r.error);
    push(kinds, r.kind); push(ids, r.userId); push(attaches, r.attach);
    push(contents, r.content);
  });
  var t = batch.tally || { ok: 0, bad: 0, skip: 0 };
  var d = String(batch.time || '');
  return {
    subject: [norm(batch.subject)],
    category: [norm(batch.categoryLabel), norm(batch.source)],
    name: names.map(norm),
    unit: units.map(norm),
    error: errors.map(norm).concat([norm(batch.statusLabel)]),
    kind: kinds.map(norm),
    content: contents.map(norm),
    userId: ids.map(norm),
    attach: attaches.map(norm),
    platform: [norm(batch.platform)],
    batchId: [norm(batch.batchId)],
    // 日期給多種寫法，使用者打 08-19、2026-08、17:30 都要中
    date: [norm(d), norm(d.slice(0, 10)), norm(d.slice(0, 7)),
           norm(d.slice(5, 10)), norm(d.slice(11, 16))],
    num: [String((batch.rows || []).length), String(batch.msgCount || 0),
          String(t.ok), String(t.bad), String(t.skip)],
  };
}

/** 一次把整批索引好；呼叫端拿到後自己收著，別每次搜尋重建。 */
function buildIndex(batches) {
  return (batches || []).map(function (b) { return { batch: b, ix: indexBatch(b) }; });
}

function tokenize(query) {
  return norm(query).split(/\s+/).filter(Boolean);
}

/**
 * 多個 token 一律 AND；每個 token 取它在所有欄位裡的最佳命中。
 * @returns {{list: object[], fuzzy: boolean, all: boolean}}
 */
function search(index, query) {
  var toks = tokenize(query);
  if (!toks.length) {
    return { list: (index || []).map(function (e) { return e.batch; }), fuzzy: false, all: true };
  }
  var out = [], anyFuzzy = false;
  (index || []).forEach(function (entry) {
    var total = 0, ok = true, usedFuzzy = false, i, f, vals, v;
    for (i = 0; i < toks.length; i++) {
      var tok = toks[i], best = 0, bestHit = 0;
      for (f in entry.ix) {
        if (!Object.prototype.hasOwnProperty.call(entry.ix, f)) continue;
        vals = entry.ix[f];
        for (v = 0; v < vals.length; v++) {
          var hit = scoreField(tok, vals[v]);
          if (!hit) continue;
          var s = hit * (FIELD_W[f] || 1);
          if (s > best) { best = s; bestHit = hit; }
        }
      }
      if (!best) { ok = false; break; }
      if (bestHit === HIT_W.fuzzy) usedFuzzy = true;
      total += best;
    }
    if (ok) {
      if (usedFuzzy) anyFuzzy = true;
      out.push({ batch: entry.batch, score: total - (usedFuzzy ? FUZZY_PENALTY : 0) });
    }
  });
  out.sort(function (x, y) {
    if (y.score !== x.score) return y.score - x.score;
    return String(x.batch.time) < String(y.batch.time) ? 1 : -1;   // 同分新的在上
  });
  return { list: out.map(function (o) { return o.batch; }), fuzzy: anyFuzzy, all: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    norm: norm, hasCJK: hasCJK, editDist: editDist, scoreField: scoreField,
    indexBatch: indexBatch, buildIndex: buildIndex, tokenize: tokenize, search: search,
    FIELD_W: FIELD_W, HIT_W: HIT_W,
  };
}
