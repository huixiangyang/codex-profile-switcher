# Codex Profile Switcher

[English](README.en.md) · [下载安装包](https://github.com/huixiangyang/codex-profile-switcher/releases) · [问题反馈](https://github.com/huixiangyang/codex-profile-switcher/issues)

为官方 Codex VS Code 扩展提供 profile 切换入口。点击状态栏的 **Codex: profile名称**，选择本机配置，随后使用通知中的 **重新加载窗口** 按钮生效。

独立社区项目，采用 MIT 许可，与 OpenAI 无隶属关系。首版为预览版，通过官方扩展的开发用途设置实现切换。

当前版本用于本机 macOS / Linux（arm64、x64），要求 VS Code 1.95.0 或以上。不支持 Windows、WSL、Remote SSH、Dev Container 或浏览器版 VS Code。已在 macOS arm64 上验证后端启动；Linux 尚未做真实 Codex 宿主验收。当前界面文案为中文。

## 安装与使用

1. 安装官方 Codex 扩展 `openai.chatgpt`。
2. 从 [GitHub Releases](https://github.com/huixiangyang/codex-profile-switcher/releases) 下载 `.vsix`，在命令面板执行 **Extensions: Install from VSIX… / 扩展: 从 VSIX 安装…**，选择安装包。
3. 点击右下角状态栏 **Codex: …**，或执行 **Codex Profiles: 切换 Profile**。
4. 选择 profile，点击 **重新加载窗口**，再新建 Codex 对话。

扩展启动时不会主动改写现有 Codex 设置。已有自定义启动脚本会显示为“外部启动配置”，选择 profile 后再接管。切换影响当前 VS Code 用户配置下的所有窗口；其他已打开窗口也需要重载，新设置不会迁移正在运行的对话。

也可通过命令行安装：

```sh
code --install-extension codex-profile-switcher-0.1.0.vsix
```

当前发行渠道为 GitHub Releases，尚未发布至 VS Code Marketplace。

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
| Codex Profiles: 恢复 Codex 默认启动 | 清除自定义启动路径，恢复官方扩展内置启动方式 |

修改 profile 内容后，需要重载窗口才能用于新启动的 Codex。更改配置目录后，需要重新选择 profile。

`codexProfiles.codexHome` 支持绝对路径或 `~/` 路径，留空时读取 `CODEX_HOME` 或 `~/.codex`。`codexProfiles.showStatusBar` 控制状态栏入口，默认开启。

## 实现与边界

官方 Codex 当前没有 profile 选择设置。已验证版本 `26.5908.31748` 的 `app-server` 还会拒绝 `--profile`。本扩展通过开发用途设置 `chatgpt.cliExecutable` 指向独立启动脚本，在启动时读取 profile，将配置转换成 `-c key=value`，然后启动官方扩展配套的 Codex 二进制。

- 不修改全局 `config.toml`、profile 原文件、登录凭据或官方扩展代码。
- 使用 VS Code 自身的 Node 运行时，无需另装 Node / Python。
- 参数和标准流直接转发，退出信号转交后端；不记录 profile 正文、完整启动参数或凭据。
- 命令行配置优先级高于项目配置，与 CLI 原生 profile 层级并不完全相同。
- Profile 值会成为本机进程启动参数。因此密钥应留在用户级 provider 配置或凭据存储中，不放进 profile 文件。
- 状态栏显示所选启动配置；“待重载”表示本窗口还未按新选择重载，不代表模型服务已经连通。旧对话可能保留原有 provider。
- 官方把 `chatgpt.cliExecutable` 标记为开发用途。后续 Codex 扩展更新可能改变接口，需要重新验证。

启动器和原启动路径备份 `previous-startup.json` 保存在该扩展的 VS Code 全局存储目录中。接管时只记录原路径，不复制凭据。

**卸载前先执行“恢复 Codex 默认启动”，并重新加载窗口**，避免 Codex 仍指向本扩展的启动脚本。若已经卸载，可从 VS Code 用户设置中删除 `chatgpt.cliExecutable` 后重载。恢复默认启动不会恢复接管前的第三方启动脚本；原路径可在 `previous-startup.json` 中查找。

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
node scripts/smoke.mjs review
```

该检查需要自己的有效 profile；它在临时目录生成启动脚本，通过 `initialize` / `config/read` 核对所选 provider、模型和推理强度，不修改当前 VS Code 设置，也不发送模型请求。详细验收记录见 [VERIFICATION.md](VERIFICATION.md)。

VSIX 输出到 `artifacts/`。测试集中覆盖 TOML 转换、损坏配置处理、升级后的二进制定位、真实子进程标准流和退出信号、切换/恢复流程；测试不发送模型请求。

开发需要 Node.js 22（见 `.nvmrc`）；测试不依赖个人 Codex 账号或 profile。贡献与发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

扩展采用 VS Code 原生快速选择菜单、状态栏、通知与编辑器，继承明暗主题和键盘交互。扩展不添加遥测，官方 Codex 后端保留自身的日志与遥测行为。
