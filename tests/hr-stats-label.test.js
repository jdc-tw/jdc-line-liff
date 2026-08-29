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
