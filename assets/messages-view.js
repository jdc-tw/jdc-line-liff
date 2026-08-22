/**
 * messages-view.js — 訊息紀錄頁的共用渲染（messages.html 用）。
 * 純函式、無 DOM 依賴：呼叫端自己把回傳的字串塞進自己的節點。
 * 雙環境：瀏覽器直接當全域用，node 下由 module.exports 供測試。
 *
 * 後端是 jdc-line-hub（獨立 GAS 專案），不是本站其他頁用的 line-platform。
 *
 * ⚠️ 這支的 esc() 比 assets/stats-view.js 的嚴格：那支只換 `<`，這支換
 *    & < > " 四個。差異是刻意的——本頁渲染的「來源」「對象姓名」等欄位由
 *    **呼叫端**提供（line-platform 或日後的第二個平台），不是我方產生的字串，
 *    屬於不可信輸入。既有頁面不動，避免無謂的行為變更。
 *
 * 2026-08-22 改版：平鋪表格 → 批次卡。設計語彙沿用 stats.html（活動紀錄看板）。
 */

/** 來源代號 → 中文。line-platform 目前申報七種（pushLine_ 的 source 必填）。 */
var CATEGORY = {
  senior_notice: '資深員工通知',
  pass_broadcast: '報到碼通知',
  checkin_done: '報到完成',
  bind_success: '綁定成功',
  bind_expired: '綁定過期提醒',
  refill_grant: '補登核准',
  refill_auto: '自動補登',
};

/**
 * 「結果」欄的三種值 → 內部狀態。
 * ⚠️ **三態不是兩態**。hub 的 buildRow 註解寫得很清楚：略過的那些「沒送、
 *    但對方已經有了」，記成成功會讓日後回查數不出誤觸規模，記成失敗會引誘
 *    承辦人去補一則真的重複。改版前這頁寫的是「不等於成功就算失敗」，
 *    **把略過畫成了失敗**（2026-08-22 查出）。
 */
var SKIP_RESULT = '略過（疑似重複）';
function statusOf(result) {
  var v = String(result == null ? '' : result);
  if (v === '成功') return 'ok';
  if (v === SKIP_RESULT || v.indexOf('略過') === 0) return 'skip';
  return 'bad';
}
var STATUS_LABEL = { ok: '成功', bad: '失敗', skip: '略過' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
  });
}

/** 依欄名取值。找不到那一欄就回空字串，不用固定索引。 */
function col(header, row, name) {
  var i = header.indexOf(name);
  return i < 0 ? '' : String(row[i] == null ? '' : row[i]);
}

/**
 * 主旨：資料表**沒有主旨欄**，只能從「訊息內容」取。
 * 單則純文字時取第一行；多則會被 hub 存成 JSON，那時候顯示型別比顯示 JSON 有用。
 */
function subjectOf(content, kind) {
  var s = String(content == null ? '' : content).trim();
  if (!s) return '（無內容）';
  if (s.charAt(0) === '[' || s.charAt(0) === '{') return '（' + (kind || '訊息') + '）';
  var first = s.split('\n')[0].trim();
  return first.length > 60 ? first.slice(0, 60) + '…' : first;
}

/** 則數＝訊息型別用 + 拆開加總。一列＝發給一個人，但一次可送多則。 */
function msgCountOf(rows) {
  return rows.reduce(function (n, r) {
    return n + String(r.kind || 'text').split('+').length;
  }, 0);
}

function tallyOf(rows) {
  var t = { ok: 0, bad: 0, skip: 0 };
  rows.forEach(function (r) { t[r.st]++; });
  return t;
}

/** 一顆總燈：有失敗就紅，其餘有略過就灰，全成功才綠。 */
function lampOf(t) { return t.bad ? 'bad' : (t.skip ? 'skip' : 'ok'); }

/**
 * 把 hub 回傳的 (header, rows) 聚合成批次，**新的在最前面**。
 * 一次廣播 137 則平鋪的話，看不出那是同一次操作。
 * @returns {object[]}
 */
