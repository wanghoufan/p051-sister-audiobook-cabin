import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanAudio, naturalCompare } from '../../server/audio-catalog.mjs'
import { createAudioServer } from '../../audiobook-server.mjs'
import type { Course } from '../../src/audio/types'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
 const root = await mkdtemp(path.join(tmpdir(), 'p51-')); roots.push(root)
 const folder = path.join(root, 'L1', '文学', '101测试'); await mkdir(path.join(folder, '02章节'), {recursive:true})
 for (const name of ['10 最后.mp3','2 第二.mp3','01 开始.mp3','02章节/1 嵌套.mp3']) await writeFile(path.join(folder,name),'audio-bytes')
 await symlink('/etc/passwd',path.join(folder,'恶意.mp3'))
 const source = {courses:[{id:1,title:'测试',folder_name:'101测试',level:'L1',category:'文学',note:'真实说明'}]}
 return {root, source}
}
test('recursive natural order, stable IDs, symlink boundary and no public paths', async () => {
 const {root,source}=await fixture(); const a=await scanAudio({root,source,inspect:false});const b=await scanAudio({root,source,inspect:false})
 expect(a.courses[0].episodes.map((e:{title:string})=>e.title)).toEqual(['开始','第二','嵌套','最后'])
 expect(a.courses).toEqual(b.courses);expect(a.report.unsafe.length).toBe(1)
 expect(JSON.stringify(a.courses)).not.toContain(root)
 expect(naturalCompare('2','10')).toBeLessThan(0)
})
test('missing directories stay visible and report absent audio',async()=>{
 const {root,source}=await fixture();source.courses[0].folder_name='missing';const a=await scanAudio({root,source,inspect:false})
 expect(a.courses[0].episodes).toEqual([]);expect(a.report.missing).toHaveLength(1)
})
test('stream API reuses real Range, HEAD, 416, opaque IDs; rejects unknown and mutation', async()=>{
 const {root,source}=await fixture(); const snapshot=await scanAudio({root,source,inspect:false})
 const server=createAudioServer({root,snapshot,distDir:path.join(root,'dist')});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 const address=server.address();if(!address||typeof address==='string')throw Error('address');const base=`http://127.0.0.1:${address.port}`
 try{
 const catalog=await (await fetch(base+'/api/courses')).json() as {courses:Course[]};expect(catalog.courses).toHaveLength(1);expect(JSON.stringify(catalog)).not.toContain(root)
 const url=base+catalog.courses[0].episodes[0].url
 const res=await fetch(url,{headers:{Range:'bytes=2-5'}});expect(res.status).toBe(206);expect(res.headers.get('content-type')).toBe('audio/mpeg');expect(await res.text()).toBe('dio-')
 expect((await fetch(url,{method:'HEAD'})).headers.get('content-length')).toBe('11')
 expect((await fetch(url,{headers:{Range:'bytes=100-'}})).status).toBe(416)
 expect((await fetch(base+'/api/audio/unknown')).status).toBe(404)
 expect((await fetch(url,{method:'POST'})).status).toBe(405)
 }finally{await new Promise<void>(r=>server.close(()=>r()))}
})
