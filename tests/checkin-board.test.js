const { test } = require('node:test'); const assert = require('node:assert');
const { renderBoardHtml } = require('../assets/checkin-board.js');
test('renderBoardHtml：含到/未到/臨時與單位列', () => {
  const html = renderBoardHtml({ total:3, arrived:2, walkins:1, notArrived:1,
    byUnit:{A:{arrived:1,total:2}}, byStation:{S1:1}, notArrivedList:[{name:'乙',unit:'A'}] });
  assert.ok(html.indexOf('未到') !== -1 && html.indexOf('乙') !== -1 && html.indexOf('臨時 1') !== -1);
});
test('renderBoardHtml：無臨時時不顯示臨時字樣', () => {
  const html = renderBoardHtml({ total:3, arrived:2, walkins:0, notArrived:1,
    byUnit:{}, byStation:{}, notArrivedList:[] });
  assert.ok(html.indexOf('臨時') === -1);
});
