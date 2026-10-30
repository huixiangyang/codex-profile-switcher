# Profile 配置助手

配置助手生成可审阅的草稿；预览帮助理解一个 Profile 自带的覆盖项。它们不是账户管理器、配置迁移器或 Codex 完整配置验证器。

## 创建草稿

1. 在受信任的本机 macOS / Linux 工作区，执行 **Codex Profiles: 创建 Profile 草稿**；状态栏的切换菜单也有这个入口，即使尚无 Profile。
2. 输入名称。名称与扫描规则一致，长度为 1–64 位，只使用 ASCII 字母、数字、短横线、下划线；不填写 `.config.toml` 后缀或路径。向导拒绝已有名称（不区分大小写）、`config` / `auth` 等保留名称以及 Windows 设备名，避免误用。
3. 选择模板：**编码**默认 `model_reasoning_effort = "medium"`；**审阅**默认 `"high"`；**自定义**默认不设置此项。模板不是模型推荐，不更改批准策略或沙箱权限。
4. 可选择已有配置里的模型和 Provider 元数据，也可保持继承。助手不会请求模型服务、拉取模型列表，或让你在向导里输入密钥。缺少可用元数据时使用继承，再按需要手工编辑草稿。
5. 确认推理强度：继承、`low`、`medium` 或 `high`。其他 Codex 值需自行按所用模型／版本的支持范围编辑；助手不保证模型兼容性。
6. 审阅打开的**未保存 TOML 文档**。你决定是否以及保存到哪里；要让切换器发现它，请用 **另存为** 保存成配置目录中的 `<名称>.config.toml`。目录由 `codexProfiles.codexHome`、`CODEX_HOME` 或默认 `~/.codex` 决定。
7. 重新打开切换菜单，选择已保存的 Profile，再按现有流程重载本窗口。创建草稿不会自动选择它，也不会更改运行中的对话。

任何一步取消都不保存配置。助手不创建配置目录，不写入或覆盖 `config.toml`、已有 Profile 或认证文件。用户在编辑器中的显式保存是独立操作；保存前仍应检查位置与覆盖提示。

模型与 Provider 选项仅从 `config.toml` 和已发现 Profile 的元数据提取。只生成名称注释及所选模型、Provider、推理强度字段；不复制配置表、Provider 定义、URL、环境变量或凭据。敏感／不适合展示的元数据不提供为选项。请勿把密钥放进 Profile：Profile 值最终会成为本机进程参数。

## 预览覆盖项

执行 **Codex Profiles: 预览 Profile 覆盖项**，或从切换菜单进入，再选择默认配置或已有 Profile。预览是显式的只读动作，不保存选择，也不接管启动入口。普通切换不会新增必须确认的预览弹窗。

- 默认配置表示**不添加 Profile 覆盖项**，并不表示 Codex 没有配置。
- 仅允许展示模型、Provider、推理强度与少量已知枚举／布尔设置；嵌套表的值不展开，其他未知字段名和值不展示，只提示隐藏数量。
- 损坏的 TOML 或不支持转换的顶层键会阻止预览或切换；提示不回显解析器的原始配置行。
- 隐藏不是删除：合法但未展示的配置仍由原有 Profile 应用流程保留。预览不能证明这些字段安全或兼容。
- 不显示完整 TOML、原始 `-c` 参数、端点、凭据或完整运行时配置，也不查询 Codex 后端。

这是**所选文件自身的覆盖项摘要**，不是合并后的有效配置。它不会解析项目配置、环境变量、后端默认值、管理员策略或已有会话保留的设置；也不能预测远端模型服务最终采用什么值。应用仍需重载当前窗口，并建议新建对话。

## 命令 ID

| ID | 命令面板标题 | 行为 |
| --- | --- | --- |
| `codexProfiles.create` | Codex Profiles: 创建 Profile 草稿 | 原生向导，最后打开未保存的 TOML |
| `codexProfiles.preview` | Codex Profiles: 预览 Profile 覆盖项 | 选择文件后显示安全摘要，不切换 |
| `codexProfiles.switch` | Codex Profiles: 切换 Profile | 原有切换入口，另提供创建／预览操作 |
| `codexProfiles.open` | Codex Profiles: 打开当前配置文件 | 显式打开完整原文件供用户编辑，不是安全摘要 |

助手和预览要求工作区受信任，不绕过 VS Code Workspace Trust。平台支持范围与扩展一致：本机 macOS / Linux，不新增 Windows、WSL、SSH、容器或 Web 支持。它们不读认证或会话文件；会话面板原有读取行为不在本功能范围内。

## 人工验收

自动化测试使用合成配置与 VS Code API 替身，不能替代真实宿主交互。原生宿主中尚需检查：

- 空目录与已有 Profile 列表都能从命令面板／状态栏进入助手和预览。
- 仅用键盘完成三个模板；每一步按 Escape，再重开向导，确认没有文件或选择被保存。
- 无效、重复、大小写冲突与保留名称得到提示；Unicode 模型元数据正确显示并保持合法 TOML。
- 完成向导后文档未保存；关闭且不保存不产生文件。另存为后重新打开切换菜单可发现文件。
- 预览后关闭不切换；默认项、损坏文件、未知字段、嵌套敏感字段均不泄露原值。
- 向导期间改变配置目录或撤销信任，不继续使用过期来源；不受信任工作区不能绕过限制。
- 普通 Profile 切换与重载保持现有窗口隔离行为，不出现额外强制预览。

## English reference

Use `codexProfiles.create` (**创建 Profile 草稿**) to create an **unsaved** TOML draft. The switch picker exposes this action even when no profiles exist. Coding defaults to medium effort, review to high, and custom to inheritance; templates do not change sandbox or approval policy. Choose an existing model/provider metadata value or inherit, then choose low/medium/high effort or inherit. No model catalog or compatibility claim is provided.

Names use 1–64 ASCII letters, digits, hyphens or underscores, without a filename suffix. Existing names are rejected case-insensitively, along with reserved configuration/authentication basenames and Windows device names. Canceling any step writes nothing. The assistant does not create directories or save, overwrite, select or activate a Profile. Review the editor draft and explicitly **Save As** `<name>.config.toml` in the configured Codex home, then reopen the switch picker and follow the normal reload flow.

Candidates come only from safe metadata in existing `config.toml` and discovered profiles. The draft contains only its name comment and selected model/provider/effort fields—not provider definitions, endpoints, environment variables or credentials. Other supported Codex settings can be edited manually. Keep secrets out of profile files because their values become local process arguments.

Use `codexProfiles.preview` (**预览 Profile 覆盖项**) for an opt-in, read-only summary. Default means no additional Profile overrides, not an empty Codex configuration. Only allowlisted metadata and recognized enum/boolean values are shown; table values and unknown field names/values are hidden or counted. Hidden valid fields remain part of normal Profile application. Invalid TOML or unsupported top-level keys are rejected without exposing parser source lines.

The preview is not the runtime effective configuration: it does not merge project settings, environment variables, backend defaults, policies, or existing conversation state. It shows no full TOML, raw `-c` arguments or credentials, and does not query the backend. It does not change the selected Profile or launcher. Normal switching has no extra mandatory preview dialog. `codexProfiles.open` remains the separate, explicit action for opening the full source file.

Both features require trusted local workspaces and retain the extension's macOS/Linux-only support. They do not read authentication or session records. Synthetic tests do not establish real VS Code host acceptance: verify keyboard/cancel/reopen flows, unsaved editor and Save As behavior, empty lists, invalid names/TOML, sensitive-field hiding, trust/source changes and ordinary switching in an isolated host before treating those interactions as validated.
