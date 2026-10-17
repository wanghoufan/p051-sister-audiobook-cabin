export interface Episode { id:string; courseId:string; ordinal:number; title:string; section:string; sizeBytes:number; durationSec:number; integrity:'ok'|'damaged'|'unchecked'|'pending'; url:string }
export interface Course { id:string; title:string; level:string; category:string; note:string; episodes:Episode[] }
export type Mode='sequence'|'single'|'list'
export type Sleep='off'|'end'|number
export interface Playback { courseId:string; episodeId:string; position:number; duration:number; speed:number; mode:Mode; sleep:Sleep; status:'idle'|'loading'|'playing'|'paused'|'error'; notice:string; history:Record<string,{position:number;completed:boolean;at:number}> }
