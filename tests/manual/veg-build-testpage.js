/**
 * 產生 UI 驗收用的測試頁 /tmp/veg-test.html。
 *
 * 手法：把 stats.html 原封複製，只在最前面插一段 script 覆寫 window.fetch，
 * 讓所有 GAS 請求回 veg-fixture。**只換網路層，不碰 DOM**——
 * 頁面仍走自己的啟動流程（inline script 完整執行、事件照綁），
 * 所以語法錯誤、初始化早退、CSS 破版這些都還驗得到。
 *
 * 為什麼不用 playwright 的 route 攔截：這個 repo 沒有 package.json，
 * 裝 playwright 要另外拉 ~150MB 的瀏覽器二進位。改用這招後任何瀏覽器都能開。
 *
 * 用法：node tests/manual/veg-build-testpage.js
 *      cd /tmp/veg-ui && python3 -m http.server 8899
 *      開 http://localhost:8899/veg-test.html?t=dummy
 *
 * 產物全在 /tmp/veg-ui/（repo 一個檔都不多）：測試頁 ＋ 一個指回 repo assets/ 的 symlink。
 * 為什麼不放 repo 根：這是 public repo，多一個測試頁就多一次被 git add -A 掃上去的機會，
 * 還要為此新增 .gitignore——為了驗收去動 repo 結構，代價不對。
 * 為什麼要 http 不用 file://：playwright MCP 擋 file: 協定。
 */
const fs = require('fs');
const path = require('path');
const FIXTURE = require('./veg-fixture.js');

const ACTS = { ok: true, rows: [{ id: 'actTEST', name: '驗收用活動', status: '開放', open: true, replies: 5 }] };

// 報到碼通知（2026-08-16）：預覽必須回真實形狀，否則驗不到「未發布時發送鈕不解鎖」。
// 兩種情境由網址 ?bc=nopub 切換——published:false 是最該驗的那條（送出去收不回來）。
const BC_TPL = '【{活動名}】　{日期}\n您的桌次：{桌次}\n\n報到碼請由下方連結開啟，現場出示給工作人員掃描：\n{連結}';
const BC_OK = {
  ok: true, actName: '驗收用活動', eventDate: '2026/08/28', published: true,
  participants: 137, willSend: 135, unbound: ['甲同仁', '乙同仁'],
  sample: '【驗收用活動】　2026/08/28\n您的桌次：21 桌\n\n報到碼請由下方連結開啟，現場出示給工作人員掃描：\nhttps://liff.line.me/2010451233-a781rqsm?mode=pass&act=actTEST',
  template: BC_TPL, tplHasUrl: true };
const BC_NOPUB = Object.assign({}, BC_OK, { published: false });
// ?bc=nourl → 範本被刪掉 {連結}，驗「發送鈕不解鎖＋紅字提醒」
const BC_NOURL = Object.assign({}, BC_OK, {
  template: '【{活動名}】　{日期}\n您的桌次：{桌次}', tplHasUrl: false,
  sample: '【驗收用活動】　2026/08/28\n您的桌次：21 桌' });

// 2026-08-16：掃描站改由 getSeatingBoard 一併帶回（省一趟 /exec），
// fixture 要跟著補 stations，否則驗不到併車那條路、只會驗到「站別是空的」。
const STATIONS = [
  { token: 'tok1AAA', station: '第 1 站',
    url: 'https://campaign.jdc-corpn.com.tw/staff.html?t=tok1AAA&act=actTEST' },
  { token: 'tok2BBB', station: '報到台（主桌區）',
    url: 'https://campaign.jdc-corpn.com.tw/staff.html?t=tok2BBB&act=actTEST' }];

const RESPONSES = {
  getSeatingBoard: Object.assign({}, FIXTURE, { stations: STATIONS }),
  listActivities: ACTS,
  getAnniversaries: { ok: true, rows: [] },
  previewPassBroadcast: BC_OK,
  // 掃描站管理：一站已存在，用來驗列表／複製／換發／刪除的畫面
  listStaffStations: { ok: true, actId: 'actTEST', rows: STATIONS },
  addStaffStation: { ok: true, token: 'tokNEW', station: '第 3 站' },
  removeStaffStation: { ok: true },
  batch: {
    ok: true,
    results: {
      listActivities: ACTS,
      getActivityStats: { ok: false, msg: '（驗收頁不驗統計分頁）' },
      getAnniversaries: { ok: true, rows: [] },
    },
  },
};

const stub = `<script>
(function () {
  var R = ${JSON.stringify(RESPONSES)};
  // ?bc=nopub → 桌次未發布；?bc=nourl → 範本少了 {連結}。兩者都要讓發送鈕鎖著
  var _bc = new URLSearchParams(location.search).get('bc');
  if (_bc === 'nopub') R.previewPassBroadcast = ${JSON.stringify(BC_NOPUB)};
  if (_bc === 'nourl') R.previewPassBroadcast = ${JSON.stringify(BC_NOURL)};
  window.__vegCalls = [];
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('script.google.com') < 0) return realFetch.apply(this, arguments);
    var action = (u.match(/[?&]action=([^&]*)/) || [])[1] || '';
    action = decodeURIComponent(action);
    window.__vegCalls.push(action);
    var body = R[action] || { ok: true };
    return Promise.resolve({ text: function () { return Promise.resolve('cb(' + JSON.stringify(body) + ')'); } });
  };
})();
</script>
`;

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'stats.html'), 'utf8');
const i = src.indexOf('<head>');
if (i < 0) { console.error('找不到 <head>，stats.html 結構變了'); process.exit(1); }
const out = src.slice(0, i + 6) + '\n' + stub + src.slice(i + 6);

// 全部產在 /tmp/veg-ui：測試頁 ＋ 指回 repo assets/ 的 symlink（相對路徑照吃，repo 不多檔）
const repo = path.join(__dirname, '..', '..');
const dir = '/tmp/veg-ui';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'veg-test.html'), out);
const link = path.join(dir, 'assets');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(repo, 'assets'), link, 'dir');

console.log('已產生 /tmp/veg-ui/veg-test.html（assets 走 symlink 指回 repo）');
console.log('注入的假回應：', Object.keys(RESPONSES).join('、'));
console.log('接著：cd /tmp/veg-ui && python3 -m http.server 8899');
console.log('然後開 http://localhost:8899/veg-test.html?t=dummy');
