# 验证记录

日期：2026-09-22。版本：0.1.0。

## 环境

- macOS，本机 VS Code 1.138.0。
- 官方 Codex 扩展：26.5908.31748，darwin-arm64。
- 启动运行时：VS Code 内置 Node v24.18.1。

## 已通过

- TypeScript 类型检查。
- 5 项必要测试：TOML 数据还原、损坏配置与错误脱敏、官方扩展二进制升级定位、真实子进程标准流与退出信号、扩展命令切换/恢复流程。
- 真实后端检查通过 VS Code 内置运行时和生成的启动脚本完成 `initialize` 与 `config/read`。两份不同的本机 profile 均验证通过：有效 provider、模型和推理强度与各自配置一致。私人 provider 名称和模型配置不收录到公开仓库。

检查只读配置，未创建模型对话、调用模型或改写当前 VS Code 用户设置。测试结束后停止测试后端并移除临时启动文件。

## 验收边界

扩展命令测试使用 VS Code API 替身；没有通过桌面自动化点击状态栏、菜单或重载窗口。VSIX 安装后的原生 UI 仍需在用户的 VS Code 中体验确认。Linux、Windows 和远程环境均未实机验证；首版仅提供本机 macOS / Linux 支持。

当前实现依赖官方开发用途设置 `chatgpt.cliExecutable`。CLI 参数覆盖和原生 profile 的层级不同，详见 README。
