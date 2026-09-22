# Changelog

## 0.2.0

- Replace global profile switching with independent window selections persisted per workspace.
- Route a shared launcher to its parent extension host over a private local socket; wait for switcher activation before starting Codex.
- Keep the current host's selection fixed until reload and fail explicitly when its window service is unavailable.
- Reset only the current window to defaults. Add a separate confirmed disconnect command for uninstalling across all windows.
- Allow workspace overrides for the config directory and status bar visibility.
- Verify simultaneous hosts, workspace persistence, reloads, and default reset isolation. Real backend smoke checks now use temporary configs without personal profiles.

Breaking change: select a profile again in each project window after upgrading from 0.1.0. The old global selection is not migrated to every workspace. Use one window per project. See README for startup, uninstall, and extension-host limitations.

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
