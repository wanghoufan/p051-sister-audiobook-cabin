import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scanAudio } from '../server/audio-catalog.mjs';
const source=JSON.parse(await fs.readFile('docs/plan/P51-SDD-开发交付包-V1.1/课程清单-原始数据.json','utf8'));
if(source.courses.length!==30||new Set(source.courses.map(c=>c.id)).size!==30||new Set(source.courses.map(c=>c.category)).size!==7)throw Error('课程清单校验失败');
for(const level of ['L1','L2','L3'])if(source.courses.filter(c=>c.level===level).length!==10)throw Error('等级数量错误');
const data=await scanAudio({root:path.resolve(process.env.AUDIO_ROOT||'兴趣测试'),source});
await fs.mkdir('catalog',{recursive:true});await fs.writeFile('catalog/audio-index.json.tmp',JSON.stringify({courses:data.courses,records:data.records}));await fs.rename('catalog/audio-index.json.tmp','catalog/audio-index.json');
await fs.mkdir('docs/qa/p51-evidence',{recursive:true});await fs.writeFile('docs/qa/p51-evidence/audio-scan.json',JSON.stringify(data.report,null,2));
console.log(JSON.stringify({...data.report,files:`${data.report.files.length} entries (see audio-scan.json)`},null,2));

if(data.report.missing.length||data.report.damaged.length||data.report.unmatched.length)process.exitCode=2;
