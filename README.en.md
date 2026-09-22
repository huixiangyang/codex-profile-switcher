# Codex Profile Switcher

[简体中文](README.md) · [Download](https://github.com/huixiangyang/codex-profile-switcher/releases) · [Issues](https://github.com/huixiangyang/codex-profile-switcher/issues)

Switch the configuration profile used by the official Codex VS Code extension independently in each window. Select a profile, reload that window, and start a new Codex conversation. Choices are saved locally per workspace and restored when you reopen the project.

An independent, MIT-licensed community project, not affiliated with OpenAI. This preview uses a development-only setting in the official extension.

## Features

- Discover `$CODEX_HOME/*.config.toml`, defaulting to `~/.codex`.
- Show the selected profile and pending reloads in the status bar.
- Keep different projects on different profiles; resetting one window leaves others unchanged.
- Search profiles by name, provider, or model using a native quick pick.
- Open the selected config, reload the window, or restore the default launcher.
- Use VS Code's built-in runtime; no separate Node.js or Python installation is needed by users.

The extension uses native VS Code controls and themes. Its current UI language is Chinese.

## Install

1. Install the official [`openai.chatgpt`](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt) extension.
2. Download a `.vsix` from [GitHub Releases](https://github.com/huixiangyang/codex-profile-switcher/releases).
3. Run **Extensions: Install from VSIX…** from the Command Palette.
4. Click **Codex: …** in the status bar, select a profile, choose **重新加载窗口** (Reload Window), and start a new Codex conversation.

Alternatively:

```sh
code --install-extension codex-profile-switcher-0.2.0.vsix
```

Releases are distributed on GitHub. The extension is not published to VS Code Marketplace.

### Upgrading from 0.1.0

Version 0.2.0 replaces global per-profile launchers with one shared entry point and workspace selections. Select a profile again in each project window and reload. The previous global profile is not copied into all workspaces. Once the shared launcher is installed, windows without a saved selection use the default config on reload.

## Profiles

Create `~/.codex/review.config.toml`, for example:

```toml
# Inherit the provider and model from config.toml.
model_reasoning_effort = "high"
```

To select an existing provider, add `model_provider = "your-provider-id"`. Keep provider definitions and credentials in Codex's user config or credential store. An [example file](examples/review.config.toml.example) is included.

Profile names may contain letters, numbers, hyphens, and underscores. Invalid TOML prevents switching. Installing the extension does not take over an existing custom launcher; it is replaced only after you select a profile.

## Commands and settings

| Command | Purpose |
| --- | --- |
| `Codex Profiles: 切换 Profile` | Select a profile or the default configuration |
| `Codex Profiles: 打开当前配置文件` | Open the selected profile, or `config.toml` in default mode |
| `Codex Profiles: 刷新 Profiles` | Check the config directory and refresh the status bar |
| `Codex Profiles: 当前窗口恢复默认 Profile` | Use `config.toml` in this window without changing other windows |
| `Codex Profiles: 停用切换器（所有窗口）` | Confirm removal of the shared launcher before uninstalling; affects all windows |

`codexProfiles.codexHome` selects an absolute or `~/` config directory. Leave it empty to use `CODEX_HOME` or `~/.codex`. `codexProfiles.showStatusBar` controls status bar visibility and defaults to `true`. Both settings support workspace overrides. Profile choices are saved in VS Code's local workspace state, without writing project files.

Profiles are rescanned whenever the picker opens. Reload after editing a profile. Select a profile again after changing the config directory. Switching or resetting affects only the current window; reload only that window. Existing conversations may retain their original provider. Use one window per project; multiple windows for the same workspace do not have separate persisted choices. Open a folder or workspace before selecting a profile in an empty window.

## Compatibility

- Local macOS and Linux, arm64 / x64, VS Code 1.95.0 or later.
- Actual Codex configuration loading has been verified on macOS arm64 with official extension `26.5908.31748`.
- CI is configured to run the automated suite on macOS and Linux. A real Linux Codex extension host has not been validated.
- Windows, WSL, Remote SSH, Dev Containers, and VS Code for the web are not supported.
- Automated extension-command tests use an API stub, not a full interactive extension host. See [verification details](VERIFICATION.md).

## How it works

The tested official extension has no profile picker, its `app-server` rejects `--profile`, and `chatgpt.cliExecutable` has application scope. This extension sets that setting to one shared launcher on takeover. The launcher connects to its parent extension host's Unix socket to obtain that window's selection, translates the profile into `-c key=value` arguments, and runs the official extension's bundled Codex binary. Default mode adds no profile arguments. Regular switching and resetting do not rewrite the global setting.

- User config files, credentials, and official extension files are not edited.
- Command-line overrides take precedence over project config. This differs from native CLI profile precedence.
- Profile values become local process arguments. Keep secrets out of profile files.
- The status bar shows the selected startup config, not API health or the provider of an existing conversation.
- The window service pins its selection for the current extension host lifetime; saving a different selection requires a window reload.
- The launcher waits up to 15 seconds for this window's switcher to activate. If unavailable, it fails explicitly instead of borrowing another window's config.
- The switcher and official Codex must share an extension host. Manually separating them through extension host affinity is unsupported.
- Windows share Codex state and credentials within the selected config directory. The tested official backend can fail SQLite initialization when multiple instances first use the same empty directory simultaneously. Initialize a fresh directory in one window before opening others.
- OpenAI marks `chatgpt.cliExecutable` as development-only. Official extension updates may require revalidation.

The shared launcher and `previous-startup.json` are stored in the extension's VS Code global storage directory. Window sockets live in a private `/tmp/codex-profiles-<storage-path-hash>/` directory and are removed on normal shutdown. The switcher adds no telemetry and does not log config contents or full argument lists. The official Codex backend retains its own logging and telemetry behavior.

References: [IDE settings](https://learn.chatgpt.com/docs/developer-settings?surface=ide), [Codex profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles).

## Uninstall or recover

Before uninstalling or disabling, run **Codex Profiles: 停用切换器（所有窗口）**, then reload all affected windows. Resetting only the current window's profile keeps the shared launcher installed. If already uninstalled, remove `chatgpt.cliExecutable` from user settings and reload. Disconnecting does not reinstate an earlier third-party launcher; its original path is saved in `previous-startup.json`.

## Development

```sh
npm ci
npm run check
npm test
npm run package
```

Development requires Node.js 22. Tests do not require personal Codex accounts or profiles. VSIX packages are written to `artifacts/`. See [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), and [license](LICENSE).

With the official extension installed, run `node scripts/smoke.mjs` to initialize a temporary state directory with one backend, then verify two independent host processes against real Codex backends. It checks each provider, model, and reasoning effort, then resets one host to defaults and verifies the other remains unchanged. No personal profile, model request, or VS Code settings change is required.
