import { randomUUID } from 'node:crypto';
// 真实 Codex 后端 + 真实 VS Code；所有状态、项目和启动设置均在独立临时目录。
import { build } from "esbuild";

import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  stat,
  readdir,
} from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const verifyLive = process.argv.includes('--live');
const root = await (
  await import("node:fs/promises")
).realpath(
  await mkdtemp(
    path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "cwb-"),
  ),
);
const home = path.join(root, "home"),
  workspace = path.join(root, "workspace"),
  extensions = path.join(root, "extensions"),
  userData = path.join(root, "user-data");
for (const dir of [home, workspace, extensions, path.join(userData, "User")])
  await mkdir(dir, { recursive: true });
const inventory = JSON.parse(
  await readFile(
    path.join(os.homedir(), ".vscode/extensions/extensions.json"),
    "utf8",
  ),
);
const installed = inventory.find(
  (item) => item.identifier.id === "openai.chatgpt",
);
assert.ok(installed, "需要本机官方 Codex 扩展");
const official = path.join(
  os.homedir(),
  ".vscode/extensions",
  installed.relativeLocation,
);
const arch = installed.relativeLocation.endsWith("-arm64") ? "arm64" : "x64";
const runtime =
  process.env.CODEX_SWITCHER_SMOKE_NODE ??
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
if (process.platform !== "darwin")
  throw new Error("此真实 UI 验收脚本目前使用 macOS 安装。");
