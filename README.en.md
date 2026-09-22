# Codex Profile Switcher

[简体中文](README.md) · [Download](https://github.com/huixiangyang/codex-profile-switcher/releases) · [Issues](https://github.com/huixiangyang/codex-profile-switcher/issues)

Switch the configuration profile used by the official Codex VS Code extension from the status bar. Select a profile, reload the window, and start a new Codex conversation.

An independent, MIT-licensed community project, not affiliated with OpenAI. This initial preview uses a development-only setting in the official extension.

## Features

- Discover `$CODEX_HOME/*.config.toml`, defaulting to `~/.codex`.
- Show the selected profile and pending reloads in the status bar.
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
code --install-extension codex-profile-switcher-0.1.0.vsix
```

Releases are distributed on GitHub. The extension is not published to VS Code Marketplace.

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
| `Codex Profiles: 恢复 Codex 默认启动` | Remove the custom executable setting and restore the bundled launcher |

`codexProfiles.codexHome` selects an absolute or `~/` config directory. Leave it empty to use `CODEX_HOME` or `~/.codex`. `codexProfiles.showStatusBar` controls status bar visibility and defaults to `true`.

Profiles are rescanned whenever the picker opens. Reload after editing a profile. Select a profile again after changing the config directory. Selection applies to windows sharing the same VS Code user settings; each open window must reload. Existing conversations may retain their original provider.

## Compatibility

- Local macOS and Linux, arm64 / x64, VS Code 1.95.0 or later.
- Actual Codex configuration loading has been verified on macOS arm64 with official extension `26.5908.31748`.
- CI is configured to run the automated suite on macOS and Linux. A real Linux Codex extension host has not been validated.
- Windows, WSL, Remote SSH, Dev Containers, and VS Code for the web are not supported.
- Automated extension-command tests use an API stub, not a full interactive extension host. See [verification details](VERIFICATION.md).

## How it works

The tested official extension has no profile picker, and its `app-server` rejects `--profile`. This extension sets `chatgpt.cliExecutable` to a generated launcher. At startup, the launcher reads the chosen profile, translates it into `-c key=value` arguments, and runs the official extension's bundled Codex binary.

- User config files, credentials, and official extension files are not edited.
- Command-line overrides take precedence over project config. This differs from native CLI profile precedence.
- Profile values become local process arguments. Keep secrets out of profile files.
- The status bar shows the selected startup config, not API health or the provider of an existing conversation.
- OpenAI marks `chatgpt.cliExecutable` as development-only. Official extension updates may require revalidation.

Launchers and `previous-startup.json` are stored in the extension's VS Code global storage directory. The switcher adds no telemetry and does not log config contents or full argument lists. The official Codex backend retains its own logging and telemetry behavior.

References: [IDE settings](https://learn.chatgpt.com/docs/developer-settings?surface=ide), [Codex profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles).

## Uninstall or recover

Before uninstalling, run **Codex Profiles: 恢复 Codex 默认启动**, then reload VS Code. If already uninstalled, remove `chatgpt.cliExecutable` from user settings and reload. Restoring defaults does not reinstate an earlier third-party launcher; its original path is saved in `previous-startup.json`.

## Development

```sh
npm ci
npm run check
npm test
npm run package
```

Development requires Node.js 22. Tests do not require personal Codex accounts or profiles. VSIX packages are written to `artifacts/`. See [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), and [license](LICENSE).
