import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a,b) => collator.compare(a,b);
const idFor = value => createHash('sha256').update(value.normalize('NFC')).digest('hex').slice(0,24);
export const inside = (root,p) => p.startsWith(root+path.sep);
export function cleanTitle(name) {
 return name.replace(/\.mp3$/i,'').replace(/【[^】]*(?:微信|课程)[^】]*】/g,'').replace(/^\s*\d+[\s、.．_-]*/,'').trim() || name;
}
export async function scanAudio({root,source,inspect=true,concurrency=6}) {
 root = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root));
 const report={missing:[],unsafe:[],unmatched:[],duplicates:[],damaged:[],files:[],courseCount:source.courses.length,totalBytes:0,totalEpisodes:0};
 const records={};const courses=[];const jobs=[];const matched=new Set();
 async function walk(dir) {
  const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);const result=[];
  for(const entry of entries){const p=path.join(dir,entry.name);if(entry.isSymbolicLink()){if(!report.unsafe.includes(path.relative(root,p)))report.unsafe.push(path.relative(root,p));continue;}if(entry.isDirectory())result.push(...await walk(p));else if(entry.isFile()&&/\.mp3$/i.test(entry.name))result.push(p);}
  return result;
 }
 for(const c of source.courses){
  const courseId=`course-${String(c.id).padStart(2,'0')}`;const dir=path.resolve(root,c.level,c.category,c.folder_name);
  const files=inside(root,dir)?await walk(dir):[];
  files.sort((a,b)=>naturalCompare(path.relative(dir,a),path.relative(dir,b)));
  if(!files.length)report.missing.push({courseId,title:c.title});
  const course={id:courseId,title:c.title,level:c.level,category:c.category,note:c.note||'',episodes:[]};
  for(const [i,file] of files.entries()){
   const relativePath=path.relative(root,file);matched.add(file);const real=await fs.realpath(file);if(!inside(root,real)){report.unsafe.push(relativePath);continue;}
   const stat=await fs.stat(file);const id=idFor(relativePath);
   const episode={id,courseId,ordinal:i+1,title:cleanTitle(path.basename(file)),section:path.dirname(path.relative(dir,file))==='.'?'':path.dirname(path.relative(dir,file)),sizeBytes:stat.size,durationSec:0,integrity:inspect?'pending':'unchecked',url:`/api/audio/${id}`};
   course.episodes.push(episode);records[id]={relativePath,sizeBytes:stat.size};report.totalBytes+=stat.size;
   jobs.push(async()=>{
    const item={...episode,sourcePath:relativePath};let stage='probe';
    if(inspect){try{
     const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file],{timeout:30000});
     episode.durationSec=Number(JSON.parse(stdout).format?.duration)||0;if(episode.durationSec<=0)throw Error('无有效时长');
     stage='decode';await exec('ffmpeg',['-v','error','-xerror','-i',file,'-t','2','-map','0:a:0','-f','null','-'],{timeout:30000,maxBuffer:1024*1024});
     episode.integrity='ok';
    }catch{episode.integrity='damaged';report.damaged.push({id,path:relativePath,reason:stage+'_failed'});}}
    if(inspect){try{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);item.sha256=hash.digest('hex');}catch{episode.integrity='damaged';if(!report.damaged.some(d=>d.id===id))report.damaged.push({id,path:relativePath,reason:'read_failed'});}}
    Object.assign(item,episode);report.files.push(item);
   });
  }
  courses.push(course);
 }
 let cursor=0;await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<jobs.length)await jobs[cursor++]();}));
 for(const file of await walk(root))if(!matched.has(file))report.unmatched.push(path.relative(root,file));
 report.files.sort((a,b)=>naturalCompare(a.sourcePath,b.sourcePath));report.damaged.sort((a,b)=>naturalCompare(a.path,b.path));
 const hashes=new Map();for(const item of report.files){if(!item.sha256)continue;const prev=hashes.get(item.sha256);if(prev)report.duplicates.push({first:prev,second:item.sourcePath});else hashes.set(item.sha256,item.sourcePath);}
 report.files.sort((a,b)=>naturalCompare(a.sourcePath,b.sourcePath));report.totalEpisodes=Object.keys(records).length;
 return {courses,records,report};
}
