import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.MINETOOLS_PREVIEW_PORT || 8770);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const target = path.resolve(root, `.${pathname === '/' ? '/tests/layout-preview.html' : pathname}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid path');
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`MineTools preview: http://127.0.0.1:${port}/tests/layout-preview.html`);
});
