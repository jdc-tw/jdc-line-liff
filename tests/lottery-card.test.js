const { test } = require('node:test'); const assert = require('node:assert');
const { renderLotteryCard } = require('../assets/lottery-card.js');

test('renderLotteryCard：得獎者含名次/累積/逐輪四態/待確認合計', () => {
  const html = renderLotteryCard({ name:'某人', rank:1, wins:4, total:12000, pendingTotal:3000,
    rounds:[{round:'第1輪',amount:3000,status:'已領獎'},{round:'第2輪',amount:3000,status:'待確認'}] });
  assert.ok(html.indexOf('第 1 名') !== -1 && html.indexOf('12,000') !== -1);
  assert.ok(html.indexOf('第1輪') !== -1 && html.indexOf('待確認') !== -1);
  assert.ok(html.indexOf('另有待確認') !== -1);
});
test('renderLotteryCard：未中獎顯示尚未中獎、無名次', () => {
  const html = renderLotteryCard({ name:'某人', rank:20, wins:0, total:0, pendingTotal:0, rounds:[] });
  assert.ok(html.indexOf('尚未中獎') !== -1);
  assert.ok(html.indexOf('第 20 名') === -1);
});
test('renderLotteryCard：無待確認不顯示合計行', () => {
  const html = renderLotteryCard({ name:'甲', rank:7, wins:1, total:3000, pendingTotal:0,
    rounds:[{round:'第1輪',amount:3000,status:'已領獎'}] });
  assert.ok(html.indexOf('另有待確認') === -1);
});
