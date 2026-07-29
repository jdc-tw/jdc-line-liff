#!/usr/bin/env bash
# 手動把最新單位／職稱選項灌進 roster.json 並推上 GitHub Pages（本機跑、用於臨時強制刷新）。
# 正常更新已自動化：見 .github/workflows/update-roster.yml（每日排程＋Run workflow 手動按鈕，零密鑰）。
# 這支保留作為本機手動逃生口；平時不需要跑。
#
# ⚠️ roster.json 在 PUBLIC repo ＋ GitHub Pages 上匿名可讀，不得含姓名等個資
# （2026-07-29 前含 153 位同仁姓名）。下方防護與 workflow 同步，別拿掉。
set -euo pipefail
cd "$(dirname "$0")"

GAS='https://script.google.com/macros/s/AKfycbxaDoA_7aOW325p8165VegSqdRL8gRhfTEMfjosdh1A0T4rmzj4Pl7F3k5PToe2po-xtg/exec'

echo "→ 從 GAS 取最新選項…"
# 先寫 .new 再換檔：curl 失敗時不會把現有 roster.json 清空（-f 讓 HTTP 錯誤也算失敗）
curl -fsSL "$GAS?action=getUnitsAndNames&callback=__cb" | sed -E 's/^__cb\((.*)\)$/\1/' > roster.json.new

# 驗證內容正確、且沒夾帶個資再換檔（與 update-roster.yml 同一套防護）
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("roster.json.new", "utf8"));
  if (!r.units || !r.units.length || !r.titles || !r.titles.length) throw new Error("roster.json 內容異常");
  if (r.namesByUnit) throw new Error("偵測到 namesByUnit（同仁姓名清單），這是公開檔，放棄更新");
  const ALLOW = { units: 1, titles: 1, unitGroups: 1, titleGroups: 1 };
  const extra = Object.keys(r).filter(function (k) { return !ALLOW[k]; });
  if (extra.length) throw new Error("出現未預期欄位，恐夾帶個資：" + extra.join(","));
  console.log("✓ units:", r.units.length, "| titles:", r.titles.length);
'
mv roster.json.new roster.json

if git diff --quiet roster.json; then
  echo "名單無變動，不需更新。"
  exit 0
fi

git add roster.json
git commit -m "chore: 更新員工名單 roster.json"
git push
echo "✓ 已更新並推上 GitHub Pages（約 1–2 分鐘生效）"
