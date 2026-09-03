/**
 * 「部分失敗」的共用讀法——staff.html（掃描站）與 stats.html（承辦端）共用。
 *
 * 為什麼要共用：兩張頁面消費的是兩支不同的後端函式
 * （getEventCheckinSnapshot 的 skippedPeople／getCheckinCodes 的 unsigned），
 * 但條目形狀相同、要回答的問題也相同：**這個人為什麼不在可用名單裡。**
 * 各自實作的話，兩邊會對同一種情形給出不同的答案，而且沒有東西會要求它們相等。
 *
 * 🔴 鐵則：理由只能從 payload 取。取不到就回 null，由呼叫端說「後端沒有講原因」。
 *         絕不可以寫死一個猜測——「未回覆參加？」那句話曾經把人導向錯的排查方向，
 *         而真正的原因（缺內部碼／名冊查無此碼／離職）就在 payload 裡。
 */

/** 兩支 payload 的「簽不出來的人」清單，正規化成同一個形狀。 */
function pfPeople(res) {
  var a = (res && res.unsigned) || [];
  var b = (res && res.skippedPeople) || [];
  return a.concat(b);
}

/** 重複回覆、只簽一張的那些（不算失敗，但要講）。 */
function pfDuplicated(res) {
  return (res && res.duplicated) || [];
}

/**
 * 這個內部碼的人為什麼不在可用名單裡。
 * 只認內部碼，**不用姓名比對**——同名的人會拿到別人的理由。
 * @return {?string} payload 說得出來就回那句話，說不出來回 null。
 */
function pfWhy(res, code) {
  var c = String(code || '').trim();
  if (!c) return null;
  var hit = null;
  pfPeople(res).forEach(function (x) {
    if (!hit && String((x && x.internalId) || '').trim() === c) hit = x;
  });
  if (hit && hit.why) return hit.why;
  var dup = null;
  pfDuplicated(res).forEach(function (x) {
    if (!dup && String((x && x.internalId) || '').trim() === c) dup = x;
  });
  if (dup) return '重複回覆，已併成同一張碼';
  return null;
}

/**
 * 缺口：權威數字（減法）與清單長度（列舉）的差。
 * >0 ⇒ 有種類沒被列舉到，清單會比數字少人——不講的話操作者會把清單讀成完整的。
 */
function pfGap(res) {
  var n = Number((res && res.unclassified) || 0);
  return n > 0 ? n : 0;
}

/** 逐人清單。螢幕、zip 內的說明檔、掃描站的展開區都用這一份。 */
function pfText(res) {
  var u = pfPeople(res), d = pfDuplicated(res), out = [];
  if (u.length) {
    out.push('未簽發（' + u.length + ' 人）：');
    u.forEach(function (x) {
      out.push('  ・' + (x.unit || '（未分單位）') + '　' + x.name + '　—　' + (x.why || '後端沒有講原因'));
    });
  }
  if (d.length) {
    out.push('重複回覆、只簽一張（' + d.length + ' 筆）：');
    d.forEach(function (x) { out.push('  ・' + (x.unit || '（未分單位）') + '　' + x.name); });
  }
  var gap = pfGap(res);
  if (gap) out.push('⚠ 另有 ' + gap + ' 人不在上面這份清單裡（後端沒有分類出原因）——清單比實際少人');
  return out.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pfPeople: pfPeople, pfDuplicated: pfDuplicated,
    pfWhy: pfWhy, pfGap: pfGap, pfText: pfText };
}
