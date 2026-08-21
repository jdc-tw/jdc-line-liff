const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 由來（2026-08-21）：board.html 十支寫入動作加 nonce，讓後端能認領並「重播第一次的結果」。
//
// 為什麼這一頁比 stats.html 更需要它：
//   stats.html 的 jsonp(action, params, timeoutMs) 只在 timeoutMs==null 時重試（＝只有讀取重試）。
//   board.html 的 jsonp(action, params) **沒有第三個參數，重試是無條件的**——
//   十支寫入動作每一支都會在失敗 2 秒後自動重跑一次。資料不會被寫兩次（後端每支
//   都有狀態守門），但**頁面收到的是第二次的回應**，於是動作成功了卻顯示
//   「此筆已處理」「已存在」。nonce 治的就是這個假紅字。
//
// ⚠️ 這組測試守的是**順序**，不是「有沒有 nonce」。整件事唯一會靜默失效的形態是
//    把 nonce 就地寫進 jsonp 參數（`nonce:newNonce()`）——仍然有 nonce、仍然送得出去，
//    但每次重送都換一個，後端認不出是同一次操作，整件事安靜地白做。
//
// ⚠️ 本頁四支的呼叫在 onclick 處理器裡。nonce 必須在**處理器內**產生：繪製只跑一次、
//    點擊可以很多次，把它提到外層繪製函式會讓第二次真正的點擊被當成重播而**靜默不執行**。
//    那比沒有保護更糟。下面用「最近的進入點」界定範圍，就是為了抓這一種。

const SRC = fs.readFileSync(path.join(__dirname, '..', 'board.html'), 'utf8');

// 十個寫入動作（revertHrChange 有兩個呼叫點：撤銷待生效、恢復已駁回）
const WRITE_ACTIONS = [
  'approveCheckin', 'requeueCheckinMail', 'revertHrChange', 'confirmHrChange',
  'rejectHrChange', 'batchTransferUnit', 'addUnit', 'addTitle', 'updateOption',
];
// 唯讀動作：刻意不帶 nonce（每個帶 nonce 的呼叫要多一次 ScriptLock 與兩次 Property
// 讀寫，而讀取重播本來就無害）
const READ_ACTIONS = ['getUndelivered', 'batch', 'listHrNotices', 'listOptions',
                      'getHrPending', 'getRosterList'];

