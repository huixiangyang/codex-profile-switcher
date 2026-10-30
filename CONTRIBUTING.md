# Contributing

欢迎提交中文或英文 Issue / Pull Request。

## 本地开发

使用 Node.js 22（见 `.nvmrc`）与 npm：

```sh
npm ci
npm run check
npm test
npm run package
```

`npm test` 会先构建运行文件，不依赖本机 Codex 账号或 profile。CI 在 macOS 与 Linux 上运行同样的检查，产出 VSIX 构建包。VS Code API 测试使用替身，不能替代扩展宿主中的交互验收。

真实后端检查需要本机安装官方 Codex 扩展；脚本生成临时配置，不需要个人 profile：

```sh
node scripts/smoke.mjs
```

默认查找标准 VS Code 安装目录。自定义安装位置可通过 `CODEX_SWITCHER_SMOKE_NODE` 指定启动运行时。脚本并行启动两个独立宿主，核对配置隔离，再验证单个宿主恢复默认。该脚本不发送模型请求；请不要把私人配置或测试生成的日志提交到仓库。

## 修改约定

- 保持 VS Code 控件、键盘操作和主题一致性；会话面板 Webview 使用 Lucide 图标及 VS Code 设计变量。
- 不改写用户级 Codex 配置和凭据。只有显式修复／还原命令可修改官方扩展，且必须固定版本、完整文件哈希、预检、可信备份、幂等与失败回滚；不得自动适配未知版本。
- 功能变更同步中英文 README 与 CHANGELOG。
- 为行为或失败恢复添加必要测试，不测试固定文案或 CSS。
- 涉及官方扩展启动协议时，记录实际验证过的版本和范围。
- 修复官方文件时，用 `node scripts/verify-repair.mjs <官方扩展目录>` 验证临时副本；不把副本检查当作真实 UI 或模型端到端验收。

## 发布到 GitHub Releases

1. 更新 `package.json` 与锁文件的版本，维护 CHANGELOG。
2. 完成检查和 VSIX 打包，将源代码提交到 `main`，等待 CI 通过。
3. 在通过验证的提交上创建版本标签，例如 `v0.1.0`。
4. 创建 GitHub Release，附上 `artifacts/*.vsix`、SHA-256 校验文件，以及使用说明和验收边界。

当前发行渠道是 GitHub Releases；此流程不发布到 VS Code Marketplace。

## 会话面板验收

- `node scripts/verify-sessions-ui.mjs`：实际 Webview 代码加夹具数据，检查同列 Token 明细、会话轮次、缺失数值、搜索、点击、键盘操作、紧凑布局及明暗／高对比主题，并验证增量渲染的节点复用、重排、滚动及后台焦点。列布局检查涵盖拖动／键盘调整、显示选择、重建恢复、保存期间旧快照、保存失败回滚和审阅返回后的横向滚动；保存回执使用宿主消息夹具。自动查找本机 Chrome／Chromium，也可通过 `CHROME_PATH` 指定路径或安装 Playwright Chromium；截图位于 `artifacts/sessions-ui/`。
- `node scripts/verify-sessions.mjs`：macOS 隔离 VS Code 用户目录、CODEX_HOME 和三项目八会话，模型端点仅使用本地固定响应服务。不配置 `chatgpt.cliExecutable`，验证只读记录统计、底部面板、官方侧栏实际切换、切回，以及不新增编辑器标签、不改变代码选区及后台刷新后编辑器仍然激活。脚本只关闭自己的测试宿主，证据目录由 `VERIFY_ROOT` 输出。
- 导航适配集中在 `src/sessions/navigation.ts`，核对新官方版本的 URI 路由后再更新 `supportedCodexVersion`；读取器独立核对落盘字段与单位。不修改官方安装文件，不为未知版本添加猜测性兼容。
- `node scripts/verify-navigation.mjs`：读取已安装官方扩展的实际 URI handler、侧栏选择器与导航方法，在隔离 VM 中检查 A → B → A、当前版本侧栏目标及未加载侧栏的排队交付，并核对前端路由入口。它不启动 VS Code；不能代替原生窗口中的点击验收。更新适配版本时同步维护实时和补丁验证脚本的目标版本。

## 收藏、标签与 CSV 验收

