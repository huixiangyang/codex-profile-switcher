// 只读取官方安装文件，将实际 URI/侧栏方法放入隔离 VM 验证；不启动或操作 VS Code。
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root=process.cwd(),extensions=path.join(os.homedir(),'.vscode/extensions');
const inventory=JSON.parse(await readFile(path.join(extensions,'extensions.json'),'utf8'));
const installed=inventory.find(entry=>entry.identifier.id==='openai.chatgpt');
assert.ok(installed,'未安装官方 Codex');
const directory=path.join(extensions,installed.relativeLocation),metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
const adapter=await readFile(path.join(root,'src/sessions/navigation.ts'),'utf8');
assert.equal(metadata.version,adapter.match(/supportedCodexVersion = '([^']+)'/)[1]);
assert.equal(metadata.version,'26.51021.22027','此脚本核验的是这版官方实现');
assert.ok(metadata.activationEvents.includes('onUri'));
const filename=path.join(directory,metadata.main),text=await readFile(filename,'utf8');
const source=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=new Map(),variables=new Map(),methods=new Map();
function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node);
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))variables.set(node.name.text,node);
  if(ts.isMethodDeclaration(node)&&['handleUri','navigateToRoute'].includes(node.name.getText(source)))methods.set(node.name.getText(source),node);
  ts.forEachChild(node,visit);
}
visit(source);
const handler=methods.get('handleUri'),navigate=methods.get('navigateToRoute');assert.ok(handler&&navigate);
assert.ok(ts.isClassExpression(handler.parent));
const handlerName=handler.parent.parent.name.getText(source);
assert.ok(new RegExp(`new ${handlerName}\\([^;]+;if\\([^;]*registerUriHandler`).test(text),'实际处理器必须注册为官方 URI handler');
const vscodeVersion=JSON.parse(await readFile('/Applications/Visual Studio Code.app/Contents/Resources/app/package.json','utf8')).version;
const calls=[],messages=[],errors=[],deepLinks=[];
const context=vm.createContext({IR:{version:vscodeVersion,commands:{executeCommand:async command=>{calls.push(command);}}},ie:()=>({info(){},error:(...args)=>errors.push(args)})});
// 明确列出该版本侧栏选择器的依赖，只执行已读取的路由相关函数。
const declarations=['w9','ZUt','XUt','S9','x9','YUt','JUt'].map(name=>{
  const node=variables.get(name);assert.ok(node,name);return `const ${node.getText(source)};`;
}).join('\n');
const helpers=['UGe','N1','QUt','ru'].map(name=>{const node=functions.get(name);assert.ok(node,name);return node.getText(source);}).join('\n');
vm.runInContext(declarations+'\n'+helpers,context,{timeout:1000});
const Handler=vm.runInContext(`(${handler.parent.getText(source)})`,context,{timeout:1000});
const provider=vm.runInContext(`({${navigate.getText(source)}})`,context,{timeout:1000});
const sidebar={id:'isolated-sidebar'};
Object.assign(provider,{sidebarView:{webview:sidebar},sidebarWebviewReady:true,pendingNavigationRoutes:[],postMessageToWebview:(target,message)=>messages.push({target,...message})});
const receiver=new Handler(provider,{handleDeepLink:uri=>deepLinks.push(uri)});
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const uri=id=>({path:`/local/${id}`,query:'',toString:()=>`vscode://openai.chatgpt/local/${id}`});
for(const id of [a,b,a])await receiver.handleUri(uri(id));
assert.deepEqual(messages.map(message=>message.path),[a,b,a].map(id=>`/local/${id}`));
assert.ok(messages.every(message=>message.target===sidebar&&message.type==='navigate-to-route'));
const expected=vm.runInContext('UGe(IR.version)',context);
assert.deepEqual(calls,Array(3).fill([`workbench.view.extension.${expected.containerId}`,`${expected.viewId}.focus`]).flat());
assert.equal(deepLinks.length,3);assert.equal(errors.length,0);

provider.sidebarWebviewReady=false;messages.length=0;await receiver.handleUri(uri(b));
assert.equal(messages.length,0);assert.equal(provider.pendingNavigationRoutes[0].path,`/local/${b}`);
// 复用官方 ready 分支，检查尚未加载的侧栏也会交付待跳转路由。
let pendingBlock;
function findPending(node){if(ts.isIfStatement(node)&&node.expression.getText(source)==='this.pendingNavigationRoutes.length>0')pendingBlock=node;ts.forEachChild(node,findPending);}
findPending(navigate.parent);assert.ok(pendingBlock);
vm.runInContext(`(function(e){${pendingBlock.getText(source)}})`,context,{timeout:1000}).call(provider,sidebar);
assert.equal(messages[0].path,`/local/${b}`);assert.equal(provider.pendingNavigationRoutes.length,0);
const assets=path.join(directory,'webview/assets'),routeFiles=[];let frontendDispatch=false;
for(const name of await readdir(assets)){
  if(!name.endsWith('.js'))continue;const body=await readFile(path.join(assets,name),'utf8');
  if(name.startsWith('use-active-conversation-id-')&&body.includes('/local/:conversationId'))routeFiles.push(name);
  if(name.startsWith('app-runtime-')&&body.includes('navigate-to-route'))frontendDispatch=true;
}
assert.ok(routeFiles.length&&frontendDispatch);
const report={officialExtension:metadata.version,vscodeVersion,handler:handlerName,sidebar:JSON.parse(JSON.stringify(expected)),readySidebarRoundTrip:true,coldSidebarQueue:true,frontendRouteFiles:routeFiles,frontendNavigationHandler:true,nativeVscodeStarted:false};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/navigation-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
