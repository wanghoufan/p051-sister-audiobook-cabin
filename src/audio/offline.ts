import type { Episode } from './types'
export const AUDIO_CACHE='p51-audio-v1'
export interface DownloadState{state:'downloading'|'ready'|'error'|'paused';progress:number;error?:string}
export class OfflineLibrary{
 private state:Record<string,DownloadState>={}
 private listeners=new Set<()=>void>()
 private controllers=new Map<string,AbortController>()
 private batchCancelled=false
 private caches:CacheStorage|undefined
 private fetcher:typeof fetch
 private storage:StorageManager|undefined
 constructor(caches:CacheStorage|undefined,fetcher:typeof fetch,storage:StorageManager|undefined){this.caches=caches;this.fetcher=fetcher;this.storage=storage}
 getSnapshot=()=>this.state
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private set(id:string,value?:DownloadState){const next={...this.state};if(value)next[id]=value;else delete next[id];this.state=next;this.listeners.forEach(fn=>fn())}
 async refresh(episodes:Episode[]){if(!this.caches)return;try{const cache=await this.caches.open(AUDIO_CACHE);const keys=new Set((await cache.keys()).map(r=>new URL(r.url).pathname));for(const ep of episodes)if(keys.has(ep.url))this.set(ep.id,{state:'ready',progress:1})}catch{/* downloads report unavailable storage on demand */}}
 async estimate(){return await this.storage?.estimate().catch(()=>undefined)}
 async download(episode:Episode){
  if(this.controllers.has(episode.id)||this.state[episode.id]?.state==='ready')return;
  const controller=new AbortController();this.controllers.set(episode.id,controller);this.set(episode.id,{state:'downloading',progress:0});
  try{
   if(!this.caches)throw Error('unsupported');
   const estimate=await this.estimate();if(estimate?.quota&&estimate.quota-(estimate.usage||0)<episode.sizeBytes*1.15)throw Error('quota');
   const response=await this.fetcher(episode.url,{signal:controller.signal,cache:'no-store'});
   if(response.status!==200||!response.body)throw Error('network');
   const reader=response.body.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let received=0;
   while(true){const result=await reader.read();if(result.done)break;if(controller.signal.aborted){await reader.cancel();throw new DOMException('cancelled','AbortError')}chunks.push(new Uint8Array(result.value));received+=result.value.byteLength;this.set(episode.id,{state:'downloading',progress:Math.min(.99,received/episode.sizeBytes)});}
   if(controller.signal.aborted)throw new DOMException('cancelled','AbortError');
   if(received!==episode.sizeBytes)throw Error('incomplete');
   const cache=await this.caches.open(AUDIO_CACHE);
   // Full bytes commit is atomic; no success metadata exists before cache.put resolves.
   await cache.put(episode.url,new Response(new Blob(chunks,{type:'audio/mpeg'}),{status:200,headers:{'Content-Type':'audio/mpeg','Content-Length':String(received),'X-P51-Complete':'1'}}));
   if(controller.signal.aborted){await cache.delete(episode.url);throw new DOMException('cancelled','AbortError')}
   this.set(episode.id,{state:'ready',progress:1});
  }catch(error){const abort=controller.signal.aborted;const message=error instanceof Error?error.name==='QuotaExceededError'?'quota':error.message:'network';this.set(episode.id,{state:abort?'paused':'error',progress:0,error:message})}
  finally{this.controllers.delete(episode.id)}
 }
 cancel(id:string){this.controllers.get(id)?.abort()}
 cancelAll(){this.batchCancelled=true;for(const c of this.controllers.values())c.abort()}
 async downloadCourse(episodes:Episode[]){this.batchCancelled=false;for(const ep of episodes){if(this.batchCancelled)break;if(ep.integrity==='damaged')continue;await this.download(ep);if(this.state[ep.id]?.state==='error')break;}}
 async remove(episode:Episode){this.cancel(episode.id);try{const cache=await this.caches?.open(AUDIO_CACHE);if(!cache)throw Error('unsupported');await cache.delete(episode.url);this.set(episode.id)}catch{this.set(episode.id,{state:'error',progress:0,error:'storage'})}}
}