/** 所有 jsonp('<action>' 的位置。 */
function callSites(action) {
  const needle = "jsonp('" + action + "'";
  const out = [];
  for (let i = SRC.indexOf(needle); i >= 0; i = SRC.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * 呼叫點所屬「進入點」的起頭：最靠近它、且在它之前的
 * `onclick=function(){` 或行首 `function 名(...){`。
 * 刻意不做大括號配對——字串裡的大括號會讓配對失準。用進入點界定範圍就夠了，
 * 而且正好抓得到「nonce 被提到外層繪製函式」那一種。
 */
function entryStart(idx) {
  const re = /onclick\s*=\s*function\s*\(\s*\)\s*\{|\nfunction\s+\w+\s*\([^)]*\)\s*\{/g;
  let last = -1, m;
  while ((m = re.exec(SRC)) && m.index < idx) last = m.index;
  assert.ok(last >= 0, '找不到呼叫點所屬的進入點');
  return last;
}

WRITE_ACTIONS.forEach((action) => {
  const sites = callSites(action);

  test(`${action}：找得到呼叫點`, () => {
    assert.ok(sites.length > 0,
      action + ' 的呼叫點不見了——它被改名或刪了，這組測試要跟著改');
  });

  sites.forEach((idx, n) => {
    const tag = sites.length > 1 ? `${action}#${n + 1}` : action;
    const prefix = SRC.slice(entryStart(idx), idx);   // 進入點 → 呼叫之間的程式碼

    test(`${tag}：nonce 在自己的進入點內產生（不是外層繪製函式）`, () => {
      assert.ok(prefix.indexOf('newNonce()') >= 0,
        tag + ' 的 nonce 不在自己的進入點內。若它被提到外層繪製函式，'
        + '同一張卡片按第二次會沿用第一次的 nonce ⇒ 後端當成重播 ⇒ **真正的第二次點擊靜默不執行**');
    });

    test(`${tag}：nonce 早於 confirm／prompt`, () => {
      const nPos = prefix.indexOf('newNonce()');
      [/confirm\(/, /prompt\(/].forEach((re) => {
        const m = re.exec(prefix);
        if (!m) return;
        assert.ok(nPos < m.index,
          tag + ' 的 nonce 產生在確認框之後。取消再重按會被當成同一次操作，'
          + '或把一次操作切成兩個 nonce——兩種都會讓保護失準');
      });
    });

    test(`${tag}：送出的是先前產生的變數，不是就地產生`, () => {
      // 兩種寫法都要涵蓋：參數直接寫在呼叫裡，或先組成一個變數再傳進去
      // （confirmHrChange 與 updateOption 走後者；只看呼叫那一行會漏掉它們，
      //   而漏掉是靜默的——測試會綠，保護其實沒接上）。
      const call = SRC.slice(idx, idx + 400);
      const argTxt = call.slice(call.indexOf(',') + 1).trimStart();
      let params;
      if (argTxt.startsWith('{')) {
        params = call;
      } else {
        const id = (argTxt.match(/^([A-Za-z_$][\w$]*)/) || [])[1];
        assert.ok(id, tag + ' 的第二個參數解析不出來，這組測試要跟著改');
        const decl = new RegExp('var\\s+' + id + '\\s*=\\s*\\{[^}]*\\}').exec(prefix);
        assert.ok(decl, tag + ' 找不到參數物件 ' + id + ' 的宣告');
        params = decl[0];
      }
      assert.ok(/nonce\s*:\s*nonce\b/.test(params),
        tag + ' 沒有把先前產生的 nonce 送出去');
      assert.ok(!/nonce\s*:\s*newNonce\s*\(/.test(params),
        tag + ' 在參數裡就地產生 nonce ⇒ 每次重送都換一個 ⇒ '
        + '後端認不出是同一次操作，整件事安靜地白做');
    });
  });
});

READ_ACTIONS.forEach((action) => {
  test(`唯讀 ${action} 不帶 nonce`, () => {
    callSites(action).forEach((idx) => {
      assert.ok(!/nonce/.test(SRC.slice(idx, idx + 300)),
        action + ' 是唯讀動作卻帶了 nonce——每個帶 nonce 的呼叫要多一次 ScriptLock '
        + '與兩次 Property 讀寫，讀取重播本來就無害，不值得付');
    });
  });
});

test('十個寫入呼叫點全部涵蓋，一個都沒漏', () => {
  const covered = WRITE_ACTIONS.reduce((n, a) => n + callSites(a).length, 0);
  assert.strictEqual(covered, 10,
    '寫入呼叫點數量變了（現在 ' + covered + '）。新增寫入動作要一起加 nonce，'
    + '並把它列進這組測試——漏掉是靜默的');
});

test('newNonce 每次都不一樣', () => {
  const m = SRC.match(/function newNonce\(\)\{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到 newNonce 的定義');
  const fn = new Function('return function newNonce(){' + m[1] + '\n}')();
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(fn());
  assert.strictEqual(seen.size, 500, 'nonce 撞號了——撞號會把兩次不同的操作看成同一次');
});

// ── 完整性檢查：列舉「該有的」，不是列舉「壞的」 ──────────────────────────
// 上面每一條都是對著已知的十支寫。它們守不到最可能發生的那件事：
// **日後有人加一支新的寫入呼叫、忘了帶 nonce。** 那支就會靜默重跑，
// 而上面每一條都還是綠的——因為沒有人告訴它們有這支新的。
//
// 所以這裡反過來掃：board.html 的**每一個** jsonp 呼叫，都必須二擇一——
// 要嘛在唯讀白名單裡，要嘛帶 nonce。兩邊都不符合就紅，逼新增的人表態。
// （同 line-platform/tests/claspignore.test.js 的形狀：白名單漏一項是靜默的，
//   所以要列舉該放行的、而不是列舉該擋的。）
test('每一個 jsonp 呼叫都必須「在唯讀白名單裡」或「帶 nonce」，二擇一', () => {
  const all = [];
  const re = /jsonp\(\s*(['"])([A-Za-z][\w]*)\1/g;
  let m;
  while ((m = re.exec(SRC))) all.push({ action: m[2], idx: m.index });

  // 先確認掃描器沒漏：字面量呼叫數應等於全部 jsonp( 呼叫數。
  // 計數前先拿掉整行註解——本檔註解裡就有兩處 `jsonp()`，把它們算進來會讓這條
  // 永遠紅，而紅在錯的理由上比不紅更糟（人會直接把它關掉）。
  const CODE = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const total = (CODE.match(/[^A-Za-z_$.]jsonp\(/g) || []).length
    - (CODE.match(/function jsonp\(/g) || []).length;
  assert.strictEqual(all.length, total,
    '有 ' + (total - all.length) + ' 個 jsonp 呼叫的 action 不是字面字串，'
    + '這個掃描器看不到它們——掃描器要跟著改，否則它會安靜地少檢查');

  const missing = [];
  all.forEach(({ action, idx }) => {
    if (READ_ACTIONS.indexOf(action) >= 0) return;          // 唯讀白名單，刻意不帶
    const call = SRC.slice(idx, idx + 400);
    const argTxt = call.slice(call.indexOf(',') + 1).trimStart();
    let params = call;
    if (!argTxt.startsWith('{')) {
      const id = (argTxt.match(/^([A-Za-z_$][\w$]*)/) || [])[1];
      const decl = id && new RegExp('var\\s+' + id + '\\s*=\\s*\\{[^}]*\\}')
        .exec(SRC.slice(entryStart(idx), idx));
      params = decl ? decl[0] : '';
    }
    if (!/nonce\s*:\s*nonce\b/.test(params)) missing.push(action);
  });

  assert.deepStrictEqual(missing, [],
    '這些 jsonp 呼叫既不在唯讀白名單裡、也沒帶 nonce：' + missing.join('、')
    + '。本頁的 jsonp 重試是無條件的 ⇒ 它們失敗時會靜默重跑一次。'
    + '寫入的請加 nonce；唯讀的請加進 READ_ACTIONS 白名單——兩者都要**刻意**表態，'
    + '不可以什麼都不做就過關');
});

// 絆線：這一頁的重試是無條件的，那正是十支寫入都需要 nonce 的理由。
// 若日後有人把它改成有條件（例如比照 stats.html 加 timeoutMs），這條會紅，
// 逼他回來讀上面那段說明再決定 nonce 還要不要留。
test('board.html 的 jsonp 重試仍是無條件的（改了要回來重想 nonce 的必要性）', () => {
  const m = SRC.match(/function jsonp\(([^)]*)\)/);
  assert.ok(m, '找不到 jsonp 定義');
  assert.strictEqual(m[1].replace(/\s/g, ''), 'action,params',
    'jsonp 的簽章變了。若已加逾時參數並改成只有讀取才重試，'
    + '寫入類就不再被自己重試——但瀏覽器層的靜默重送仍在，nonce 是否還需要要重新判斷');
});
