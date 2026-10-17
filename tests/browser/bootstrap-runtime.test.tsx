import {expect,test} from 'vitest'
import {readFileSync} from 'node:fs'
import path from 'node:path'
test('watchdog scheduled from head discovers root created later by body parsing',()=>{const html=readFileSync(path.resolve('index.html'),'utf8');const source=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)][0][1];let root:HTMLDivElement|null=null;let show:(()=>void)|undefined;const doc={getElementById:()=>root,createElement:(name:string)=>document.createElement(name)};new Function('window','document',source)({setTimeout:(callback:()=>void)=>{show=callback}},doc);expect(show).toBeTypeOf('function');root=document.createElement('div');show!();expect(root.querySelector('[role=alert]')).not.toBeNull();expect(root.textContent).toContain('重新加载')})
