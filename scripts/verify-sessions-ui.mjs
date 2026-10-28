import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const root = process.cwd(),
  out = path.join(root, "artifacts/sessions-ui");
await build({
  entryPoints: {
    view: "src/sessions/view.ts",
    catalog: "src/sessions/catalog.ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: out,
  outExtension: { ".js": ".cjs" },
  alias: { vscode: path.join(root, "test/vscode-stub.ts") },
});
const { SessionView } = createRequire(import.meta.url)(
  path.join(out, "view.cjs"),
);
const { formatWorkingDirectory } = createRequire(import.meta.url)(
  path.join(out, "catalog.cjs"),
);
let html = "";
const noop = () => ({ dispose() {} });
new SessionView(
  { scheme: "file", authority: "", path: root },
  () => ({ sessions: [] }),
  async () => {},
).resolveWebviewView({
  webview: {
    options: {},
    cspSource: "file:",
    asWebviewUri: (uri) => uri.toString(),
    set html(value) {
      html = value;
    },
    postMessage() {},
    onDidReceiveMessage: noop,
  },
  onDidDispose: noop,
  onDidChangeVisibility: noop,
});
await writeFile(path.join(out, "index.html"), html);
const sessions = [
  ["题库接口权限重构", "arc-halo", "finished"],
  ["手机控制联调", "arc-home", "unclosed"],
  ["会话面板交互", ".", "finished"],
  ["错误回写检查", "arc-halo", "interrupted"],
  ["厨房媒体处理", "arc-home/services/media", "finished"],
  ["发布与安装说明", "codex-profile-switcher", "finished"],
  ["规划与审计", "arc-halo", "failed"],
  ["项目配置", "arc-home", "empty"],
].map(([title, relativeCwd, state], i) => ({
  id: "t" + i,
  title,
  cwdLabel: formatWorkingDirectory(
    ["/workspace"],
    path.resolve("/workspace", relativeCwd),
  ),
  state,
  stateAt: state === "empty" ? null : Date.now() / 1000 - i * 190,
  stateReason: state === "empty" ? "no_events" : "lifecycle",
  cwd: path.resolve("/workspace", relativeCwd),
  provider: "relay",
  model: "gpt-6.1-sol",
  updatedAt: Date.now() / 1000 - i * 190,
  turns: [], createdAt: 1,
  workflow: { active: false, attention: null, attentionAt: 0, pending: i === 0 ? 2 : i === 4 ? 1 : 0 },
  stats: {
    tokens:
      i === 1 || i === 7
        ? null
        : {
            total: i === 2 ? 0 : i === 3 ? null : 128400,
            input: i === 2 ? 0 : 110000,
            output: i === 2 ? 0 : i === 3 ? null : 18400,
            cachedInput: i === 2 ? 0 : 82000,
            cacheWriteInput: 0,
            reasoningOutput: 0,
          },
    counts:
      i === 7
        ? null
        : {
            total: 12,
            completed: 10,
            failed: 1,
            interrupted: 1,
            unresolved: 0,
          },
    lastDurationMs: i === 1 || i === 7 ? null : i === 2 ? 0 : 155000,
    recordedDurationMs: i === 7 ? null : 1100000,
    timedTurns: i === 7 ? 0 : 12,
    inherited: false,
    incomplete: false,
  },
}));
const data = {
  columnLayout: {version:1, visible:null, widths:{}},
  sourceAvailable: true,
  loading: false,
  supported: true,
  selectedId: "t0",
  sessions,
};
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 360 },
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const palettes = {
    dark: {panel:'#191d21',foreground:'#d8dfe5',muted:'#8c969f',border:'#303840',input:'#252d33',accent:'#6ebfc2',hover:'#222b31',focus:'#6ebfc2',button:'#176b75',buttonText:'#ffffff',contrast:'transparent'},
    light: {panel:'#f8f9fa',foreground:'#29343c',muted:'#66727a',border:'#dde2e7',input:'#edf0f3',accent:'#137c77',hover:'#e8eef0',focus:'#137c77',button:'#176b75',buttonText:'#ffffff',contrast:'transparent'},
    'high-contrast': {panel:'#000000',foreground:'#ffffff',muted:'#ffffff',border:'#ffffff',input:'#000000',accent:'#ffff00',hover:'#222222',focus:'#ffff00',button:'#000000',buttonText:'#ffffff',contrast:'#ffffff'},
  };
  const theme = async name => page.evaluate(({name,colors}) => {
    const tokens={panel:'panel-background',foreground:'foreground',muted:'descriptionForeground',border:'panel-border',input:'input-background',accent:'textLink-foreground',hover:'list-hoverBackground',focus:'focusBorder',button:'button-background',buttonText:'button-foreground',contrast:'contrastBorder'};
    for(const [key,value] of Object.entries(colors)) document.documentElement.style.setProperty('--vscode-'+tokens[key],value);
    document.body.className='vscode-'+name;
    document.documentElement.style.colorScheme=name==='light'?'light':'dark';
    // 在主题切换的短过渡完成后测量；不等待持续旋转的运行图标。
    document.body.getBoundingClientRect();
    return Promise.all(document.getAnimations().filter(animation=>animation instanceof CSSTransition).map(animation=>animation.finished.catch(()=>{})));
  },{name,colors:palettes[name]});
  // 重点文字的对比度使用实际计算颜色，兼容 color-mix 返回的颜色格式。
  const readable = async selector => {
    const ratios = await page.locator(selector).evaluateAll(elements => {
      const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'); canvas.width=canvas.height=1;
      const pixel=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
      const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      return elements.map(el=>{
        const layers=[];for(let p=el;p;p=p.parentElement) layers.unshift(pixel(getComputedStyle(p).backgroundColor));
        let bg=[0,0,0];for(const rgba of layers) bg=bg.map((v,i)=>rgba[i]*rgba[3]/255+v*(1-rgba[3]/255));
        const fg=pixel(getComputedStyle(el).color), a=luminance(fg),b=luminance(bg);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
    });
    assert.ok(ratios.every(ratio=>ratio>=4.5), selector+' contrast: '+ratios.join(','));
  };

  const installFixture = (data) => {
    window.actions = [];
    window.fixtureState = data;
    window.acquireVsCodeApi = () => ({
      getState: () => ({}),
      setState() {},
      postMessage(message) {
        window.actions.push(message);
        if (message.action === 'layout') {
          if (window.holdLayouts) return;
          if (window.failLayouts) data.error='列布局保存失败，已恢复上次保存的布局。请稍后重试。';
          else { data.columnLayout=structuredClone(message.layout); delete data.error; }
          data.columnLayoutAck=message.requestId;
        }
        if (message.action === "switch") data.selectedId = message.id;
        if (message.action === 'review') data.review = {
          id: message.id, title: data.sessions.find(s=>s.id===message.id).title, turnId: message.turnId ?? 'turn-1',
          version: 'fixture-version', stale: false, status: 'pending', outcome: 'completed',
          turns: [{id:'turn-1',label:'10:05 · 第一轮',status:'pending'},{id:'turn-2',label:'10:10 · 第二轮',status:'pending'}],
          files: [{path:'/workspace/src/auth.ts',label:'src/auth.ts',kind:'update',operations:2,status:'completed',available:true},
            {path:'/workspace/src/new.ts',label:'src/new.ts',kind:'add',operations:1,status:'completed',available:true},
            {path:'/workspace/old.ts',label:'old.ts',kind:'delete',operations:1,status:'completed',available:true}],
          note:''
        };
        if (message.action === 'back') delete data.review;
        if (message.action === 'mark') { data.review.status = message.reviewed ? 'reviewed' : 'pending'; data.sessions[0].workflow.pending = message.reviewed ? 1 : 2; }
        if (message.action === 'next') data.focusAttention = (data.focusAttention ?? 0) + 1;
        setTimeout(
          () =>
            window.dispatchEvent(
              new MessageEvent("message", {
                data: { type: "state", state: data },
              }),
            ),
          0,
        );
      },
    });
  };
  await page.addInitScript(installFixture, data);
  await page.goto(pathToFileURL(path.join(out, "index.html")).href);
  await page.locator("#sessions tr").first().waitFor();
  // 无回合记录的状态单元格不能继承整页空态容器样式。
  assert.equal(await page.locator('[data-id="t7"] .status').evaluate(el => getComputedStyle(el).display), 'table-cell');
  assert.deepEqual(await page.locator('#sessions tr').evaluateAll(rows => rows.map(row => Math.round(row.getBoundingClientRect().height))), Array(8).fill(44));
  assert.equal(
    await page
      .getByRole("columnheader", { name: "工作目录", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.locator('[data-id="t2"] .cwd-cell').textContent(),
    "workspace（根目录）",
  );
  assert.equal(
    await page.locator('[data-id="t2"] .cwd-cell').getAttribute("title"),
    "/workspace",
  );
  assert.equal(
    await page.locator('[data-id="t4"] .cwd-cell').textContent(),
    "arc-home/services/media",
  );
  assert.equal(
    await page.locator('[data-id="t4"] .cwd-cell').getAttribute("title"),
    "/workspace/arc-home/services/media",
  );
  assert.equal(
    await page.locator('[data-id="t1"] .status').textContent(),
    "—",
  );
  assert.match(
    await page.locator('[data-id="t1"] .status').getAttribute("title"),
    /当前状态不可用/,
  );
  assert.equal(await page.locator('[data-id="t1"] .status svg').count(), 0);
  assert.equal(
    await page.locator('[data-id="t7"] .status').textContent(),
    "—",
  );
  // 只读文件模式不推断正在运行，也不能用旋转图标制造实时状态。
  assert.equal(
    await page
      .locator(".status svg")
      .evaluateAll((icons) =>
        icons.some((icon) => icon.getAnimations().length > 0),
      ),
    false,
  );
  assert.equal(
    await page
      .locator('[data-id="t0"] [data-token="total"] .token-value')
      .textContent(),
    "128K",
  );
  assert.equal(
    await page.locator('[data-id="t0"] .duration-cell').textContent(),
    "2m 35s",
  );
  assert.match(
    await page.locator('[data-id="t0"] .tokens-cell').getAttribute("title"),
    /输入中已缓存：82,000/,
  );
  assert.match(
    await page.locator('[data-id="t0"] .tokens-cell').getAttribute("title"),
    /记录回合数：12/,
  );
  assert.equal(
    await page
      .locator('[data-id="t1"] [data-token="total"] .token-value')
      .textContent(),
    "—",
  );
  assert.equal(
    await page.locator('[data-id="t1"] .duration-cell').textContent(),
    "—",
  );
  assert.equal(
    await page
      .locator('[data-id="t2"] [data-token="total"] .token-value')
      .textContent(),
    "0",
  );
  assert.equal(
    await page.locator('[data-id="t2"] .duration-cell').textContent(),
    "0ms",
  );
  assert.equal(
    await page
      .getByRole("columnheader", { name: "Token 用量", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("columnheader", { name: "会话轮次", exact: true })
      .count(),
    1,
  );
  assert.deepEqual(
    await page.locator('[data-id="t0"] .token-kind').allTextContents(),
    ["入", "出", "缓", "总"],
  );
  assert.deepEqual(
    await page.locator('[data-id="t0"] .token-value').allTextContents(),
    ["110K", "18.4K", "82K", "128K"],
  );
  assert.deepEqual(
    await page.locator('[data-id="t1"] .token-value').allTextContents(),
    ["—", "—", "—", "—"],
  );
  assert.deepEqual(
    await page.locator('[data-id="t2"] .token-value').allTextContents(),
    ["0", "0", "0", "0"],
  );
  assert.deepEqual(
    await page.locator('[data-id="t3"] .token-value').allTextContents(),
    ["110K", "—", "82K", "—"],
  );
  assert.equal(
    await page.locator('[data-id="t0"] .rounds-cell').textContent(),
    "12",
  );
  assert.equal(
    await page.locator('[data-id="t7"] .rounds-cell').textContent(),
    "—",
  );
  assert.match(
    await page.locator('[data-id="t0"] .rounds-cell').getAttribute("title"),
    /按回合 ID 去重/,
  );
  assert.deepEqual(await page.locator('[data-id="t0"] .token-kind').evaluateAll(labels=>labels.map(label=>label.title)), ['输入','输出','缓存输入','总计']);
  assert.match(await page.locator('[data-id="t0"] .tokens-cell').getAttribute('title'), /累计 Token：128,400/);
  const tokenColumn = await page.locator('[data-id="t0"] .tokens-cell').evaluate(cell=>({width:cell.getBoundingClientRect().width,fontSize:parseFloat(getComputedStyle(cell.querySelector('.token-value')).fontSize)}));
  assert.equal(Math.round(tokenColumn.width),136);
  assert.ok(tokenColumn.fontSize>=12);
  await page.screenshot({ path: path.join(out, "sessions-dark.png") });
  // 同一批数据刷新不能重建 DOM；变更数值、状态或顺序时仍保留原行与滚动位置。
  const stableRows = await page.evaluate(() => {
    const body = document.getElementById("sessions"), main = document.querySelector("main");
    const rows = new Map([...body.children].map(row => [row.dataset.id, row]));
    const focused = rows.get("t3").querySelector(".session-title");
    focused.focus({ preventScroll: true }); main.scrollTop = 60;
    const scroll = main.scrollTop;
    const observer = new MutationObserver(() => {});
    observer.observe(body, { childList: true, subtree: true });
    const publish = state => window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }));
    publish({ ...window.fixtureState, loading: true });
    const mutations = observer.takeRecords();
    // 相对更新时间随时钟自然变化，不计入无变化内容的 DOM 重建检查。
    const unchangedMutations = mutations.filter(record => !record.target.closest('.time-cell')).length;
    observer.disconnect();
    const next = structuredClone(window.fixtureState);
    next.sessions[0].stats.tokens.input = 123456;
    next.sessions[0].stats.counts.total = 13;
    next.sessions[1].state = "finished";
    next.sessions.unshift(next.sessions.pop());
    publish(next);
    const result = {
      unchangedMutations,
      sameRows: [...body.children].every(row => rows.get(row.dataset.id) === row),
      focus: document.activeElement === focused,
      scroll: main.scrollTop === scroll,
      order: body.firstElementChild.dataset.id,
      input: rows.get("t0").querySelector('[data-token="input"] .token-value').textContent,
      rounds: rows.get("t0").querySelector('.rounds-cell').textContent,
      status: rows.get("t1").querySelector('.status').textContent,
    };
    publish(window.fixtureState); main.scrollTop = 0;
    return result;
  });
  assert.deepEqual(stableRows, {
    unchangedMutations: 0, sameRows: true, focus: true, scroll: true,
    order: "t0", input: "123K", rounds: "13", status: "已完成",
  });
  // headless Chrome 会把不同顶层页都视作聚焦；用真实 iframe 与宿主输入框复现失焦。
  await writeFile(path.join(out, "focus.html"), '<!doctype html><input aria-label="代码编辑器"><iframe src="index.html" style="width:1200px;height:360px"></iframe>');
  const other = await browser.newPage();
  await other.addInitScript(installFixture, data);
  await other.goto(pathToFileURL(path.join(out, "focus.html")).href);
  const panelFrame = other.frameLocator("iframe");
  await panelFrame.locator(".session-title").first().focus();
  await other.getByRole("textbox", { name: "代码编辑器" }).focus();
  const background = await panelFrame.locator("body").evaluate(body => {
    const document = body.ownerDocument, window = document.defaultView;
    const before = document.hasFocus();
    let focusCalls = 0;
    const original = window.HTMLElement.prototype.focus;
    window.HTMLElement.prototype.focus = function (...args) { focusCalls++; return original.apply(this, args); };
    try {
      const next = structuredClone(window.fixtureState); next.sessions.reverse();
      window.dispatchEvent(new window.MessageEvent("message", { data: { type: "state", state: next } }));
      window.dispatchEvent(new window.MessageEvent("message", { data: { type: "state", state: window.fixtureState } }));
      return { before, focusCalls, focused: document.hasFocus() };
    } finally { window.HTMLElement.prototype.focus = original; }
  });
  assert.deepEqual(background, { before: false, focusCalls: 0, focused: false });
  assert.equal(await other.getByRole("textbox").evaluate(input => input === document.activeElement), true);
  await other.close();
  await page.getByRole("searchbox").fill("媒体");
  assert.equal(await page.locator("#sessions tr").count(), 1);
  await page.getByRole("searchbox").fill("services/media");
  assert.equal(await page.locator("#sessions tr").count(), 1);
  await page.locator(".token-value").first().click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.actions.filter((m) => m.action === "switch"),
    ),
    [{ action: "switch", id: "t4" }],
  );
  await page.getByRole("searchbox").fill("");
  await page.locator(".session-title").first().focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.locator(".session-title:focus").getAttribute("data-id"),
    "t1",
  );
  await page.setViewportSize({ width: 540, height: 240 });
  assert.equal(
    await page
      .getByRole("columnheader", { name: "会话轮次", exact: true })
      .isVisible(),
    true,
  );
  for (const metric of await page.locator('[data-id="t0"] .token-metric').all())
    assert.equal(await metric.isVisible(), true);
  assert.equal(
    await page
      .locator(".token-metric")
      .evaluateAll((metrics) =>
        metrics.some((metric) => metric.scrollWidth > metric.clientWidth),
      ),
    false,
  );
  // 大数与跨单位边界也不能把收窄后的单元格撑开或隐藏字段。
  const stress = await page.evaluate(()=>{
    const next=structuredClone(window.fixtureState);
    next.sessions[0].stats.tokens={input:1234000000,output:999500,cachedInput:99900000,total:1234999500};
    next.sessions[3].stats.tokens={input:Number.MAX_SAFE_INTEGER-1000,output:1000,cachedInput:0,total:Number.MAX_SAFE_INTEGER};
    const publish=state=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));
    publish(next);
    const result={
      values:[...document.querySelectorAll('[data-id="t0"] .token-value')].map(el=>el.textContent),
      overflow:[...document.querySelectorAll('.token-metric')].some(el=>el.scrollWidth>el.clientWidth),
      width:document.querySelector('[data-id="t0"] .tokens-cell').getBoundingClientRect().width,
      label:document.querySelector('[data-id="t0"] .tokens-cell').getAttribute('aria-label'),
    };
    publish(window.fixtureState);return result;
  });
  assert.deepEqual(stress.values,['1.23B','1M','99.9M','1.23B']);
  assert.equal(stress.overflow,false);
  assert.equal(Math.round(stress.width),136);
  assert.match(stress.label,/1,234,999,500/);
  await page.screenshot({ path: path.join(out, "sessions-compact.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1200, height: 360 });
  await theme('light');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(248, 249, 250)",
  );
  await page.screenshot({ path: path.join(out, "sessions-light.png") });
  // 按用户反馈截图的尺寸复核根目录标签，不能再看起来像空白单元格。
  await page.setViewportSize({ width: 822, height: 407 });
  assert.equal(
    await page
      .locator('[data-id="t2"] .cwd-cell')
      .evaluate((cell) => cell.scrollWidth > cell.clientWidth),
    false,
  );
  assert.equal(
    await page
      .getByRole("columnheader", { name: "会话轮次", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .locator(".token-metric")
      .evaluateAll((metrics) =>
        metrics.some((metric) => metric.scrollWidth > metric.clientWidth),
      ),
    false,
  );
  await page.screenshot({ path: path.join(out, "sessions-light-822.png") });
  // 只有后端确认的运行状态旋转；批准、输入和历史记录使用静态图标。
  await page.evaluate(() => {
    const next = structuredClone(window.fixtureState); next.liveMode = 'connected';
    ['running', 'approval', 'input', 'approvalInput', 'idle'].forEach((state, i) => {
      next.sessions[i].live = { id: next.sessions[i].id, state, at: Date.now() };
      Object.assign(next.sessions[i].workflow,{active:state!=='idle',attention:i>0&&i<4?'waiting':null,attentionAt:Date.now()-i*1000});
    });
    window.liveFixture = next;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: next } }));
  });
  assert.deepEqual(await page.locator('#sessions .status').allTextContents(), ['运行中', '待批准', '待回复', '待处理', '空闲', '已完成', '失败', '—']);
  assert.equal(await page.locator('[data-id="t0"] .status svg').evaluate(icon => icon.getAnimations().length), 1);
  assert.equal(await page.locator('[data-id="t1"] .status svg').evaluate(icon => icon.getAnimations().length), 0);
  assert.equal(await page.locator('[data-id="t2"] .status svg').evaluate(icon => icon.getAnimations().length), 0);
  assert.equal(await page.locator('#source').textContent(), '实时监听');
  await readable('.status > span');
  assert.equal(await page.locator('[data-filter="active"] .filter-count').textContent(),'4');
  await page.screenshot({ path: path.join(out, 'sessions-live-light-822.png') });
  await theme('dark'); await readable('.status > span');
  await page.screenshot({ path: path.join(out, 'sessions-live-dark-822.png') });
  await theme('light');
  await page.setViewportSize({ width: 540, height: 240 });
  await page.screenshot({ path: path.join(out, 'sessions-live-compact.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('[data-id="t0"] .status svg').evaluate(icon => icon.getAnimations().length), 0);
  await page.evaluate(() => {
    const next = structuredClone(window.fixtureState); next.liveMode = 'disconnected';
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: next } }));
  });
  assert.equal(await page.locator('#source').textContent(), '监听已断开');
  assert.equal(await page.locator('[data-id="t0"] .status').textContent(), '已完成');
  await page.locator('#source').click();
  assert.ok(await page.evaluate(() => window.actions.some(message => message.action === 'configureLive')));
  await page.setViewportSize({width:822,height:407});
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:window.fixtureState}})));
  await page.locator('[data-filter="review"]').click();
  assert.equal(await page.locator('#sessions tr').count(),2);
  const switchesBefore = await page.evaluate(()=>window.actions.filter(m=>m.action==='switch').length);
  await page.locator('[data-review="t0"]').click();
  await page.locator('#review').waitFor({state:'visible'});
  assert.equal(await page.getByRole('combobox',{name:'选择审阅回合'}).inputValue(),'turn-1');
  assert.equal(await page.evaluate(()=>window.actions.filter(m=>m.action==='switch').length),switchesBefore);
  await readable('.primary-action');
  await page.screenshot({path:path.join(out,'review-light-822.png')});
  await theme('dark'); await readable('.primary-action');
  await page.screenshot({path:path.join(out,'review-dark-822.png')});
  await theme('high-contrast');
  await readable('.primary-action');
  assert.notEqual(await page.locator('.primary-action').evaluate(el=>getComputedStyle(el).boxShadow),'none');
  await page.screenshot({path:path.join(out,'review-high-contrast.png')});
  await theme('light');
  await page.locator('[data-control="patch-0"]').click();
  assert.ok(await page.evaluate(()=>window.actions.some(m=>m.action==='patch'&&m.turnId==='turn-1'&&m.path==='/workspace/src/auth.ts')));
  await page.getByRole('button',{name:'标记本轮已审阅',exact:true}).click();
  await page.getByRole('button',{name:'撤销审阅',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'选择审阅回合'}).selectOption('turn-2');
  await page.getByRole('button',{name:'标记本轮已审阅',exact:true}).waitFor();
  await page.setViewportSize({width:540,height:240});
  await page.screenshot({path:path.join(out,'review-compact.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'返回会话列表',exact:true}).click();
  assert.equal(await page.locator('[data-review="t0"] .review-badge').textContent(),'1');
  await page.locator('#filter-select').selectOption('all');
  await page.setViewportSize({width:360,height:240});
  assert.equal(await page.getByRole('searchbox').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'下一条待处理会话',exact:true}).isVisible(),true);
  assert.ok(await page.locator('#list-header').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:path.join(out,'sessions-narrow-360.png')});
  // 列配置必须在真实 CSP 下工作；手动选择的列跨宽窄面板保持可见。
  await page.setViewportSize({width:822,height:407});
  await page.getByRole('columnheader',{name:'工作目录',exact:true}).click({button:'right'});
  await page.getByRole('dialog',{name:'列设置'}).waitFor({state:'visible'});
  assert.equal(await page.locator('#column-menu input[value="title"]').isDisabled(),true);
  assert.equal(await page.locator('#column-menu input[value="model"]').isChecked(),false);
  await page.locator('#column-menu input[value="model"]').check();
  await page.waitForFunction(()=>window.fixtureState.columnLayout.visible?.includes('model'));
  assert.equal(await page.getByRole('columnheader',{name:'模型 / Provider',exact:true}).isVisible(),true);
  await page.screenshot({path:path.join(out,'column-menu-light.png')});
  await theme('dark');await page.screenshot({path:path.join(out,'column-menu-dark.png')});
  await theme('high-contrast');await page.screenshot({path:path.join(out,'column-menu-high-contrast.png')});
  await theme('light');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:540,height:240});
  assert.equal(await page.getByRole('columnheader',{name:'模型 / Provider',exact:true}).isVisible(),true);
  assert.ok(await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth));
  await page.getByRole('button',{name:'配置列',exact:true}).click();
  const popup = await page.getByRole('dialog',{name:'列设置'}).boundingBox();
  assert.ok(popup.x>=0&&popup.y>=0&&popup.x+popup.width<=540&&popup.y+popup.height<=240);
  await page.locator('#column-menu input[value="tokens"]').uncheck();
  assert.equal(await page.getByRole('columnheader',{name:'Token 用量',exact:true}).isVisible(),false);
  await page.screenshot({path:path.join(out,'column-menu-compact.png')});
  await page.getByRole('button',{name:'恢复默认布局',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureState.columnLayout.visible===null);
  assert.equal(await page.getByRole('columnheader',{name:'Token 用量',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('columnheader',{name:'模型 / Provider',exact:true}).isVisible(),false);

  await page.setViewportSize({width:822,height:407});
  const width = async id=>Math.round(await page.locator(`thead [data-column="${id}"]`).evaluate(el=>el.getBoundingClientRect().width));
  const drag = async (id,delta,finish=true) => {
    const box=await page.locator(`[data-resize="${id}"]`).boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+delta,box.y+box.height/2,{steps:6});
    if(finish) await page.mouse.up();
  };
  const cwdWidth=await width('cwd'), titleWidth=await width('title');
  const switchesAtResize=await page.evaluate(()=>window.actions.filter(m=>m.action==='switch').length);
  await drag('cwd',48);
  await page.waitForFunction(expected=>window.fixtureState.columnLayout.widths.cwd===expected,cwdWidth+48);
  assert.equal(await width('cwd'),cwdWidth+48); assert.equal(await width('title'),titleWidth);
  assert.equal(await page.evaluate(()=>window.actions.filter(m=>m.action==='switch').length),switchesAtResize);
  const saves=await page.evaluate(()=>window.actions.filter(m=>m.action==='layout').length);
  await drag('cwd',24,false); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await width('cwd'),cwdWidth+48);
  assert.equal(await page.evaluate(()=>window.actions.filter(m=>m.action==='layout').length),saves);
  await page.locator('[data-resize="tokens"]').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.fixtureState.columnLayout.widths.tokens===144);
  assert.equal(await width('tokens'),144);
  await page.keyboard.press('Home');
  await page.waitForFunction(()=>window.fixtureState.columnLayout.widths.tokens===136);
  await page.keyboard.press('ArrowLeft');assert.equal(await width('tokens'),136);
  await page.screenshot({path:path.join(out,'columns-resized.png')});
  await page.locator('main').evaluate(el=>{el.scrollLeft=32});
  const horizontal = await page.locator('main').evaluate(el=>el.scrollLeft);
  assert.ok(horizontal>0);
  // 模拟命令触发审阅，不先通过点击滚动回最左边。
  await page.evaluate(()=>document.querySelector('[data-review="t0"]').click());
  await page.getByRole('button',{name:'返回会话列表',exact:true}).click();
  assert.equal(await page.locator('main').evaluate(el=>el.scrollLeft),horizontal);

  // 重新创建 Webview 时使用宿主保存的设置，不依赖页面内的临时状态。
  const savedLayout=await page.evaluate(()=>window.fixtureState.columnLayout);
  const restored=await browser.newPage({viewport:{width:822,height:407}});
  await restored.addInitScript(installFixture,{...data,columnLayout:savedLayout});
  await restored.goto(pathToFileURL(path.join(out,'index.html')).href);
  await restored.locator('#sessions tr').first().waitFor();
  assert.equal(Math.round(await restored.locator('thead [data-column="cwd"]').evaluate(el=>el.getBoundingClientRect().width)),cwdWidth+48);
  await restored.close();
  await page.locator('[data-resize="cwd"]').dblclick();
  await page.waitForFunction(()=>window.fixtureState.columnLayout.widths.cwd===undefined);
  assert.equal(await width('cwd'),cwdWidth);

  // 后台刷新不能抢先回写旧偏好；失败必须回退到已经保存的列宽。
  await page.evaluate(()=>window.holdLayouts=true);
  await page.locator('[data-resize="tokens"]').focus();await page.keyboard.press('ArrowRight');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:window.fixtureState}})));
  assert.equal(await width('tokens'),144);
  await page.evaluate(()=>{
    const message=window.actions.filter(m=>m.action==='layout').at(-1);
    window.fixtureState.columnLayout=structuredClone(message.layout);window.fixtureState.columnLayoutAck=message.requestId;window.holdLayouts=false;
    window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:window.fixtureState}}));
  });
  await page.evaluate(()=>window.failLayouts=true);
  await page.keyboard.press('ArrowRight');
  await page.locator('#notice').getByText(/保存失败/).waitFor();
  assert.equal(await width('tokens'),144);
  await page.evaluate(()=>window.failLayouts=false);
  await page.getByRole('button',{name:'配置列',exact:true}).click();
  await page.getByRole('button',{name:'恢复默认布局',exact:true}).click();
  await page.waitForFunction(()=>Object.keys(window.fixtureState.columnLayout.widths).length===0);
  assert.equal(await width('tokens'),136);assert.equal(await width('cwd'),cwdWidth);
  await page.locator('[data-resize="status"]').focus();await page.keyboard.press('Shift+F10');
  await page.getByRole('dialog',{name:'列设置'}).waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-resize="status"]').evaluate(el=>el===document.activeElement),true);
  console.log(
    JSON.stringify({
      search: true,
      switchAction: true,
      keyboard: true,
      stableRows: true,
      scrollAndFocusPreserved: true,
      noBackgroundFocusSteal: true,
      compactLayout: true,
      workingDirectory: true,
      readableWorkspaceRoot: true,
      nestedDirectorySearch: true,
      recordedStats: true,
      inlineTokenBreakdown: true,
      compactTokenColumn136px: true,
      largeTokensFit: true,
      exactTokenTooltip: true,
      sessionRoundsColumn: true,
      missingValuesNotZero: true,
      noFakeLiveState: true,
      distinctRecordStates: true,
      runtimeStates: true,
      runningOnlySpinner: true,
      liveOptInAction: true,
      reviewFilter: true,
      explicitRoundReview: true,
      patchActionIsolated: true,
      readableStatusAndPrimaryAction: true,
      highContrast: true,
      narrowToolbar: true,
      resizeAndVisibility: true,
      savedLayoutRestored: true,
      layoutFailureRollback: true,
      keyboardColumnControls: true,
      horizontalScrollRestored: true,
      singleColumnReset: true,
    }),
  );
} finally {
  await browser.close();
}
