#!/usr/bin/env bash
# 手動把最新員工名單灌進 roster.json 並推上 GitHub Pages（本機跑、用於臨時強制刷新）。
# 正常更新已自動化：見 .github/workflows/update-roster.yml（每日排程＋Run workflow 手動按鈕，零密鑰）。
# 這支保留作為本機手動逃生口；平時不需要跑。
set -euo pipefail
cd "$(dirname "$0")"

GAS='https://script.google.com/macros/s/AKfycbxaDoA_7aOW325p8165VegSqdRL8gRhfTEMfjosdh1A0T4rmzj4Pl7F3k5PToe2po-xtg/exec'

echo "→ 從 GAS 取最新名單…"
curl -sL "$GAS?action=getUnitsAndNames&callback=__cb" | sed -E 's/^__cb\((.*)\)$/\1/' > roster.json

# 驗證 JSON 正確再 commit（壞掉就不推）
node -e "const r=require('./roster.json'); if(!r.units||!r.namesByUnit||!r.units.length) throw new Error('roster.json 內容異常'); console.log('✓ units:',r.units.length);"

if git diff --quiet roster.json; then
  echo "名單無變動，不需更新。"
  exit 0
fi

git add roster.json
git commit -m "chore: 更新員工名單 roster.json"
git push
echo "✓ 已更新並推上 GitHub Pages（約 1–2 分鐘生效）"
