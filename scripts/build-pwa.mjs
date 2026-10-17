import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
const assets=(await fs.readdir('dist/assets')).filter(n=>/\.(js|css)$/.test(n)).sort().map(n=>'/assets/'+n);
const precache=['/','/api/courses','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/offline-range.js',...assets];
const source=await fs.readFile('public/sw.js','utf8');
const version=createHash('sha256').update(JSON.stringify(precache)).update(source).update(await fs.readFile('dist/index.html')).update(await fs.readFile('public/manifest.webmanifest')).digest('hex').slice(0,12);
await fs.writeFile('dist/sw.js',source.replace('__BUILD__',version).replace('__PRECACHE__',JSON.stringify(precache)));
console.log(`PWA shell ${version}: ${assets.length} assets, course metadata precached`);
