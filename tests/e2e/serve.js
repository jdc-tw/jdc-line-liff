/**
 * e2e 用的最小靜態 server。**零相依**——`npx --yes http-server` 第一次要下載套件，
 * 本機 2026-08-29 實測會卡在那裡（測試永遠不開始，而且沒有任何輸出）。
 *
 * 🔴 **一定要送 charset。** 不送的話瀏覽器對外部 script 用頁面編碼推測，
 *    含中文的 asset 會被解成亂碼並炸成 SyntaxError——症狀是「頁面停在載入中」，
 *    而受測物看起來像壞掉的。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 4173);

http.createServer(function (req, res) {
  let rel;
  try { rel = decodeURIComponent(String(req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('bad url'); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  // 不准跳出 repo 根目錄
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',    // 改了 asset 卻驗到舊版是零徵兆的
    });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('e2e static server on http://127.0.0.1:' + PORT + ' (root: ' + ROOT + ')');
});
