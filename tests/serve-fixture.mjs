import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildTranslationScript, compileTranslationScript } from '../adapter.mjs';
const server = createServer((request, response) => {
  if (request.url === '/translation.js' || request.url === '/translation-next.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    const dictionary = JSON.parse(readFileSync(new URL('../zh-CN.json', import.meta.url)));
    const script = request.url === '/translation.js' ? buildTranslationScript() : compileTranslationScript(
      readFileSync(new URL('../translator.js', import.meta.url), 'utf8'), { ...dictionary, Model: '模型（更新）' }
    );
    response.end(script);
  } else if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(readFileSync(new URL('./fixture.html', import.meta.url)));
  } else { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`中文适配测试：http://127.0.0.1:${server.address().port}/`));
