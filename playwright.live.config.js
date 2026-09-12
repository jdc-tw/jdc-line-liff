/**
 * 線上站台 × 引擎對照的 e2e 設定（2026-09-12，線 K）。
 *
 * 🔴 **為何另開一份 config，而不是往 playwright.config.js 加 project。**
 *    那一份的檔頭寫著「不要去打線上的 Pages」，而且它掛著一個會啟動本機 server 的
 *    `webServer`。這一份的目的**正好相反**：受測物就是線上那份 HTML。
 *    兩種目的混在同一份設定裡，下一個人只會踩到「我以為在驗本機、其實打了線上」
 *    或反過來。所以分開，並各自在檔頭寫明自己驗的是哪一份。
 *
 * 🔴 **為何要有 chrome 與 webkit 兩組一模一樣的 project。**
 *    只跑 WebKit 一輪、全綠，與只跑 Chromium 一輪、全綠，長得一模一樣——
 *    那一輪什麼都沒測到。鑑別力來自「同一批頁、同一批斷言，兩個引擎各跑一次，
 *    輸出並排」。`tools/live-engine-diff.py` 就是做這件並排的。
 *
 * ⚠️ **這裡的 webkit 不等於 iOS 上的 LINE 內建瀏覽器。** 它是 Playwright 自帶的
 *    WebKit build（`npx playwright install webkit`），與使用者手機上的版本不同，
 *    而且不是 WKWebView、沒有 LINE 的 in-app 設定、沒有真的 LIFF SDK。
 *    它能證明的是「這些頁在 WebKit 引擎上會不會炸」，
 *    **證明不了「在 LINE 裡打開會不會炸」**。涵蓋到哪裡、哪裡仍空白，見
 *    tests/live/live-engine.spec.js 檔尾的「這批證據的邊界」。
 */
const { devices } = require('@playwright/test');

const DESKTOP = { width: 1280, height: 800 };
// iPhone 13 的視窗與像素密度。**刻意把 UA／isMobile 也一起帶到 chromium 那一組**——
// 只有引擎這一個變因不同，UA／視窗／touch 全部相同，差異才歸得到引擎頭上。
const IPHONE = devices['iPhone 13'];

module.exports = {
  testDir: './tests/live',
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'https://campaign.jdc-corpn.com.tw',
    // 🔴 不 ignoreHTTPSErrors——憑證本身也是受測範圍的一部分。
  },
  projects: [
    { name: 'desktop-chrome',  use: { browserName: 'chromium', channel: 'chrome', viewport: DESKTOP } },
    { name: 'desktop-webkit',  use: { browserName: 'webkit', viewport: DESKTOP } },
    { name: 'mobile-chrome',   use: { ...IPHONE, browserName: 'chromium', channel: 'chrome' } },
    { name: 'mobile-webkit',   use: { ...IPHONE, browserName: 'webkit' } },
  ],
};
