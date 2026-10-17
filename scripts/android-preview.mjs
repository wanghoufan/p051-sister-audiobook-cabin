/** Temporary USB preview, tied to the shared verified device lock. No autostart or system volume changes. */
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
const python=process.env.PYTHON||'python3';
const lockScript=process.env.ANDROID_DEVICE_LOCK_SCRIPT||path.join(os.homedir(),'.codex','skills','android-device-target-lock-local-zh','android_device_lock.py');
if(!existsSync(lockScript))throw Error('未找到目标手机锁定脚本，请通过 ANDROID_DEVICE_LOCK_SCRIPT 指定已安装的 Skill 脚本。');
function resolve(){execFileSync(python,[lockScript,'status'],{stdio:'inherit'});return execFileSync(python,[lockScript,'resolve'],{encoding:'utf8'}).trim();}
function adb(args,expected){const serial=resolve();if(expected&&serial!==expected)throw Error('目标连接已变化，请重新核验手机后再运行。');execFileSync('adb',['-s',serial,...args],{stdio:'ignore'});return serial;}
function available(port){return new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(port,'127.0.0.1',()=>s.close(()=>r(true)));});}
if(!existsSync('dist/sw.js')||!existsSync('catalog/audio-index.json'))throw Error('先运行 pnpm audio:scan 和 pnpm build。');
const start=Number(process.env.APP_PORT||8792);let port=start;while(port<start+20&&!await available(port))port++;
if(port===start+20)throw Error('预览端口均被占用，请设置其他 APP_PORT。');
const server=spawn(process.execPath,['audiobook-server.mjs'],{env:{...process.env,APP_PORT:String(port),HOST:'127.0.0.1'},stdio:'inherit'});
const ready=await new Promise(r=>{const until=Date.now()+10000;const check=async()=>{try{if((await fetch(`http://127.0.0.1:${port}/api/courses`)).ok){r(true);return;}}catch{/* child is starting */}if(Date.now()>until){r(false);return;}setTimeout(check,150);};void check();});
if(!ready){server.kill('SIGTERM');throw Error('课程服务没有启动成功。');}
let device;
try{device=adb(['reverse',`tcp:${port}`,`tcp:${port}`]);adb(['shell','am','start','-a','android.intent.action.VIEW','-d',`http://localhost:${port}/`,'-p','com.android.chrome'],device);}catch{server.kill('SIGTERM');throw Error('目标手机预览失败，请确认锁定手机在线、已授权并安装 Chrome。');}
console.log(`手机预览：http://localhost:${port}/；电脑：http://127.0.0.1:${port}/。保持此窗口运行，Ctrl+C 结束并清理 USB 转发。不会自动播放。`);
let closing=false;const close=()=>{if(closing)return;closing=true;try{adb(['reverse','--remove',`tcp:${port}`],device);}catch{console.warn('手机已离线或连接变化，USB 转发未清理；重连后检查。');}server.kill('SIGTERM');};
process.once('SIGINT',close);process.once('SIGTERM',close);server.once('exit',()=>{if(!closing)close();process.exitCode=0;});