function groupBatches(header, rows) {
  var groups = {}, order = [];
  (rows || []).forEach(function (r) {
    var id = col(header, r, '批次') || '(無批次)';
    if (!Object.prototype.hasOwnProperty.call(groups, id)) { groups[id] = []; order.push(id); }
    groups[id].push(r);
  });

  var out = order.map(function (id) {
    var g = groups[id];
    var rs = g.map(function (r) {
      return {
        name: col(header, r, '對象姓名') || col(header, r, '對象UserID'),
        userId: col(header, r, '對象UserID'),
        unit: col(header, r, '對象單位'),
        kind: col(header, r, '訊息型別'),
        content: col(header, r, '訊息內容'),   // 完整內文，供搜尋用（畫面上只顯示主旨）
        attach: col(header, r, '附件'),
        error: col(header, r, '錯誤'),
        st: statusOf(col(header, r, '結果')),
      };
    });
    var t = tallyOf(rs);
    var lamp = lampOf(t);
    var time = col(header, g[0], '發送時間');
    var src = col(header, g[0], '來源');
    return {
      batchId: id,
      time: time,
      month: time.slice(0, 7),
      platform: col(header, g[0], '平台'),
      source: src,
      categoryLabel: CATEGORY[src] || src || '（未申報）',
      subject: subjectOf(col(header, g[0], '訊息內容'), col(header, g[0], '訊息型別')),
      rows: rs,
      tally: t,
      lamp: lamp,
      statusLabel: STATUS_LABEL[lamp],
      msgCount: msgCountOf(rs),
    };
  });

  // 最新在最上面
  out.sort(function (a, b) { return a.time < b.time ? 1 : (a.time > b.time ? -1 : 0); });
  return out;
}

/** 依月分段，順序沿用傳進來的批次順序（已是新到舊）。 */
function monthGroups(batches) {
  var seen = {}, out = [];
  (batches || []).forEach(function (b) {
    if (!Object.prototype.hasOwnProperty.call(seen, b.month)) {
      seen[b.month] = { month: b.month, batches: [], msgCount: 0 };
      out.push(seen[b.month]);
    }
    seen[b.month].batches.push(b);
    seen[b.month].msgCount += b.msgCount;
  });
  return out;
}

/**
 * 命中處標色。多個 token 由長到短逐一標，避免短的把長的切開。
 * ⚠️ 一律先 esc() 再標記，且跳過已經在標籤內的位置。
 */
function highlight(text, toks) {
  var out = esc(text);
  if (!toks || !toks.length) return out;
  toks.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (tok) {
    if (!tok) return;
    var lo = out.toLowerCase(), from = 0, built = '', at;
    while ((at = lo.indexOf(tok, from)) >= 0) {
      var head = out.slice(0, at);
      // 落在 <mark> 這類標籤內就跳過（單引號雙引號都不會出現在 esc 後的內文）
      if (head.split('<').length !== head.split('>').length) { from = at + 1; continue; }
      built += out.slice(from, at) + '<mark>' + out.slice(at, at + tok.length) + '</mark>';
      from = at + tok.length;
    }
    if (built) out = built + out.slice(from);
  });
  return out;
}

/** 24 則以內畫一顆一顆的點；再多就壓成比例條——點太密反而數不出來。 */
function stripHtml(batch) {
  var t = batch.tally, n = batch.rows.length;
  var label = '成功 ' + t.ok + '，失敗 ' + t.bad + '，略過 ' + t.skip;
  if (n <= 24) {
    return '<span class="strip" role="img" aria-label="' + label + '">'
      + batch.rows.map(function (r) { return '<i class="dot ' + r.st + '"></i>'; }).join('')
      + '</span>';
  }
  var pct = function (v) { return (v / n * 100).toFixed(2) + '%'; };
  return '<span class="strip"><span class="bar" role="img" aria-label="' + label + '">'
    + '<span class="ok" style="width:' + pct(t.ok) + '"></span>'
    + '<span class="bad" style="width:' + pct(t.bad) + '"></span>'
    + '<span class="skip" style="width:' + pct(t.skip) + '"></span></span></span>';
}

/** 名單：預設收起（照 stats.html 的 .fold-sum），只給一個三角形，不放文字。 */
function foldHtml(batch, toks) {
  var body = batch.rows.map(function (r) {
    return '<div class="prow">'
      + '<span class="nm">' + highlight(r.name, toks) + '</span>'
      + (r.unit ? '<span class="tag">' + highlight(r.unit, toks) + '</span>' : '')
      + (r.kind ? '<span class="tag">' + highlight(r.kind, toks) + '</span>' : '')
      + '<span class="sp"></span>'
      + '<span class="tag ' + (r.st === 'ok' ? 'g' : (r.st === 'bad' ? 'r' : '')) + '">'
      + STATUS_LABEL[r.st] + '</span>'
      + (r.error ? '<span class="err">' + highlight(r.error, toks) + '</span>' : '')
      + '</div>';
  }).join('');
  return '<details><summary class="fold-sum" aria-label="展開名單 '
    + batch.rows.length + ' 人"></summary>'
    + '<div class="fold-body">' + body
    + '<div class="bid">' + highlight(batch.batchId, toks) + '</div></div></details>';
}

/**
 * 一張批次卡：三列（分類·日期·時間·燈號／人數·則數·狀態列／主旨）。
 * @param {string} [anchorId] 當天第一張卡才給——滑桿的「日」模式靠它跳。
 */
