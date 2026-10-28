// 退出问题的最小对照：不加载本扩展、不加载 Codex、也不连接 CDP。
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
const cdp = process.argv.includes('--cdp'), switcher = process.argv.includes('--switcher'), codex = switcher || process.argv.includes('--codex');
const reservation=createServer(); await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const root = await fs.mkdtemp('/tmp/codex-exit-control-');
const driver = path.join(root,'driver'), data=path.join(root,'data'), extensions=path.join(root,'extensions');
for (const dir of [driver,extensions,path.join(data,'User')]) await fs.mkdir(dir,{recursive:true});
const home=path.join(root,'home'); await fs.mkdir(home);
if(codex){
  const inventory=JSON.parse(await fs.readFile(path.join(os.homedir(),'.vscode/extensions/extensions.json'),'utf8'));
  const installed=inventory.find(item=>item.identifier.id==='openai.chatgpt');
  await fs.symlink(path.join(os.homedir(),'.vscode/extensions',installed.relativeLocation),path.join(extensions,installed.relativeLocation));
  if (switcher) await fs.symlink(process.cwd(),path.join(extensions,'huixiangyang.codex-profile-switcher-0.7.0'));
}
await fs.writeFile(path.join(data,'User/settings.json'),JSON.stringify({'codexProfiles.codexHome':home,'update.mode':'none','telemetry.telemetryLevel':'off','workbench.startupEditor':'none','chat.disableAIFeatures':true}));
await fs.writeFile(path.join(driver,'package.json'),JSON.stringify({name:'exit-control',publisher:'fixture',version:'0.0.1',engines:{vscode:'^1.95.0'},activationEvents:['onStartupFinished'],main:'index.cjs'}));
await fs.writeFile(path.join(driver,'index.cjs'),`exports.activate=async()=>{${switcher ? "await require('vscode').extensions.getExtension('huixiangyang.codex-profile-switcher').activate();" : codex ? "await require('vscode').extensions.getExtension('openai.chatgpt').activate();" : ''}const fs=require('fs');const t=setInterval(()=>{if(${!cdp}||fs.existsSync(${JSON.stringify(path.join(root,'release'))})){clearInterval(t);fs.writeFileSync(${JSON.stringify(path.join(root,'quit-called'))},'');require('vscode').commands.executeCommand('workbench.action.quit')}},200);};`);
const env={...process.env,CODEX_HOME:home}; for(const k of Object.keys(env)) if(k.startsWith('VSCODE_')||k==='ELECTRON_RUN_AS_NODE') delete env[k];
const child=spawn('/usr/bin/arch',['-arm64','/Applications/Visual Studio Code.app/Contents/MacOS/Code','--user-data-dir',data,'--extensions-dir',extensions,'--extensionDevelopmentPath='+driver,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--new-window',...(cdp?['--remote-debugging-port='+port]:[])],{env,stdio:['ignore','pipe','pipe']});
let log='',forced=false; child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
const done=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL')},15000);
if(cdp){
  const deadline=Date.now()+10000;
  while(!log.includes('DevTools listening')&&Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);await browser.close();await fs.writeFile(path.join(root,'release'),'');
}
const exited=await done;clearTimeout(timer);
await fs.writeFile(path.join(root,'launch.log'),log);
const report={root,quitCalled:!!(await fs.stat(path.join(root,'quit-called')).catch(()=>false)),noSwitcher:!switcher,noCodex:!codex,noCDP:!cdp,forced,...exited};
await fs.writeFile(switcher?'artifacts/host-exit-switcher-control.json':codex?'artifacts/host-exit-codex-control.json':cdp?'artifacts/host-exit-cdp-control.json':'artifacts/host-exit-control.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
