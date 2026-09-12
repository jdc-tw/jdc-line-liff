#!/usr/bin/env python3
"""board.html 會呼叫的每一支 action，在後端有沒有「第二道只認 ?t= 的檢查」。

為何要機械掃：修法都是對的，錯的是「符合條件的地方有哪些」沒被列出來。
⬛ 對照組內建：已知沒有第二道的 getCheckinOptions 必須被判成「乾淨」，
   否則這把尺什麼都沒測到。
"""
import re, pathlib, sys

LIFF = pathlib.Path('/private/tmp/claude-502/-Users-YUYUYUYU-Projects-yu-agent/4c00453d-88d8-4fbe-992d-3272de55ac9b/scratchpad/wt-lineL')
GAS = pathlib.Path('/Users/YUYUYUYU/Projects/jdc-line-gas/line-platform')

# ① board.html（含它載入的 assets）會呼叫哪些 action
srcs = [LIFF / 'board.html'] + sorted((LIFF / 'assets').glob('*.js'))
actions = set()
for p in srcs:
    t = p.read_text(encoding='utf-8')
    actions |= set(re.findall(r"jsonp\(\s*'([A-Za-z0-9_]+)'", t))
    actions |= set(re.findall(r"\{\s*a\s*:\s*'([A-Za-z0-9_]+)'", t))   # batch 的 list
print(f'board.html 側找到 {len(actions)} 支 action')
if not actions:
    print('🔴 一支都沒找到 ⇒ 這把尺壞了，下面全部不算數'); sys.exit(1)

code = (GAS / 'Code.js').read_text(encoding='utf-8')
# 每支 function 的本體（到下一個頂層 function 為止）
bodies = {}
tops = [(m.start(), m.group(1)) for m in re.finditer(r'^function ([A-Za-z0-9_]+)\s*\(', code, re.M)]
for i, (pos, name) in enumerate(tops):
    end = tops[i + 1][0] if i + 1 < len(tops) else len(code)
    bodies[name] = code[pos:end]

MSG = '無權限或連結已失效。'
dirty, clean, missing = [], [], []
for a in sorted(actions):
    b = bodies.get(a)
    if b is None:
        missing.append(a); continue
    head = b[:1200]          # 守門一律在開頭幾行
    if 'validateBoardToken_' in head:
        dirty.append(a)
    else:
        clean.append(a)

print(f'\n🔴 有第二道只認 ?t= 的檢查（LINE 路一定被擋）：{len(dirty)} 支')
print('   （判準＝函式開頭出現 validateBoardToken_，不限文案——第一版只比對「無權限或連結已失效。」，')
print('     漏掉了文案是「無權限。」的那幾支寫入 action。非零的數字整串是假的。）')
for a in dirty:
    print('   ' + a)
print(f'\n✅ 沒有第二道：{len(clean)} 支')
print('   ' + ', '.join(clean))
if missing:
    print(f'\n⚠️ 在 Code.js 的頂層 function 裡找不到（可能在別的檔／不是 action）：{len(missing)} 支')
    print('   ' + ', '.join(missing))

# ⬛ 對照組：這把尺對已知答案要給對的分類
assert 'getCheckinOptions' in clean or 'getCheckinOptions' in missing, \
    '⬛ 對照組失敗：getCheckinOptions 沒有第二道（它連 token 參數都沒有），卻被判成有'
assert 'getHrPending' in dirty, \
    '⬛ 對照組失敗：getHrPending 明明有第二道（Code.js:5143-5144），卻沒被抓到 ⇒ 這把尺太鬆'
print('\n⬛ 對照組：getCheckinOptions 判乾淨、getHrPending 判有 ⇒ 這把尺分得開')