function cardHtml(batch, toks, anchorId) {
  return '<div class="card"' + (anchorId ? ' id="' + esc(anchorId) + '"' : '') + '><div class="head">'
    + '<div class="ln">'
    +   '<span class="tag ' + esc(batch.source) + '">'
    +     highlight(batch.categoryLabel, toks) + '</span>'
    +   '<span class="dt">' + highlight(batch.time.slice(5, 10), toks) + '</span>'
    +   '<span class="tm">' + highlight(batch.time.slice(11, 16), toks) + '</span>'
    +   '<i class="lamp ' + batch.lamp + '" role="img" aria-label="'
    +     batch.statusLabel + '"></i>'
    + '</div>'
    + '<div class="ln">'
    +   '<span class="num">' + batch.rows.length + '<u>人</u></span>'
    +   '<span class="num">' + batch.msgCount + '<u>則</u></span>'
    +   stripHtml(batch)
    + '</div>'
    + '<div class="subject">' + highlight(batch.subject, toks) + '</div>'
    + '</div>' + foldHtml(batch, toks) + '</div>';
}

/**
 * 整份清單。
 * @param {object[]} batches
 * @param {string[]} toks 標色用的 token；沒有就不標
 * @param {boolean} grouped 是否照月分段。搜尋結果照相關性排，分月會打散排序，故傳 false
 */
function listHtml(batches, toks, grouped) {
  if (!batches || !batches.length) return '<div class="empty">沒有符合的紀錄。</div>';

  // 每天第一張卡掛 id="d-YYYY-MM-DD"。滑桿在「日」模式時跳這個。
  // 刻意不改成「照日分段」——清單版面維持照月，滿兩個月換月模式那天
  // 使用者不會覺得畫面突然變了樣。
  var daySeen = {};
  var one = function (b) {
    var day = b.time.slice(0, 10), id = null;
    if (day && !Object.prototype.hasOwnProperty.call(daySeen, day)) {
      daySeen[day] = 1; id = 'd-' + day;
    }
    return cardHtml(b, toks, id);
  };

  if (!grouped) return batches.map(one).join('');

  return monthGroups(batches).map(function (g) {
    return '<div class="sec" id="m-' + esc(g.month) + '">'
      + esc(g.month.replace('-', ' / '))
      + '<span class="n">' + g.batches.length + ' 批　共 ' + g.msgCount + ' 則</span></div>'
      + g.batches.map(one).join('');
  }).join('');
}

/**
 * 紀錄起始日的提示。
 * **正常情況回空字串、頁面完全不顯示**——使用者 2026-08-22：「看就知道了」。
 * 但「未設定」是真的故障訊號：留白會讓「還沒開始記」看起來像「這段期間沒發過」，
 * 所以那一種要留著。（原本無論如何都印一行，現在只留警告那一種。）
 */
function sinceWarning(logSince) {
  return logSince ? '' : '⚠️ 紀錄起始日未設定，無法判斷這頁涵蓋哪一段期間。';
}

/**
 * 左側滑桿要列什麼。
 * 未滿兩個月 → 列「日」，而且**只列真的有訊息的日**（使用者 2026-08-22 指定：
 * 每天都畫一條會出現一堆空的線）。兩個月以上 → 列「月」。
 *
 * 為何不是「永遠列月」：hub 2026-08-19 才上線，剛上線時全部資料都在同一個月，
 * 滑桿只會有一條線，等於看不出它在做什麼。
 * @returns {{mode:'day'|'month', ticks:{key,short,n,msgs}[]}}
 */
function railTicks(batches) {
  var months = [], seen = {};
  (batches || []).forEach(function (b) {
    if (!Object.prototype.hasOwnProperty.call(seen, b.month)) { seen[b.month] = 1; months.push(b.month); }
  });
  var mode = months.length >= 2 ? 'month' : 'day';
  var keyOf = function (b) { return mode === 'month' ? b.month : b.time.slice(0, 10); };
  var map = {}, order = [];
  (batches || []).forEach(function (b) {
    var k = keyOf(b);
    if (!Object.prototype.hasOwnProperty.call(map, k)) {
      map[k] = { key: k, short: mode === 'month' ? k.slice(5) : k.slice(8), n: 0, msgs: 0 };
      order.push(map[k]);
    }
    map[k].n++;
    map[k].msgs += b.msgCount;
  });
  return { mode: mode, ticks: order };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORY: CATEGORY, SKIP_RESULT: SKIP_RESULT, STATUS_LABEL: STATUS_LABEL,
    sinceWarning: sinceWarning, railTicks: railTicks,
    esc: esc, col: col, statusOf: statusOf, subjectOf: subjectOf,
    msgCountOf: msgCountOf, tallyOf: tallyOf, lampOf: lampOf,
    groupBatches: groupBatches, monthGroups: monthGroups,
    highlight: highlight, stripHtml: stripHtml, foldHtml: foldHtml,
    cardHtml: cardHtml, listHtml: listHtml,
  };
}
