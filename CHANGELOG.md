# Changelog

## 0.1.0

Initial public preview.

- Discover Codex profiles from `CODEX_HOME` or a configured directory.
- Switch profiles from a native VS Code status bar and quick pick.
- Show pending window reloads and offer a reload action.
- Open the selected profile or restore the bundled Codex launcher.
- Preserve user config files and back up the previous executable setting.
- Validate TOML before changing the executable setting.
- Support local macOS and Linux with a bundled Node bridge.

This preview uses the development-only `chatgpt.cliExecutable` setting. It is
independent of OpenAI and is not a native Codex profile selector. See the README
for configuration precedence, supported environments, and uninstall instructions.
