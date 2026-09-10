/**
 * 排程失敗時發一則 Slack。
 *
 * 🔴 為何是一支檔案而不是 workflow 裡的 curl＋`node -e`：訊息內容要組字串、要跳脫、
 *    要判斷回應成不成功——那些寫在 YAML 的 `run:` 裡就**只能被審查、不能被測試**，
 *    而且巢狀引號在 shell 裡靜默出錯的方式有好幾種。這一支的組字串部分是純函式。
 *
 * ⚠️ 這支自己失敗時要**大聲**：通知管道靜默失效 ＝ 從此沒有人知道排程壞過。
 *    所以 Slack 回 `ok:false` 時退出碼非 0，不吞。
 */

/** 組訊息本文。純函式，測得到。 */
function buildText(o) {
  return '🔴 人事看板公開檔今天沒有更新（hr-stats-pub.json）\n'
    + '公開檔會停在舊資料，而看板會照常顯示那份舊的、不會報錯。\n'
    + '看是哪一步紅的：' + o.runUrl;
}

module.exports = { buildText };

if (require.main === module) {
  const token = process.env.SLACK_TOKEN || '';
  const channel = process.env.SLACK_CHANNEL || '';
  const runUrl = process.env.RUN_URL || '(沒有 run 連結)';
  if (!token || !channel) {
    console.error('缺 SLACK_TOKEN 或 SLACK_CHANNEL ⇒ 這則通知發不出去。');
    process.exit(1);
  }
  fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: channel, text: buildText({ runUrl: runUrl }) })
  }).then((r) => r.json()).then((j) => {
    if (!j.ok) { console.error('Slack 拒收：' + JSON.stringify(j)); process.exit(1); }
    console.log('✓ 已通知 ' + channel);
  }).catch((e) => { console.error('Slack 送不出去：' + e); process.exit(1); });
}