const binary = path.join(
  official,
  `bin/macos-${arch === "arm64" ? "aarch64" : "x86_64"}/codex`,
);
await symlink(official, path.join(extensions, path.basename(official)));
let holdModelResponse = false, releaseModelResponse;
const responder = createHttpServer(async (req, res) => {
  for await (const chunk of req) {
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (holdModelResponse) await new Promise(resolve => { releaseModelResponse = resolve; });
  const text = "隔离验收固定响应，不调用真实模型。",
    id = "resp_" + Date.now();
  const item = {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const event = (type, fields) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`,
    );
  event("response.created", {
    response: { id, object: "response", status: "in_progress", output: [] },
  });
  event("response.output_item.added", {
    output_index: 0,
    item: { ...item, status: "in_progress", content: [] },
  });
  event("response.content_part.added", {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  event("response.output_text.delta", {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: text,
  });
  event("response.output_text.done", {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    text,
  });
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", {
    response: {
      id,
      object: "response",
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
});
await new Promise((resolve) => responder.listen(0, "127.0.0.1", resolve));
await writeFile(
  path.join(home, "config.toml"),
  'model_provider="probe"\nmodel="probe-model"\n[model_providers.probe]\nname="Probe"\nbase_url="http://127.0.0.1:' +
    responder.address().port +
    '/v1"\nwire_api="responses"\n',
);
// 合成凭据只供隔离界面选择 API 模式；推理端点仍是本脚本的 loopback 固定响应服务。
await writeFile(
  path.join(home, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture-loopback-only" }),
  { mode: 0o600 },
);
const server = spawn(binary, ["app-server"], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});
const pending = new Map(),
  completed = new Map();
let next = 0;
const lines = createInterface({ input: server.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  pending.get(message.id)?.(message);
  if (message.method === "turn/completed")
    completed.set(message.params.threadId, message.params.turn.status);
});
server.stderr.resume();
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++next,
      timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      pending.delete(id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    server.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
const ids = [];
try {
  await rpc("initialize", {
    clientInfo: { name: "sessions-verification", version: "0.5.0" },
  });
  server.stdin.write('{"method":"initialized"}\n');
  for (const name of ["alpha", "beta", "gamma"]) {
    await mkdir(path.join(workspace, name));
    await writeFile(path.join(workspace, name, "package.json"), "{}");
  }
  await writeFile(
    path.join(workspace, "alpha/review.ts"),
    Array.from({ length: 50 }, (_, i) => `// 审计位置 ${i}`).join("\n"),
  );
  for (let i = 0; i < 8; i++) {
    const cwd = path.join(workspace, ["alpha", "beta", "gamma"][i % 3]);
    const { thread } = await rpc("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    await rpc("turn/start", {
      threadId: thread.id,
      input: [
        {
          type: "text",
          text: `会话编号 ${i}。仅返回固定验收结果，不执行任何工具。`,
        },
      ],
    });
    const deadline = Date.now() + 15000;
    while (!completed.has(thread.id) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      completed.get(thread.id),
      "completed",
      "本地固定响应必须完成回合",
    );
    await rpc("thread/name/set", {
      threadId: thread.id,
      name: [
        "接口权限重构",
        "设备控制联调",
        "会话面板交互",
        "错误回写检查",
        "媒体处理",
        "发布文档",
        "规划与审计",
        "项目配置",
      ][i],
    });
    ids.push(thread.id);
  }
  const listed = await rpc("thread/list", {
    limit: 100,
    sourceKinds: ["cli", "vscode", "appServer"],
    useStateDbOnly: true,
  });
  assert.equal(listed.data.length, 8);
} finally {
  server.kill("SIGTERM");
  lines.close();
}
await writeFile(
  path.join(root, "seed.json"),
  JSON.stringify({ ids, workspace }),
);
await build({
  entryPoints: { host: "test/sessions-host.ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outdir: root,
  outExtension: { ".js": ".cjs" },
});
// 驱动仅安装在本次隔离用户目录内，不触碰用户正在使用的窗口。
const driver = path.join(extensions, "sessions.verify-driver-0.0.1");
await mkdir(driver);
await writeFile(
  path.join(driver, "package.json"),
  JSON.stringify({
    name: "verify-driver",
    publisher: "sessions",
    version: "0.0.1",
    engines: { vscode: "^1.95.0" },
    activationEvents: ["onStartupFinished"],
    main: "driver.cjs",
  }),
);
await writeFile(
  path.join(driver, "driver.cjs"),
  `exports.activate=()=>{setTimeout(()=>require(${JSON.stringify(path.join(root, "host.cjs"))}).run().finally(()=>require('vscode').commands.executeCommand('workbench.action.quit')).catch(()=>{}),200)};`,
);
await writeFile(
  path.join(userData, "User/settings.json"),
  JSON.stringify({
    "codexProfiles.codexHome": home,
    "update.mode": "none",
    "workbench.startupEditor": "none",
    "telemetry.telemetryLevel": "off",
    "chat.disableAIFeatures": true,
    "window.commandCenter": false,
    "window.dialogStyle": "custom",
  }),
);
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const env = { ...process.env, CODEX_HOME: home, SESSIONS_VERIFY_ROOT: root, SESSIONS_VERIFY_LIVE: verifyLive ? '1' : '0' };
for (const key of Object.keys(env))
  if (key.startsWith("VSCODE_") || key === "ELECTRON_RUN_AS_NODE")
    delete env[key];
console.log("VERIFY_ROOT=" + root);
const child = spawn(
  "/usr/bin/arch",
  [
    arch === "arm64" ? "-arm64" : "-x86_64",
    runtime,
    workspace,
    "--user-data-dir",
    userData,
    "--extensions-dir",
    extensions,
    "--extensionDevelopmentPath=" + process.cwd(),
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--new-window",
    "--disable-gpu",
    "--remote-debugging-port=" + port,
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let done = false,
  logs = "",
  browser;
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => (logs = (logs + data.toString()).slice(-10000)));
const exited = new Promise((resolve) =>
  child.on("exit", () => {
    done = true;
    resolve();
  }),
);
let results, forcedCleanup = false;
try {
  const deadline = Date.now() + 60000;
  while (!(await stat(path.join(root, "ready.json")).catch(() => false)) && !(await stat(path.join(root, "enable-required")).catch(() => false))) {
    if (done || Date.now() > deadline)
      throw new Error("隔离宿主未就绪：" + logs);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  let page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes("/workbench/"));
  assert.ok(page);
  if (verifyLive && !(await stat(path.join(root, 'ready.json')).catch(() => false))) {
    await page.getByRole('button', { name: '启用实时监听', exact: true }).click();
    await page.getByRole('button', { name: '稍后', exact: true }).click();
    const deadline = Date.now() + 45000;
    while (!(await stat(path.join(root, 'ready.json')).catch(() => false))) {
      if (done || Date.now() > deadline) throw new Error('启用后隔离窗口重载失败：' + logs);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('/workbench/'));
  }
  await page.screenshot({ path: path.join(root, "before-navigation.png") });
  if (
    await page
      .getByText(
        "Allow 'Codex – OpenAI’s coding agent' extension to open this URI?",
        { exact: true },
      )
      .count()
  ) {
    await page
      .getByText("Do not ask me again for this extension", { exact: true })
      .click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
  }
  const cdp = await browser.newBrowserCDPSession();
  let sequence = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
    const reply = JSON.parse(message);
    pending.get(reply.id)?.(reply);
  });
  const evaluate = (sessionId, expression) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Webview timeout"));
        }, 5000);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        pending.delete(id);
        reply.error
          ? reject(new Error(JSON.stringify(reply.error)))
          : resolve(reply.result?.result?.value);
      });
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: {
              expression:
                "(()=>{const document=globalThis.document.getElementById('active-frame')?.contentDocument??globalThis.document;return (" +
                expression +
                ");})()",
              returnByValue: true,
            },
          }),
        })
        .catch(reject);
    });
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(message);
  };
  let panel, sidebar;
  await waitFor(async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const target of targetInfos.filter(
      (t) => t.type === "iframe" && t.url.includes("extensionId="),
    )) {
      if (
        !panel &&
        target.url.includes("extensionId=huixiangyang.codex-profile-switcher")
      )
        panel = (
          await cdp.send("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: false,
          })
        ).sessionId;
      if (!sidebar && target.url.includes("extensionId=openai.chatgpt"))
        sidebar = (
          await cdp.send("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: false,
          })
        ).sessionId;
    }
    return panel && sidebar;
  }, "会话列表和官方侧栏必须真实渲染");
  await waitFor(
    async () =>
      (await evaluate(
        panel,
        "document.querySelectorAll('#sessions tr').length",
      )) === 8,
    "必须列出当前工作区八个会话",
  );
  await waitFor(
    async () =>
      Boolean(
        (await evaluate(sidebar, "document.body.innerText"))?.includes(
          "会话编号 0",
        ),
      ),
    "官方侧栏没有切换到第一条会话",
  );
  assert.equal(
    await evaluate(panel, 'document.getElementById("source").innerText'),
    verifyLive ? "实时监听" : "本地记录",
  );
  const firstStats = await evaluate(
    panel,
    `(()=>{const row=document.querySelector('[data-id="${ids[0]}"]');return {tokens:row.querySelector('[data-token="total"] .token-value').textContent,rounds:row.querySelector('.rounds-cell').textContent,duration:row.querySelector('.duration-cell').textContent,detail:row.querySelector('.tokens-cell').title}})()`,
  );
  assert.equal(firstStats.tokens, "2");
  assert.equal(firstStats.rounds, "1");
  assert.notEqual(firstStats.duration, "—");
  assert.match(firstStats.detail, /记录回合数：1/);
  assert.match(firstStats.detail, /输入：1/);
  const panelLocation = await page.evaluate(() => {
    const part = document.querySelector(".part.panel");
    const rect = part.getBoundingClientRect();
    return { y: rect.y, height: rect.height, text: part.innerText };
  });
  assert.ok(
    panelLocation.y > 200 && panelLocation.text.includes("Codex"),
    "会话应在底部 Panel",
  );
  await evaluate(
    panel,
    "(()=>{const input=document.getElementById('search');input.value='媒体';input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  assert.equal(
    await evaluate(panel, "document.querySelectorAll('#sessions tr').length"),
    1,
  );
  await evaluate(
    panel,
    "(()=>{const input=document.getElementById('search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await evaluate(
    panel,
    `document.querySelector('[data-id="${ids[1]}"] .session-title').click()`,
  );
  await waitFor(
    async () =>
      Boolean(
        (await evaluate(sidebar, "document.body.innerText"))?.includes(
          "会话编号 1",
        ),
      ),
    "点击列表必须让同一个官方侧栏切换到第二条会话",
  );
  await evaluate(
    panel,
    `(()=>{const button=document.querySelector('[data-id="${ids[0]}"] .session-title');button.focus();button.click();})()`,
  );
  await waitFor(
    async () =>
      Boolean(
        (await evaluate(sidebar, "document.body.innerText"))?.includes(
          "会话编号 0",
        ),
      ),
    "必须可以切回第一条会话",
  );
  // 不执行刷新命令，验证标题索引追加能够自动更新面板。
  const beforeAutomatic = Date.now();
  await writeFile(path.join(home, 'session_index.jsonl'), JSON.stringify({ id: ids[0], thread_name: '自动刷新验收', updated_at: new Date().toISOString() }) + '\n', { flag: 'a' });
  await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-id="${ids[0]}"] .session-title').textContent`))?.includes('自动刷新验收'), '落盘标题必须自动刷新');
  const automaticRefreshMs = Date.now() - beforeAutomatic;
  // 只关闭隔离测试环境中的首次启动推广层，方便检查真实会话和面板布局。
  await evaluate(
    sidebar,
    "(()=>{for(const button of document.querySelectorAll('button'))if(button.textContent.includes('Continue with current model'))button.click();})()",
  );
  if (verifyLive) {
    holdModelResponse = true;
    await evaluate(sidebar, `(()=>{
      const editor=document.querySelector('[data-codex-composer="true"]');
      editor.focus(); document.execCommand('insertText',false,'请返回隔离验收结果，不调用工具。');

    })()`);
    await waitFor(async () => (await evaluate(sidebar, `Array.from(document.querySelectorAll('button')).filter(b=>!b.disabled&&/^Send(?: |$)/.test(b.getAttribute('aria-label')||b.title||b.textContent)).length`)) === 1, '输入后发送按钮必须就绪');
    await evaluate(sidebar, `Array.from(document.querySelectorAll('button')).find(b=>!b.disabled&&/^Send(?: |$)/.test(b.getAttribute('aria-label')||b.title||b.textContent)).click()`);
    await waitFor(async () => releaseModelResponse && (await evaluate(panel, `document.querySelector('[data-id="${ids[0]}"] .status').textContent`)) === '运行中', '官方侧栏发送后必须自动显示运行中');
    assert.equal(await evaluate(panel, `document.querySelector('[data-id="${ids[0]}"] .status svg').getAnimations().length`), 1);
    await page.screenshot({ path: path.join(root, 'vscode-live-running.png') });
    holdModelResponse = false; releaseModelResponse();
    await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-id="${ids[0]}"] .status').textContent`)) === '空闲', '官方回合结束后必须停止运行状态');
  }
  // 以真实落盘格式追加两个新结果；当前代码内容故意不同，预览只能展示该轮证据。
  const rolloutNames = await readdir(path.join(home, 'sessions'), {recursive:true});
  const rollout = path.join(home, 'sessions', rolloutNames.find(name => name.endsWith('.jsonl') && name.includes(ids[0])));
  const reviewTurns = [randomUUID(), randomUUID(), randomUUID()];
  const appendReviewTurn = async (turnId, index) => {
    const stamp = new Date().toISOString();
    const row = payload => JSON.stringify({timestamp:stamp,type:'event_msg',payload})+'\n';
    await writeFile(rollout, row({type:'task_started',turn_id:turnId})
      + row({type:'item_completed',thread_id:ids[0],turn_id:turnId,completed_at_ms:Date.now(),item:{type:'FileChange',id:'review-item-'+index,status:'completed',changes:{[path.join(workspace,'alpha/review.ts')]:{type:'update',unified_diff:'@@ -1 +1 @@\n-before-'+index+'\n+after-'+index+'\n',move_path:null}}}})
      + row({type:'task_complete',turn_id:turnId,duration_ms:12}), {flag:'a'});
  };
  await appendReviewTurn(reviewTurns[0],1); await appendReviewTurn(reviewTurns[1],2);
  const expectedPending = verifyLive ? '3' : '2'; // 官方发送的文字结果也需要明确审阅。
  await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-review="${ids[0]}"] .review-badge').textContent`)) === expectedPending, '新回合必须自动进入待审阅');
  await evaluate(panel, `document.querySelector('[data-review="${ids[0]}"]').click()`);
  await waitFor(async () => !!(await evaluate(panel, `document.querySelector('#review select')` + `?.value`)), '审阅详情必须打开');
  await evaluate(panel, `(()=>{const select=document.querySelector('#review select');select.value='${reviewTurns[0]}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async () => (await evaluate(panel, `document.querySelector('#review select').value`)) === reviewTurns[0], '审阅必须绑定第一轮');
  await evaluate(panel, `document.querySelector('[data-control="patch-0"]').click()`);
  await writeFile(path.join(root,'check-review'),'');
  await waitFor(async () => !!(await stat(path.join(root,'review-check.json')).catch(()=>false)), '真实只读补丁文档必须打开');
  const check = JSON.parse(await readFile(path.join(root,'review-check.json'),'utf8')); assert.equal(check.success,true,check.error);
  await evaluate(panel, `document.querySelector('[data-control="mark"]').click()`);
  await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-control="mark"]').textContent`))?.includes('撤销'), '标记审阅必须持久化后反馈');
  await evaluate(panel, `(()=>{const select=document.querySelector('#review select');select.value='${reviewTurns[1]}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await appendReviewTurn(reviewTurns[2],3);
  await waitFor(async () => (await evaluate(panel, `document.querySelectorAll('#review select option').length`)) >= (verifyLive ? 5 : 4), '新的回合应该进入选择器');
  assert.equal(await evaluate(panel, `document.querySelector('#review select').value`),reviewTurns[1]);
  await page.screenshot({path:path.join(root,'vscode-review.png')});
  await evaluate(panel, `document.querySelector('[data-control="back"]').click()`);
  const failedRollout = path.join(home, 'sessions', rolloutNames.find(name => name.endsWith('.jsonl') && name.includes(ids[1])));
  const failTurn = randomUUID(), stamp = new Date().toISOString();
  await writeFile(failedRollout, JSON.stringify({timestamp:stamp,type:'event_msg',payload:{type:'task_started',turn_id:failTurn}})+'\n'+JSON.stringify({timestamp:stamp,type:'event_msg',payload:{type:'task_complete',turn_id:failTurn,error:{message:'fixture failure'},duration_ms:10}})+'\n',{flag:'a'});
  await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-filter="attention"]').textContent`))?.includes('1'), '新的失败回合必须进入待处理');
  await evaluate(panel, `document.getElementById('next').click()`);
  await waitFor(async () => (await evaluate(sidebar, 'document.body.innerText'))?.includes('会话编号 1'), '下一条待处理必须切换官方侧栏');
  await waitFor(async () => (await evaluate(panel, `document.querySelector('[data-filter="attention"]').textContent`))?.includes('0'), '查看失败后只清除失败提醒');
  await evaluate(panel, `document.querySelector('[data-filter="all"]').click()`);
  await page.screenshot({ path: path.join(root, "vscode-sessions.png") });
  results = {
    localRecordCatalog: 8,
    automaticRefreshMs,
    nextAttentionNavigation: true,
    perTurnReview: true,
    readOnlyPatchPreview: true,
    oldReviewKeptOnNewTurn: true,
    nativeLiveRunningToIdle: verifyLive,
    perSessionStats: true,
    bottomPanel: true,
    sidebarSwitch: true,
    switchedBack: true,
    search: true,
  };
} finally {
  releaseModelResponse?.();
  await browser?.close().catch(() => {}); browser = undefined;
  await writeFile(path.join(root, "release"), "");
  // 驱动已经请求退出；Electron 若残留主进程，只清理本次 spawn 的隔离宿主。
  const sampleTimer = setTimeout(() => execFile('/usr/bin/sample', [String(child.pid), '1', '1', '-file', path.join(root, 'shutdown.sample.txt')], () => {}), 3000);
  const timer = setTimeout(() => { forcedCleanup = true; child.kill('SIGKILL'); }, 10000);
  await exited;
  clearTimeout(timer); clearTimeout(sampleTimer);
  await browser?.close().catch(() => {});
  await writeFile(path.join(root, "launch.log"), logs);
  await new Promise((resolve) => responder.close(resolve));
}
const report = JSON.parse(
  await readFile(path.join(root, "result.json"), "utf8"),
);
assert.equal(report.success, true, report.error);
results = { ...results, ...report, forcedCleanup };
await writeFile(
  path.resolve(verifyLive ? "artifacts/sessions-live-verification.json" : "artifacts/sessions-verification.json"),
  JSON.stringify(
    { root, officialExtension: installed.relativeLocation, results },
    null,
    2,
  ),
);
console.log(JSON.stringify({ root, results }));
