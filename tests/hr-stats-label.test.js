const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * M2：人事看板的人數標籤不得叫「在職」。
 *
 * 為何存在（2026-08-28 裁決，數字不動、只改標籤）：
 * hr-stats 的 s.total 由 hrstats.js buildHrStats 算，**只排除離職、含留職停薪**
 *（年資／退休預警需要含他們）；而名冊看板寫的是「在職 48・留停 2」。
 * 兩邊都叫「在職」的話，同一個人開兩個看板會看到兩個不一樣的「在職 N 人」。
 * 這條釘住標籤，不釘數字——數字是刻意不同步的。
 */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'hr-stats.html'), 'utf8');

/** 抓「印出 s.total 的那一行」——標籤與數字必須在同一行才算數。 */
function totalLines() {
  return HTML.split('\n').filter((l) => /s\.total/.test(l) && !/^\s*\/\//.test(l));
}

test('M2：印出 s.total 的每一行都不得把它叫「在職」', () => {
  const bad = totalLines().filter((l) => /在職(?!狀態)/.test(l) && !/留職停薪/.test(l));
  assert.deepStrictEqual(bad.map((l) => l.trim()), [],
    '這個數字含留職停薪，叫「在職」會與名冊看板的「在職 N 人」打架（同一個人看到兩個答案）');
});

test('M2：主要人數標籤（資料來源那行＋KPI）要明說含留職停薪', () => {
  // 只看「人數標籤」那幾行，不看拿 s.total 做算術的行（單位占比、waffle 格數…）——
  // 那些沒有對使用者說出一個名字，不在這條裁決的範圍內。
  const labels = totalLines().filter((l) => /在編/.test(l));
  assert.ok(labels.length >= 2,
    `預期至少兩處人數標籤（資料來源那行＋KPI），實際 ${labels.length} 處——標籤被改回別的字了？`);
  labels.forEach((l) => {
    assert.ok(/含留職停薪/.test(l),
      `標籤沒說含留職停薪，讀的人無從知道它跟名冊看板為何對不起來：\n  ${l.trim()}`);
  });
});

/** 切出「⑪ 入社年度趨勢」那張卡的原始碼，只有那張。
 *
 *  🔴 為何要另外切，不能沿用 `totalLines()`：這張卡畫的是 `trend.counts`，
 *     由 `s.joinYears` 累加而來，**那幾行沒有 `s.total`** ⇒ 上面兩條測試的定義域
 *     從來就不含它。2026-08-29 把資料來源行與 KPI 標題改成「在編」時，
 *     這張卡的三處圖例**整批漏改**，而全套測試照樣綠——
 *     漏掉的原因不是有人不小心，是**沒有任何東西在看那幾行**。
 *
 *  🔴 **這個切法換過兩次，兩次都是被實測打掉的，寫下來免得有人「順手簡化」回去：**
 *
 *  ① 第一版用 `/入社年度趨勢/` 當錨點 ⇒ **命中兩行，其中一行是區段註解**。
 *     後果：有人把卡片標題改名、註解沒跟著改，下面那個「抓得到幾行」的零點
 *     **被註解一行撐著照樣通過**，而真正要看的那一行已經沒被看了。
 *     （memory `feedback_comment_is_source_code` 第三形態：讓自己的斷言假通過。）
 *
 *  ② 第二版加了 `/label:'累計/` 想多抓圖例 ⇒ **抓到了「⑰ 退休預警」那張卡的
 *     `label:'累計（含已滿 65）'`**，那是完全不相干的一張。實測後果：把卡片標題
 *     改名之後，零點 `>= 2` 被**兩條別張卡的行**撐著，一聲都沒響。
 *     ⇒ 「多抓一點比較保險」在這裡是反的：**抓進不相干的行，等於把零點關掉。**
 *
 *  現在改成**明確切一張卡**：從標題那一行到它自己的收尾 `+'</div>';`。
 *  卡不見了就回空陣列 ⇒ 零點會響。
 */
function trendCardLines() {
  const all = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l));
  const i = all.findIndex((l) => /<b>⑪ 入社年度趨勢<\/b>/.test(l));
  if (i < 0) return [];
  const rest = all.slice(i);
  const j = rest.findIndex((l, k) => k > 0 && /\+'<\/div>';/.test(l));
  return j < 0 ? rest : rest.slice(0, j + 1);
}

test('M2：入社年度趨勢的圖例也不得把母體叫「在職」（它與 KPI 同樣含留職停薪）', () => {
  const lines = trendCardLines();
  // 零點：抓不到行就代表這條在空跑，而空跑與通過長得一模一樣。
  assert.ok(lines.length >= 2,
    `切不出入社年度趨勢那張卡（實際 ${lines.length} 行）——卡片改版或改名了？這條測試已經沒在看任何東西`);
  // ⬛ 對照組：切到的必須真的是**這張**卡。只數行數的話，切錯一張卡也會通過。
  assert.ok(lines.some((l) => /trend\.counts/.test(l)),
    '切出來的區塊裡沒有 trend.counts ⇒ 切到別張卡了，這一輪驗的不是入社年度趨勢');

  const bad = lines.filter((l) => /在職(?!狀態)/.test(l));
  assert.deepStrictEqual(bad.map((l) => l.trim()), [],
    '這張卡的母體與 KPI 一樣「只排除離職、含留職停薪」，叫「在職」會與名冊看板打架');

  assert.ok(lines.some((l) => /在編/.test(l)),
    '圖例裡一處「在編」都沒有——母體的名字被換成別的字了？');
});

test('🔴 M2 附帶：這張卡的母體比 KPI 再窄一層，圖例必須說出來', () => {
  // 實測（2026-09-10，`jdc-line-gas/line-platform/hrstats.js`）：
  //   `out.total++`   在「只排除離職」之後就累加
  //   `out.joinYears` 在 `yearsBetween_(入社日) !== null` 的分支裡才累加
  // ⇒ **沒有入社日期的人進 `out.noJoin`，不進 joinYears。**
  //    這張卡的母體 ＝ 在編 ∩ 有入社日者，**不等於 KPI 的在編**。
  //    隔壁「③ 全公司年資分佈」吃同一批資料，副標寫著「只含有入社日者」——
  //    同一個限制寫在一張卡上、另一張沒寫，那是同一個判斷散在兩處而沒被要求相等。
  const lines = trendCardLines();
  assert.ok(lines.some((l) => /有入社日/.test(l)),
    '圖例沒說「只含有入社日者」，讀的人會以為這條線的人數等於 KPI 的在編人數，而它是子集');
});
