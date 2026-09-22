# Codex Profile Switcher

[English](README.en.md) · [下载安装包](https://github.com/huixiangyang/codex-profile-switcher/releases) · [问题反馈](https://github.com/huixiangyang/codex-profile-switcher/issues)

为官方 Codex VS Code 扩展提供每个窗口独立的 profile 切换入口。点击状态栏的 **Codex: profile名称**，选择本机配置，随后使用通知中的 **重新加载窗口** 按钮生效。选择按工作区保存在本机，重新打开项目后恢复。

独立社区项目，采用 MIT 许可，与 OpenAI 无隶属关系。当前为预览版，通过官方扩展的开发用途设置实现切换。

当前版本用于本机 macOS / Linux（arm64、x64），要求 VS Code 1.95.0 或以上。不支持 Windows、WSL、Remote SSH、Dev Container 或浏览器版 VS Code。已在 macOS arm64 上验证后端启动；Linux 尚未做真实 Codex 宿主验收。当前界面文案为中文。

## 安装与使用

1. 安装官方 Codex 扩展 `openai.chatgpt`。
2. 从 [GitHub Releases](https://github.com/huixiangyang/codex-profile-switcher/releases) 下载 `.vsix`，在命令面板执行 **Extensions: Install from VSIX… / 扩展: 从 VSIX 安装…**，选择安装包。
3. 点击右下角状态栏 **Codex: …**，或执行 **Codex Profiles: 切换 Profile**。
4. 选择 profile，点击 **重新加载窗口**，再新建 Codex 对话。

扩展启动时不会主动改写现有 Codex 设置。已有自定义启动脚本会显示为“外部启动配置”，首次选择时才接管全局启动入口。此后每个窗口独立选择 profile，切换或恢复默认只需重载当前窗口，不改变其他窗口的选择或后端。新设置不会迁移正在运行的对话。

例如：项目 A 使用 `review`，项目 B 使用 `coding`；在 A 中选择默认配置，B 继续使用 `coding`。首次打开的项目使用默认配置。同一项目按一个窗口使用；不提供同一工作区多窗口的独立持久化选择。空窗口需要先打开文件夹或工作区。

也可通过命令行安装：

```sh
code --install-extension codex-profile-switcher-0.2.0.vsix
```

当前发行渠道为 GitHub Releases，尚未发布至 VS Code Marketplace。

### 从 0.1.0 升级

0.2.0 移除了按 profile 生成全局启动路径的实现。升级后在各项目窗口重新选择一次 profile 并重载；旧全局选择不会自动复制到所有工作区。启动脚本安装后，尚未选择的窗口重载时使用默认配置。

### Profile 文件

扫描 `$CODEX_HOME/*.config.toml`，默认目录为 `~/.codex`。也可以设置 `codexProfiles.codexHome` 指定绝对路径。

例如 `~/.codex/review.config.toml`：

```toml
# 继承 config.toml 中的 provider 和模型，只提高推理强度。
model_reasoning_effort = "high"
```

若要切换已配置的 provider，可加入 `model_provider = "your-provider-id"`。Provider 定义和凭据继续由用户级配置或凭据存储管理。名称只支持字母、数字、短横线和下划线。菜单只展示名称、provider 和模型；无效 TOML 会阻止切换，并提供打开文件入口。缺失的配置目录会显示空列表，不会新建或覆盖用户配置。可直接复制仓库中的 [示例](examples/review.config.toml.example)。

### 命令

| 命令 | 用途 |
| --- | --- |
| Codex Profiles: 切换 Profile | 列出默认配置和发现的 profiles |
| Codex Profiles: 打开当前配置文件 | 编辑所选 profile；默认模式打开 config.toml |
| Codex Profiles: 刷新 Profiles | 检查配置目录并刷新状态栏；切换菜单每次都会重新扫描 |
| Codex Profiles: 当前窗口恢复默认 Profile | 仅当前窗口使用 config.toml，保留其他窗口的选择 |
| Codex Profiles: 停用切换器（所有窗口） | 卸载前清除统一启动入口，确认后对所有窗口生效 |

修改 profile 内容后，需要重载窗口才能用于新启动的 Codex。更改配置目录后，需要重新选择 profile。

`codexProfiles.codexHome` 支持绝对路径或 `~/` 路径，留空时读取 `CODEX_HOME` 或 `~/.codex`。`codexProfiles.showStatusBar` 控制状态栏入口，默认开启。两项设置都支持工作区覆盖。所选 profile 保存在 VS Code 的本机工作区状态中，不写入项目文件。

## 实现与边界

官方 Codex 当前没有 profile 选择设置。已验证版本 `26.5908.31748` 的 `app-server` 还会拒绝 `--profile`，`chatgpt.cliExecutable` 仅支持 application 作用域。本扩展将该设置指向固定的统一启动脚本；脚本根据父进程连接所属窗口的本地 Unix socket，取得该窗口的选择，将 profile 转换成 `-c key=value`，然后启动官方扩展配套的 Codex 二进制。默认模式不添加 profile 参数。

- 不修改全局 `config.toml`、profile 原文件、登录凭据或官方扩展代码。
- 使用 VS Code 自身的 Node 运行时，无需另装 Node / Python。
- 参数和标准流直接转发，退出信号转交后端；不记录 profile 正文、完整启动参数或凭据。
- 命令行配置优先级高于项目配置，与 CLI 原生 profile 层级并不完全相同。
- Profile 值会成为本机进程启动参数。因此密钥应留在用户级 provider 配置或凭据存储中，不放进 profile 文件。
- 状态栏显示所选启动配置；“待重载”表示本窗口还未按新选择重载，不代表模型服务已经连通。旧对话可能保留原有 provider。
- 每次宿主启动固定当前选择；只保存新选择不会让本次宿主重启的后端提前切换。
- Codex 后端先启动时，启动器最多等待 15 秒让本窗口的切换器完成激活。找不到所属窗口时明确报错，不使用其他窗口的配置。
- 依赖切换器和官方 Codex 运行在同一扩展宿主。手工配置扩展宿主 affinity 将两者分离时不受支持。
- 各窗口共享所选配置目录中的 Codex 状态库与凭据。已验证官方版本在首次并行初始化同一全新目录时偶有 SQLite 初始化失败；全新目录应先在一个窗口启动成功，再打开其他窗口。
- 官方把 `chatgpt.cliExecutable` 标记为开发用途。后续 Codex 扩展更新可能改变接口，需要重新验证。

统一启动器和原启动路径备份 `previous-startup.json` 保存在该扩展的 VS Code 全局存储目录中。接管时只记录原路径，不复制凭据。窗口通信 socket 放在 `/tmp/codex-profiles-<存储路径哈希>/` 的私有目录中，正常退出时移除 socket。

**卸载或禁用前先执行“停用切换器（所有窗口）”，并重新加载所有相关窗口**，避免 Codex 仍指向本扩展的启动脚本。“当前窗口恢复默认 Profile”只改变当前选择，不会断开启动器。若已经卸载，可从 VS Code 用户设置中删除 `chatgpt.cliExecutable` 后重载。停用不会恢复接管前的第三方启动脚本；原路径可在 `previous-startup.json` 中查找。

官方资料：[IDE 设置](https://learn.chatgpt.com/docs/developer-settings?surface=ide)、[Profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles)。

## 开发

```sh
npm ci
npm run check
npm test
npm run package
```

对本机已安装的官方 Codex 扩展执行真实后端检查：

```sh
node scripts/smoke.mjs
```

该检查生成临时配置，先用单个后端初始化临时状态库，再使用 VS Code 内置运行时启动两个独立宿主及真实 Codex 后端，通过 `initialize` / `config/read` 核对各自 provider、模型和推理强度，再验证一个窗口恢复默认时另一个保持原配置。不读取个人 profile，不修改当前 VS Code 设置，也不发送模型请求。详细验收记录见 [VERIFICATION.md](VERIFICATION.md)。

VSIX 输出到 `artifacts/`。6 项测试覆盖 TOML 转换、损坏配置处理、升级后的二进制定位、真实子进程标准流和退出信号、并行窗口隔离，以及工作区切换/重载/恢复流程；测试不发送模型请求。

开发需要 Node.js 22（见 `.nvmrc`）；测试不依赖个人 Codex 账号或 profile。贡献与发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

扩展采用 VS Code 原生快速选择菜单、状态栏、通知与编辑器，继承明暗主题和键盘交互。扩展不添加遥测，官方 Codex 后端保留自身的日志与遥测行为。
