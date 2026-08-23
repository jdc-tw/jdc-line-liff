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
  template: BC_TPL, defaultTemplate: BC_TPL, tplHasUrl: true,
  schedule: null, defaultDate: '2026-08-27', hasDate: true,
  // 補發下拉用的名單（依單位分組）
  people: [
    { userId: 'U_a', name: '洪炫佑', unit: '工務管理組' },
    { userId: 'U_b', name: '柯佳岑', unit: '工務管理組' },
    { userId: 'U_c', name: '中西豊', unit: '支店主管' }] };
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
  getAnniversaries: { ok: true, year: 2026, rows: [
    { name: '林玉娟', unit: '宸實永寧', years: 20, date: '2006-08-08' },
    { name: '賴雅慧', unit: '管理部', years: 15, date: '2011-04-21' }] },
  previewPassBroadcast: BC_OK,
  // 掃描站管理：一站已存在，用來驗列表／複製／換發／刪除的畫面
  listStaffStations: { ok: true, actId: 'actTEST', rows: STATIONS },
  addStaffStation: { ok: true, token: 'tokNEW', station: '第 3 站' },
  // 資深夥伴通知（2026-08-16）：三種狀態都要有，否則驗不到「對不到的人被停用勾選」
  getSeniorNotice: { ok: true, year: 2026, years: [2027, 2026, 2025, 2024],
    titles: ['忘年會表揚提醒', '社內報問卷邀請', '問卷截止提醒'],
    templates: ['第一則內容（忘年會）', '第二則內容（問卷邀請）', '第三則內容（截止提醒）'],
    audience: [
      { name: '林玉娟', unit: '宸實永寧', years: 20, date: '2006-08-08', userId: 'U_lin', status: 'ok' },
      { name: '賴雅慧', unit: '管理部', years: 15, date: '2011-04-21', userId: 'U_lai', status: 'ok' },
      { name: '未綁定者', unit: '施工部', years: 10, date: '2016-01-01', userId: '', status: 'unbound' },
      { name: '同名者', unit: '施工圖組', years: 5, date: '2021-01-01', userId: '', status: 'ambiguous' }],
    sent: { '2026|0': { at: '2026-01-14 09:30', count: 9, names: ['林玉娟', '賴雅慧'] } } },
  saveSeniorTemplate: { ok: true },
  savePassTemplate: { ok: true },
  // 回覆明細：同一單位要有參加也有不參加，才驗得到「不參加 N」那顆標籤
  getActivityReplies: { ok: true, rows: [
    { unit: '工務管理組', name: '洪炫佑', attend: '參加',   diet: '葷', time: '07/01 10:00', opinion: '' },
    { unit: '工務管理組', name: '柯佳岑', attend: '不參加', diet: '',   time: '07/01 11:00', opinion: '當天出差' },
    { unit: '工務管理組', name: '甲三',   attend: '不參加', diet: '',   time: '07/02 09:00', opinion: '' },
    { unit: '支店主管',   name: '中西豊', attend: '參加',   diet: '素', time: '07/01 09:00', opinion: '' }] },
  schedulePassBroadcast: { ok: true },
  cancelPassSchedule: { ok: true },
  addSeniorTemplate: { ok: true, idx: 3 },
  removeSeniorTemplate: { ok: true },
  sendSeniorNotice: { ok: true, sent: 2, failed: 0, failures: [] },
  removeStaffStation: { ok: true },
  batch: {
    ok: true,
    results: {
      listActivities: ACTS,
      getActivityStats: { ok: false, msg: '（驗收頁不驗統計分頁）' },
      getAnniversaries: { ok: true, year: 2026, rows: [
        { name: '林玉娟', unit: '宸實永寧', years: 20, date: '2006-08-08' }] },
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
  // ?sn=err → 伺服器丟例外的形狀 {ok:false,error}（沒有 msg）。
  // 2026-08-16 senior.js 漏部署時就是這個回應，而畫面只寫「載入失敗」。
  // 驗 surfaceErr() 有沒有把原因撈出來——這是唯一能證明它有效的情境。
  var _sc = new URLSearchParams(location.search).get('sched');
  if (_sc === 'on') R.previewPassBroadcast = Object.assign({}, R.previewPassBroadcast,
    { schedule: { date: '2026-08-27', time: '16:00', status: 'scheduled', by: '洪炫佑' } });
  // ?sched=old → 加時間功能（2026-08-24）之前存的預約：沒有 time 欄位，畫面該顯示 09:00（當年每日掃描時刻）
  if (_sc === 'old') R.previewPassBroadcast = Object.assign({}, R.previewPassBroadcast,
    { schedule: { date: '2026-08-27', status: 'scheduled', by: '洪炫佑' } });
  if (_sc === 'nodate') R.previewPassBroadcast = Object.assign({}, R.previewPassBroadcast,
    { hasDate: false, eventDate: '' });
  if (_sc === 'sent') R.previewPassBroadcast = Object.assign({}, R.previewPassBroadcast,
    { schedule: { date: '2026-08-27', status: 'sent', sentAt: '2026-08-27 09:00', sent: 135, failed: 0 } });
  if (_sc === 'failed') R.previewPassBroadcast = Object.assign({}, R.previewPassBroadcast,
    { schedule: { date: '2026-08-27', status: 'failed', error: '桌次尚未發布' } });
  if (new URLSearchParams(location.search).get('sn') === 'err')
    R.getSeniorNotice = { ok: false, error: 'SENIOR_TITLES is not defined' };
  window.__vegCalls = [];
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('script.google.com') < 0) return realFetch.apply(this, arguments);
    var action = (u.match(/[?&]action=([^&]*)/) || [])[1] || '';
    action = decodeURIComponent(action);
    window.__vegCalls.push(action);
    var body = R[action] || { ok: true };
    // batch 動態組裝（2026-08-24 修 fixture 腐爛）：報到分頁 8/23 起把子查詢打包成
    // action=batch&list=[{a,p}...]，固定的 R.batch 內容跟不上 list 的變化——
    // 改成拆開 list、逐項用 R 裡的單項回應組回去，固定內容只當 fallback。
    var lm = u.match(/[?&]list=([^&]*)/);
    if (action === 'batch' && lm) {
      try {
        var results = {};
        JSON.parse(decodeURIComponent(lm[1])).forEach(function (it) {
          // 先找單項回應，再退回舊固定 batch 內容（getActivityStats 只活在那裡，
          // 給它 {ok:true} 空殼會讓 renderStats 讀 undefined 崩潰）
          results[it.a] = R[it.a] || (R.batch && R.batch.results && R.batch.results[it.a]) || { ok: true };
          window.__vegCalls.push('batch:' + it.a);
        });
        body = { ok: true, results: results };
      } catch (e) { /* 解析失敗就退回固定 R.batch */ }
    }
    return Promise.resolve({ text: function () { return Promise.resolve('cb(' + JSON.stringify(body) + ')'); } });
  };
})();
</script>
`;

// VEG_SRC=<路徑> 可指向 curl 下來的線上檔——驗「部署出去的那份」而不是 repo 副本
// （2026-08-16：repo 綠不代表線上綠，部署管線少一步就驗不出來）。
const src = fs.readFileSync(process.env.VEG_SRC || path.join(__dirname, '..', '..', 'stats.html'), 'utf8');
const i = src.indexOf('<head>');
if (i < 0) { console.error('找不到 <head>，stats.html 結構變了'); process.exit(1); }
// assets/*.js 加一個隨機查詢字串：瀏覽器會把同名檔留在記憶體快取裡，改了 asset 卻沿用舊版，
// 於是「驗到的不是你剛改的那份」而且完全沒有徵兆（2026-08-16 就這樣誤判了一次 anniv.js）。
const bust = process.env.VEG_BUST || String(Date.now());
const withBust = (src.slice(0, i + 6) + '\n' + stub + src.slice(i + 6))
  .replace(/(src=")(assets\/[^"]+\.js)(")/g, (m, a, f, z) => a + f + '?v=' + bust + z);
const out = withBust;

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
