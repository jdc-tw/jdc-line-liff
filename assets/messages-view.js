/**
 * messages-view.js — LINE 訊息紀錄頁的共用渲染（messages.html 用）。
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
  // 下面兩個不是 line-platform 申報的七個來源之一，是手動發送留下的紀錄。
  // `hub_path_test` 是 2026-08-20 驗證 hub 端到端路徑的煙霧測試，刻意不借既有
  // 代號，免得紀錄表的來源標籤說謊；它不在 hub 的 SOURCE_ROLES 裡，只有 admin 看得到。
  // 使用者 2026-08-22 拍板：兩個統一顯示「測試」。
  hub_path_test: '測試',
  correction: '測試',
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
 * 稱呼行：「林俊宏 您好：」「您好，」這類。**只認開頭很短又以您好/你好收尾的行**——
 * 放寬到「含有您好」會把「…如有問題請洽您好…」這種正文也吃掉。
 */
var GREETING_LINE = /^.{0,12}[您你]好[：:，,、。\s]*$/;

/**
 * 卡面摘要：**跳過稱呼行**之後的第一行。
 *
 * 2026-08-23 使用者指定。原本取的是內容第一行，而這些訊息是套版產生的，
 * 第一行永遠是「○○您好：」——每張卡長得一模一樣，等於沒有資訊。
 * 跳過它就看得出這批在講什麼（「您 8/18 的補登申請已核准。」）。
 *
 * ⚠️ 純規則，**不做語意判讀**：只認稱呼行、只跳稱呼行，其餘照抄。
 *    整段都是稱呼行時保留最後一行——寧可顯示「您好」也不要留白，
 *    留白會讓人以為這批沒有內容。
 * ⚠️ 同一批裡每個人的內文不一樣（套版帶各自姓名年資），取第一個人的；
 *    使用者 2026-08-22 拍板不標明是誰的。
 *
 * 上限 40 字是**防呆不是排版**：真正的截斷交給 CSS 的 ellipsis（手機與桌機
 * 放得下的字數不同，寫死字數會在其中一邊切得太早或太晚）。
 */
/**
 * 多則訊息被 hub 的 messageContentOf 存成 JSON 字串（`JSON.stringify(messages)`）。
 * 裡面就有文字，挖出來比顯示「（text+image）」有用——那跟顯示 JSON 一樣沒資訊。
 * 解析不出來就回 null，讓呼叫端退回顯示型別（截斷的內容、flex 這種沒有 text 的都會走這條）。
 */
function textInPayload(s) {
  var v;
  try { v = JSON.parse(s); } catch (e) { return null; }
  var list = Array.isArray(v) ? v : [v];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m && m.type === 'text' && m.text) return String(m.text);
  }
  return null;
}

function gistOf(content, kind) {
  var s = String(content == null ? '' : content).trim();
  if (!s) return '（無內容）';
  if (s.charAt(0) === '[' || s.charAt(0) === '{') {
    s = textInPayload(s);
    if (!s) return '（' + (kind || '訊息') + '）';
  }
  var lines = s.split('\n').map(function (t) { return t.trim(); })
    .filter(function (t) { return t; });
  var i = 0;
  while (i < lines.length - 1 && GREETING_LINE.test(lines[i])) i++;
  var out = lines[i] || '';
  return out.length > 40 ? out.slice(0, 40) + '…' : out;
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
      gist: gistOf(col(header, g[0], '訊息內容'), col(header, g[0], '訊息型別')),
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

/**
 * 下拉：訊息全文 ＋ 收件名單 ＋ 批次號，收在**同一個**三角形底下。
 *
 * 2026-08-23 使用者拍板合併。原本是兩個下拉：一個看全文、一個看名單。
 * 卡面現在有內容摘要（gistOf，跳過稱呼行），要看**完整**內容與收件人就點這一個。
 *
 * ⚠️ 同一批裡每個人的內文不一樣（套版帶各自姓名年資），這裡固定拿第一個人的；
 *    使用者 2026-08-22 拍板不標明是誰的。
 */
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
  return '<details><summary class="fold-sum" aria-label="\u5c55\u958b\u8a0a\u606f\u5167\u5bb9\u8207\u540d\u55ae\uff08'
    + batch.rows.length + ' \u4eba\uff09"></summary>'
    + '<div class="fold-body">'
    + '<div class="fullmsg">' + highlight(fullMessageOf(batch), toks) + '</div>'
    + body
    + '<div class="bid">' + highlight(batch.batchId, toks) + '</div></div></details>';
}