- `test/organization.test.ts`：使用合成会话与存储替身，检查按数据源／会话隔离、重建恢复、连续写入、失败后继续保存、标签校验，以及收藏／标签／状态／搜索的组合筛选。收藏排序不得改变待处理队列或审阅规则。
- `test/export.test.ts`：检查固定快照、默认隐私字段、显式字段选择、CSV 引号／换行／公式文本转义、未知与零、分叉标记，以及取消和数据源变化后不写文件。不得增加正文、补丁或目录字段；注意显式勾选的标题和标签本身仍可能含敏感文字或路径。不得把最新累计值描述为期间消耗或费用。
- `test/table.test.ts`：使用最小 DOM 替身检查收藏重排、筛选移除当前行／最后一行时的焦点恢复、标签可访问名称和后台不抢焦点。`test/organization-controller.test.ts` 检查 CSV 取消／写入失败后的重试与忙碌状态恢复。这些替身不验证真实浏览器焦点或原生保存对话框。
- 原生宿主验收应覆盖星标和标签的鼠标／键盘操作、反复点击、取消标签输入、保存失败、切换数据源、筛选后导出、字段选择和保存对话框取消。确认这些操作不触发会话切换、不修改官方记录、不抢占审阅目标。
- 仅使用合成夹具或明确隔离的测试目录；不要为验收读取个人会话或凭据。API 替身和浏览器夹具不能证明原生对话框、真实扩展宿主或操作系统保存流程已经通过。记录实际运行结果及受环境限制而未执行的步骤。

## 分析页验收

- `npm run build && node scripts/verify-analytics-ui.mjs`：使用实际 Webview 代码与合成宿主消息，自动检查明暗／高对比主题、宽窄布局、筛选统计、排序、键盘联动、分页、连续刷新以及空／缺失／零值／分叉记录；需要 Chrome／Chromium（可用 `CHROME_PATH` 指定）。截图位于 `artifacts/analytics-ui/`，不代表真实 VS Code 扩展宿主已验收。

- `npm run build && node scripts/preview-analytics.mjs` 生成 `artifacts/analytics-ui/`，包含实际 HTML / JS / CSS 和合成宿主消息。通过本地静态服务器查看 `light.html`、`dark.html`、`contrast.html`；`bottom-frame.html` 检查窄面板入口。
- `?scenario=empty`、`fork`、`missing`、`zero`、`long`、`append` 分别提供空数据、分叉、会话移除、零用量、长历史和刷新追加场景。验证搜索／目录筛选的统计一致性、图表与明细联动、分页、保留选中回合和审阅目标。
- `test/analytics.test.ts` 覆盖累计口径、未知／零、加权缓存比例、编辑器组内单标签复用、工作区切换和只发送所选会话摘要。VS Code API 替身不代表真实编辑器宿主已验收。

## 实时监听验收

- `node scripts/verify-live.mjs`：隔离真实官方后端与本地固定响应服务，触发运行、命令批准和 Plan 模式用户输入；脚本作为测试客户端明确拒绝批准并回答测试问题，验证状态回到空闲。生产转发器不代答、不注入查询。
- `node scripts/verify-sessions.mjs --live`：在隔离 VS Code 内确认启用、重载，核对实际 Worker 启动、官方侧栏发送后的运行状态、结束后空闲和无按钮的自动刷新。默认无参数版本继续验证未配置启动器的本地记录模式。
- `npm test` 中的透明转发测试逐字节比较双方原始数据，覆盖大输出、批准消息、旁路断开和退出信号；不要只用协议 mock 宣称真实后端已通过。
- 实时适配必须依据目标版本生成的 `ThreadStatus` / `ThreadActiveFlag`，未知等待标记清除观测；不要按工具名猜测输入是否阻塞，也不要增加代答批准或查询注入。

## 队列与审阅验收

- `node scripts/verify-review.mjs`：固定响应驱动真实后端在临时目录新增、修改、删除文件，验证实时与 JSONL 补丁的证据身份一致及只读恢复。
- `node scripts/verify-sessions-ui.mjs`：增加筛选、按轮确认、独立补丁动作、宽窄审阅视图和稳定行顺序的交互验证。
- `node scripts/verify-sessions.mjs` 及 `--live`：在已建立基线后追加多个结果，检查真实只读预览不混轮、审阅旧轮时新结果不抢占，以及下一条待处理切换官方侧栏。
- `node scripts/verify-host-exit.mjs`：默认不加载切换器、Codex 或 CDP；`--cdp`、`--codex`、`--switcher` 分别做控制变量退出对照。强制清理必须单独记录，不能当作正常退出通过。

文件级夹具来自已核验版本；新增类型必须先有原始证据。统一修改 `workflow.ts` 的状态规则，不在 Webview 另做一套审阅判断。
