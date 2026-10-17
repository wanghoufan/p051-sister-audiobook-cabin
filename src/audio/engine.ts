import type { Course, Playback, Mode, Sleep } from './types'
type StorageLike=Pick<Storage,'getItem'|'setItem'>
const fresh=():Playback=>({courseId:'',episodeId:'',position:0,duration:0,speed:1,mode:'sequence',sleep:'off',status:'idle',notice:'',history:{}})
export class AudioEngine {
 private state:Playback=fresh()
 private listeners=new Set<()=>void>()
 private courses:Course[]=[]
 private generation=0
 private timer:ReturnType<typeof setInterval>
 private handlers:Array<[string,EventListener]>=[]
 private lastSave=0
 private restorePosition=0
 readonly audio:HTMLAudioElement
 private storage:StorageLike
 constructor(audio:HTMLAudioElement,storage:StorageLike){
  this.audio=audio;this.storage=storage
  try {const raw=storage.getItem('p51.playback');if(raw){const v=JSON.parse(raw);this.state={...fresh(),courseId:typeof v.courseId==='string'?v.courseId:'',episodeId:typeof v.episodeId==='string'?v.episodeId:'',position:Number.isFinite(v.position)?Math.max(0,v.position):0,speed:[.75,1,1.25,1.5,2].includes(v.speed)?v.speed:1,mode:['sequence','single','list'].includes(v.mode)?v.mode:'sequence',sleep:v.sleep==='end'||(Number.isFinite(v.sleep)&&v.sleep>Date.now())?v.sleep:'off',history:v.history&&typeof v.history==='object'?v.history:{},status:'paused'};}}
  catch{this.state.notice='storage'}
  audio.preload='metadata';audio.defaultPlaybackRate=this.state.speed;audio.playbackRate=this.state.speed
  this.on('loadedmetadata',()=>{if(!this.currentEpisode())return;audio.playbackRate=this.state.speed;const duration=Number.isFinite(audio.duration)?audio.duration:this.state.duration;audio.currentTime=this.safePosition(this.restorePosition,duration);this.restorePosition=0;this.update({duration,position:audio.currentTime});this.positionSession()})
  this.on('timeupdate',()=>{this.checkSleep();this.update({position:audio.currentTime});this.positionSession();if(Date.now()-this.lastSave>2000)this.persist()})
  this.on('play',()=>this.update({status:'playing'}))
  this.on('pause',()=>{this.update({status:'paused'});this.positionSession();this.persist()})
  this.on('ended',()=>{void this.ended()})
  this.on('error',()=>{this.update({status:'error',notice:'media'});this.persist()})
  this.on('waiting',()=>{if(!audio.paused)this.update({status:'loading'})})
  this.on('playing',()=>this.update({status:'playing'}))
  this.timer=setInterval(()=>this.checkSleep(),1000)
 }
 private on(type:string,handler:EventListener){this.handlers.push([type,handler]);this.audio.addEventListener(type,handler)}
 getSnapshot=()=>this.state
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private update(next:Partial<Playback>){this.state={...this.state,...next};if(next.status&&typeof navigator!=='undefined'&&navigator.mediaSession){try{navigator.mediaSession.playbackState=next.status==='playing'?'playing':next.status==='idle'?'none':'paused'}catch{/* optional browser integration */}}this.listeners.forEach(fn=>fn())}
 private safePosition(position:number,duration:number){return duration>0&&position>=duration-3?0:Math.max(0,position)}
 setCourses(courses:Course[]){this.courses=courses;const ep=this.currentEpisode();if(ep){this.restorePosition=this.safePosition(this.state.position,ep.durationSec);this.update({position:this.restorePosition,duration:ep.durationSec});this.audio.src=ep.url;this.audio.load();this.mediaSession()}this.checkSleep()}
 currentCourse(){return this.courses.find(c=>c.id===this.state.courseId)}
 currentEpisode(){return this.currentCourse()?.episodes.find(e=>e.id===this.state.episodeId)}
 async select(course:Course,index:number,autoplay=true){const ep=course.episodes[index];if(!ep||ep.integrity==='damaged'){this.update({notice:'media'});return;}
  this.persist();this.generation++;this.audio.pause();
  const progress=this.state.history[ep.id];const position=this.safePosition(progress?.position||0,ep.durationSec);this.restorePosition=position;
  this.update({courseId:course.id,episodeId:ep.id,position,duration:ep.durationSec,status:'paused',notice:''});this.audio.src=ep.url;this.audio.defaultPlaybackRate=this.state.speed;this.audio.load();this.audio.playbackRate=this.state.speed;this.persist();this.mediaSession();if(autoplay)await this.play()
 }
 async play(){if(this.checkSleep())return;if(!this.currentEpisode())return;if(this.state.status==='error'){this.restorePosition=this.state.position;this.audio.load()}const gen=this.generation;this.update({status:'loading',notice:''});try{await this.audio.play();if(gen===this.generation)this.update({status:'playing'})}catch{if(gen===this.generation)this.update({status:'error',notice:'media'})}}
 pause(){this.generation++;this.audio.pause();this.update({status:'paused'});this.persist()}
 toggle(){if(this.state.status==='playing'||this.state.status==='loading')this.pause();else void this.play()}
 seek(value:number){const position=Math.max(0,Math.min(this.state.duration,Number.isFinite(value)?value:0));this.restorePosition=0;this.audio.currentTime=position;this.update({position});this.persist();this.positionSession()}
 setSpeed(speed:number){if(![.75,1,1.25,1.5,2].includes(speed))return;this.audio.defaultPlaybackRate=speed;this.audio.playbackRate=speed;this.update({speed});this.persist();this.positionSession()}
 setMode(mode:Mode){this.update({mode});this.persist()}
 setSleep(value:Sleep){this.update({sleep:typeof value==='number'?Date.now()+value*60000:value});this.persist()}
 checkSleep(){if(typeof this.state.sleep==='number'&&Date.now()>=this.state.sleep){this.update({sleep:'off',notice:'sleep'});this.pause();return true;}return false}
 async step(delta:number){const course=this.currentCourse();if(!course)return;const i=course.episodes.findIndex(e=>e.id===this.state.episodeId)+delta;if(i<0||i>=course.episodes.length){if(this.state.mode==='list')await this.select(course,(i+course.episodes.length)%course.episodes.length);return;}await this.select(course,i)}
 private async ended(){const id=this.state.episodeId;const history={...this.state.history,[id]:{position:this.state.duration,completed:true,at:Date.now()}};this.update({history});
  if(this.checkSleep())return;if(this.state.sleep==='end'){this.update({sleep:'off',notice:'sleep'});this.pause();return;}
  if(this.state.mode==='single'){this.seek(0);await this.play();return;}
  const course=this.currentCourse();if(!course)return;const index=course.episodes.findIndex(e=>e.id===id);
  if(index===course.episodes.length-1&&this.state.mode==='sequence'){this.pause();return;}
  await this.select(course,(index+1)%course.episodes.length)
 }
 persist(){this.lastSave=Date.now();const id=this.state.episodeId;const history=id?{...this.state.history,[id]:{position:this.state.position,completed:this.state.history[id]?.completed||this.state.position>=this.state.duration-3&&this.state.duration>0,at:Date.now()}}:this.state.history;this.update({history});try{this.storage.setItem('p51.playback',JSON.stringify({...this.state,status:'paused'}))}catch{this.update({notice:'storage'})}}
 private positionSession(){try{if(typeof navigator!=='undefined'&&navigator.mediaSession&&this.state.duration>0)navigator.mediaSession.setPositionState({duration:this.state.duration,position:Math.min(this.state.position,this.state.duration),playbackRate:this.state.speed})}catch{/* browser optional */}}
 mediaSession(){if(typeof navigator==='undefined'||!navigator.mediaSession)return;try{const ep=this.currentEpisode();navigator.mediaSession.metadata=new MediaMetadata({title:ep?.title||'',artist:this.currentCourse()?.title||'',artwork:[{src:'/icon-512.png',sizes:'512x512',type:'image/png'}]});const actions:Partial<Record<MediaSessionAction,MediaSessionActionHandler>>={play:()=>{void this.play()},pause:()=>this.pause(),previoustrack:()=>{void this.step(-1)},nexttrack:()=>{void this.step(1)},seekto:d=>this.seek(d.seekTime||0),seekbackward:d=>this.seek(this.state.position-(d.seekOffset||10)),seekforward:d=>this.seek(this.state.position+(d.seekOffset||10)),stop:()=>this.pause()};for(const [action,handler]of Object.entries(actions)){try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,handler)}catch{/* unsupported action */}}}catch{/* unsupported metadata */}}
 dispose(){this.persist();clearInterval(this.timer);for(const [type,handler]of this.handlers)this.audio.removeEventListener(type,handler);this.audio.pause();this.listeners.clear()}
}
