// QA 辅助脚本：只为生成本地测试用的 catalog-cache.json（时长缓存）。
// 不属于被测代码，只服务于 tests/qa/**。
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.argv[2];
const out = process.argv[3];

async function* walk(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function probe(file) {
  return new Promise((resolve) => {
    const c = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => (out += d));
    c.on('error', () => resolve(null));
    c.on('close', () => {
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n >= 0 ? n : null);
    });
  });
}

const files = [];
for await (const f of walk(root)) if (/\.(mp4|m4v|mov)$/i.test(f)) files.push(f);
const cache = {};
let i = 0;
const workers = Array.from({ length: 4 }, async () => {
  while (i < files.length) {
    const f = files[i++];
    const rel = path.relative(root, f).split(path.sep).join('/');
    const s = await probe(f);
    cache[rel] = { durationSeconds: s === null ? 0 : s };
  }
});
await Promise.all(workers);
await fsp.writeFile(out, JSON.stringify(cache, null, 2) + '\n', 'utf8');
console.log('wrote', Object.keys(cache).length, 'entries to', out);