/** 全文＝第一個人收到的完整內文（不是截斷的主旨）。 */
function fullMessageOf(batch) {
  var r = (batch.rows && batch.rows[0]) || {};
  return String(r.content == null ? '' : r.content) || '\uff08\u7121\u5167\u5bb9\uff09';
}

/**
 * 一張批次卡：三列（分類·日期·時間·燈號／人數·則數·狀態列／內容摘要）。
 *
 * ⚠️ 人數與則數**無條件顯示**。2026-08-23 曾改成「單人批次不畫」，理由是
 *    「1 人 1 則」兩個數字恆為 1，但使用者當場否決：他問的是那一列在呈現什麼，
 *    不是要把它拿掉——**問題出在卡面沒有內容摘要，不是數字多餘**。
 *    補上第三列的摘要之後，那一列就不再是卡片上唯一的東西了。
 *
 * 摘要是**靜態文字不是下拉**：全文與名單都在底下那個唯一的三角形裡。
 * 字級比照日期時間（12.5px），它是附註不是標題。
 *
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
    +   '<span class="num">' + batch.rows.length + '<u>\u4eba</u></span>'
    +   '<span class="num">' + batch.msgCount + '<u>\u5247</u></span>'
    +   stripHtml(batch)
    + '</div>'
    + '<div class="gist">' + highlight(batch.gist, toks) + '</div>'
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
 * 左側時間滑桿要列什麼。
 *
 * **層級靠線條長度表達，不靠展開**（使用者 2026-08-22 指定）：
 *   ━━━━━━━━━  2026     年，線最長
 *   ━━━━━━     08       月，次之，標籤對齊年的前二碼
 *   ━━━━         21     日，最短，標籤對齊年的後二碼
 * 不必點、不必 hover 就看得出「這個 21 是哪一年哪一月的 21」。
 * 上一版是「收合只給數字、hover 才展開面板顯示 N 批 M 則」——使用者看到那個面板
 * 直接問「這是什麼功能」，證明它沒有自我說明的能力，整個移除。
 *
 * 未滿兩個月才列到「日」，而且**只列真的有訊息的日**（每天都畫會出現一堆空線）。
 * 兩個月以上就停在「月」——hub 2026-08-19 才上線，剛上線全部資料都在同一個月，
 * 只列月的話滑桿只有一條線，看不出它在做什麼。
 *
 * @returns {{mode:'day'|'month', ticks:{level,key,label,anchor}[]}}
 *   level: 'year' | 'month' | 'day'；anchor: 要捲到的元素 id
 */
function railTicks(batches) {
  var months = [], seenM = {};
  (batches || []).forEach(function (b) {
    if (!Object.prototype.hasOwnProperty.call(seenM, b.month)) { seenM[b.month] = 1; months.push(b.month); }
  });
  if (!months.length) return { mode: 'month', ticks: [] };

  var mode = months.length >= 2 ? 'month' : 'day';
  var ticks = [], seen = {};
  var push = function (level, key, label, anchor) {
    var id = level + ':' + key;
    if (Object.prototype.hasOwnProperty.call(seen, id)) return;
    seen[id] = 1;
    ticks.push({ level: level, key: key, label: label, anchor: anchor });
  };

  (batches || []).forEach(function (b) {
    var year = b.month.slice(0, 4);
    // 年跳到該年最新的那個月；月跳到月標；日跳到當天第一張卡
    push('year', year, year, 'm-' + b.month);
    push('month', b.month, b.month.slice(5), 'm-' + b.month);
    if (mode === 'day') {
      var day = b.time.slice(0, 10);
      push('day', day, day.slice(8), 'd-' + day);
    }
  });
  return { mode: mode, ticks: ticks };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORY: CATEGORY, SKIP_RESULT: SKIP_RESULT, STATUS_LABEL: STATUS_LABEL,
    sinceWarning: sinceWarning, railTicks: railTicks, fullMessageOf: fullMessageOf,
    esc: esc, col: col, statusOf: statusOf, gistOf: gistOf, textInPayload: textInPayload,
    msgCountOf: msgCountOf, tallyOf: tallyOf, lampOf: lampOf,
    groupBatches: groupBatches, monthGroups: monthGroups,
    highlight: highlight, stripHtml: stripHtml, foldHtml: foldHtml,
    cardHtml: cardHtml, listHtml: listHtml,
  };
}
