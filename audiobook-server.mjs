import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRange, buildRangeResponse } from './server/http-range.mjs';
import { serveStatic } from './server/static-files.mjs';
import { sendJson } from './server/http-responses.mjs';
import { inside } from './server/audio-catalog.mjs';
/** @param {{root?: string, snapshot?: object, distDir?: string}} options */
export function createAudioServer({root=path.resolve('兴趣测试'),snapshot,distDir=path.resolve('dist')}={}) {
 const getSnapshot=async()=>snapshot??JSON.parse(await fs.readFile('catalog/audio-index.json','utf8'));
 return http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','same-origin');
  try {
   if(!['GET','HEAD'].includes(req.method)){sendJson(res,405,{message:'仅支持读取'});return;}
   let pathname;try{pathname=decodeURIComponent((req.url||'/').split('?')[0]);}catch{sendJson(res,400,{message:'无效路径'});return;}
   if(pathname.includes('\0')||pathname.split('/').includes('..')){sendJson(res,404,{message:'资源不存在'});return;}
   if(pathname==='/api/courses'){
    let data;try{data=await getSnapshot();}catch{sendJson(res,503,{message:'音频文件尚未关联，请运行音频扫描'});return;}
    const body=Buffer.from(JSON.stringify({courses:data.courses}));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);return;
   }
   if(pathname.startsWith('/api/audio/')){
    const id=pathname.slice('/api/audio/'.length);if(!/^[a-f0-9]{24}$/.test(id)){sendJson(res,404,{message:'音频不存在'});return;}
    const data=await getSnapshot();const record=data.records[id];if(!record){sendJson(res,404,{message:'音频不存在'});return;}
    const file=await fs.realpath(path.resolve(root,record.relativePath));const realRoot=await fs.realpath(root);
    if(!inside(realRoot,file)){sendJson(res,403,{message:'无法读取这份音频'});return;}
    const stat=await fs.stat(file);if(!stat.isFile()){sendJson(res,404,{message:'音频不存在'});return;}
    const range=parseRange(req.headers.range,stat.size);const response=buildRangeResponse(range,stat.size,'audio/mpeg');
    res.writeHead(response.status,{...response.headers,'Cache-Control':'private, no-cache'});
    if(req.method==='HEAD'||response.status===416){res.end();return;}
    const stream=createReadStream(file,range.type==='range'?{start:range.start,end:range.end}:{});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
   }
   if(pathname.startsWith('/api/')){sendJson(res,404,{message:'接口不存在'});return;}
   if(!await serveStatic(req,res,{distDir}))sendJson(res,404,{message:'页面不存在'});
  }catch{if(!res.headersSent)sendJson(res,404,{message:'资源暂时无法读取，请重试'});else res.destroy();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.APP_PORT||8792);const host=process.env.HOST||'127.0.0.1';
 createAudioServer({root:path.resolve(process.env.AUDIO_ROOT||'兴趣测试')}).listen(port,host,()=>console.log(`听书小屋 http://${host}:${port}`));
}
