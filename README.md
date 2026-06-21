# jdc-line-liff — LINE 員工身分驗證 ＋ 活動調查（前端）

公司同仁透過 LINE 完成**一次性員工身分驗證**，之後在 LINE 內填寫各種**活動出席／意願調查**的前端（LIFF 網頁，跑在 GitHub Pages）。後端為 Google Apps Script（私有 repo）。

## 📐 系統文件

- 🌐 **系統總覽（給主管／快速理解，視覺化精華頁）**：<https://jdc-tw.github.io/jdc-line-liff/docs/>
- 📄 **完整技術文件（給工程師，含流程/時序/狀態圖、限制、設定）**：[`docs/員工身分驗證-系統架構.md`](docs/員工身分驗證-系統架構.md)

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | LIFF 主頁（綁定 / 活動問卷 / 問題回報），含樂觀渲染 |
| `verify.html` | email 驗證信連結落地頁（JSONP 回呼後端完成驗證） |
| `roster.json` | 同源靜態名單（單位→姓名下拉來源） |
| `update-roster.sh` | 名單更新後重新產生 `roster.json` 並發佈 |
| `docs/` | 系統架構文件與渲染頁 |

## 架構一句話

LINE App → LIFF（本 repo, GitHub Pages）→ JSONP → Google Apps Script → Google Sheets；email 驗證信連結指向 `verify.html`（繞開 GAS 在登入態瀏覽器的限制）。詳見系統架構文件。
