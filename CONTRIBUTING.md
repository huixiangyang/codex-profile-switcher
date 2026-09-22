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

- 保持原生 VS Code 控件、键盘操作和主题一致性。
- 不改写用户级 Codex 配置和凭据，不修改官方扩展。
- 功能变更同步中英文 README 与 CHANGELOG。
- 为行为或失败恢复添加必要测试，不测试固定文案或 CSS。
- 涉及官方扩展启动协议时，记录实际验证过的版本和范围。

## 发布到 GitHub Releases

1. 更新 `package.json` 与锁文件的版本，维护 CHANGELOG。
2. 完成检查和 VSIX 打包，将源代码提交到 `main`，等待 CI 通过。
3. 在通过验证的提交上创建版本标签，例如 `v0.1.0`。
4. 创建 GitHub Release，附上 `artifacts/*.vsix`、SHA-256 校验文件，以及使用说明和验收边界。

当前发行渠道是 GitHub Releases；此流程不发布到 VS Code Marketplace。
