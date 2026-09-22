# Security

Please use this repository's **Security → Report a vulnerability** entry to
report a security issue privately. Do not put credentials or personal config
files in public issues.

请通过仓库 **Security → Report a vulnerability** 私下报告安全问题。公开 Issue
中不要包含 API keys、`auth.json`、完整配置或未脱敏的进程参数。

The extension reads local profile files and starts the official Codex binary.
Profile values are passed as command-line arguments and may be visible to local
process inspection. Keep credentials in Codex's user-level provider configuration
or credential storage, not in profile files.

The switcher does not add telemetry. The official Codex extension and backend
retain their own behavior and policies.
