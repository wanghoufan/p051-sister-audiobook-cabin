import { audioRange } from './offline-range.js';
const SHELL='p51-shell-__BUILD__';
const AUDIO='p51-audio-v1';
const ASSETS=__PRECACHE__;
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('p51-shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request;const url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/audio/')){event.respondWith((async()=>{const saved=await(await caches.open(AUDIO)).match(url.pathname);if(saved&&saved.headers.get('X-P51-Complete')==='1')return audioRange(saved,req.headers.get('range'));try{return await fetch(req)}catch{return new Response(JSON.stringify({message:'这集尚未下载，请联网后重试'}),{status:503,headers:{'Content-Type':'application/json'}})}})());return;}
 if(url.pathname==='/api/courses'||req.mode==='navigate'){
  event.respondWith((async()=>{const cache=await caches.open(SHELL);try{const response=await fetch(req);if(response.ok)await cache.put(url.pathname==='/api/courses'?'/api/courses':'/index.html',response.clone());else if(url.pathname==='/api/courses'){const saved=await cache.match('/api/courses');if(saved)return saved;}return response;}catch{return await cache.match(url.pathname==='/api/courses'?'/api/courses':'/index.html')||new Response('暂时离线，请联网后首次打开',{status:503});}})());return;
 }
 event.respondWith(caches.match(req).then(saved=>saved||fetch(req)));
});
