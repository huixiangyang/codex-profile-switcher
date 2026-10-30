# Codex Sessions & Profiles

[简体中文](README.md) · [Download](https://github.com/huixiangyang/codex-profile-switcher/releases) · [Issues](https://github.com/huixiangyang/codex-profile-switcher/issues)

A compact **Codex 会话** panel beside Terminal. Read existing local conversation records, inspect per-session token usage and turn timing, and click a row to switch the official Codex sidebar without changing your code layout.

## Use the session panel

1. Install the 0.9.3 VSIX. Navigation and live status target official `openai.chatgpt` **26.51021.22027**.
2. Finish active tasks before reloading after an upgrade. Live monitoring is off by default and requires explicit opt-in.
3. Open **Codex 会话**, or use `Cmd+Alt+K` on macOS / `Ctrl+Alt+K` on Linux. Reading records does not require a Profile selection or a custom launcher.
4. Search titles or working directories, click to switch chats, and hover over tokens or duration for statistics.

VS Code asks permission on the first URI navigation; you may select “Do not ask me again for this extension”. The extension does not alter URI trust settings.

The panel uses a compact native workbench style, inheriting VS Code colors and fonts with 44px rows. Grouped filters, subtle dividers and a selected-row rail improve scanning; search, hover and keyboard focus share consistent control boundaries. Waiting/failure states retain semantic colors and icons, while review emphasizes its explicit confirmation action. Narrow panels, high-contrast themes and reduced-motion preferences remain supported.

### Adjust the columns

- **Resize** by dragging a header's right-edge divider. Double-click a divider to restore that column's default width. Resizing never switches conversations.
- **Choose columns** with the columns icon beside the conversation header, or by right-clicking any header. The conversation title stays visible. The Token column defaults to 136px and cannot be narrowed below that width.
- Changes apply immediately, without reloading, and are saved in this machine's current workspace state. Reopening restores the layout; other workspaces keep their own choices.
- The default layout hides auxiliary columns as the panel narrows. The first checkbox change starts from the currently visible columns and switches to explicit selection. **Selected columns stay visible even in narrow panels**, with horizontal scrolling when needed. Manually resized widths remain fixed, so a wider panel may leave spare space.
- **恢复默认布局** resets both widths and visibility, restoring responsive sizing. It does not change conversations or review decisions.

Keyboard users can Tab to a divider and use Left/Right to resize; Escape cancels an unfinished adjustment. See [the complete controls](docs/SESSIONS.md#调整列宽与显示).

### Favorites and tags (development preview)

Favorites, tags and CSV export below are not included in the `0.9.3` release package yet.

- Toggle the row's star to favorite a session. Favorites appear first in ordinary lists; **the attention list and Next Attention keep their existing priorities**. Favoriting neither opens a conversation nor marks it reviewed.
- Favorites-only and tag filters combine with the existing status filter and search; search also matches tags. The row's tag button opens a native VS Code picker to add/remove existing tags or create a new one. Tags are trimmed and Unicode NFC-normalized, with up to 32 characters per tag and 10 tags per session.
- Clear Filters resets status, search, favorites-only and tags together. Changing sources resets only the source-specific favorite/tag filters, preserving status and search. If unfavoriting or removing a tag hides the focused row, keyboard focus moves to the same action on a neighboring row, or to search when the list becomes empty; this does not switch sessions or change the review target.
- Metadata stays in this extension's local workspace state, keyed by Codex data source and session ID. **Codex records and project files are not modified.** Cross-workspace or multi-window synchronization is not provided. Failed saves keep the last successful values; stale actions cannot affect a newly selected source.

### Export CSV (development preview)

Use the toolbar's CSV export button to export **the current filtered results**, not every workspace or all historical records. The host validates the sessions and captures a fixed snapshot before showing field selection and the save dialog. Background refreshes do not change that export. Canceling writes nothing; changing the workspace or data source cancels the old export.

A successful save confirms the filename; deliberate cancellation stays quiet. A changed source explains why no export was saved, and a write failure reports the error and allows another export. Selected titles/tags are not automatically redacted; inspect their content before sharing.

- Default columns contain row numbers, states, timestamps, favorite flags, latest cumulative session tokens, recorded turn counts/durations, and inherited/incomplete flags. Unknown values are blank; recorded zero remains `0`.
- Session ID, title, tags, model and provider are individually opt-in fields and may identify sensitive work. Review the selected fields and exported file before sharing: titles or custom tags can themselves contain copied paths or private text. **Conversation bodies, patches and working directories are not export fields.**
- Usage is each session's latest cumulative snapshot, not consumption within a date range or a cost estimate. Forks remain separate rows with an inheritance flag. There is no aggregate-total row that could count inherited history as new consumption.
- CSV uses standard quote escaping and CRLF line endings. Formula-like text receives a leading apostrophe so it is exported as text.

### Analyze sessions in an editor tab

Click the chart button in the bottom panel, or run **Codex 会话: 打开会话分析**, to open **会话分析** in the active editor group. Reopening reuses the same tab.

Analysis starts directly with controls and data, without a large heading/subtitle block. A compact metric strip separates labels from values; the overview puts sessions beside charts, and detail aligns usage, turn timing and the selected turn above the record table. Light section boundaries and right-aligned numbers aid comparison. Narrow editors stack sections and keep horizontal scrolling inside tables. Body text stays at 12–13px.

- The overview compares current-workspace tokens, weighted cache-hit rate, turns and recorded execution time. Search, filter by working directory, or sort the session table.
- Click a session title, or its bottom-panel chart button, for usage composition, duration median/P95 and per-turn records.
- Select a duration bar or turn number to see its outcome, timing and recorded file operations. Review that turn in the existing bottom panel, or open the conversation in the official sidebar.

Analysis shares the existing read-only record source and automatic refresh. Missing values stay unknown; inherited sessions remain inspectable but are excluded from cross-session totals. See [analysis definitions](docs/ANALYTICS.md).

### Attention and per-turn review

- Filter all, active, attention-needed or review-pending conversations. Counts are per conversation; categories can overlap. Compact panels use a select control.
- **下一条待处理** opens the longest-observed wait first, then unseen new failures, in the official sidebar. Approvals and answers remain there.
- The row review icon opens a specific finished turn. Opening a chat does not mark it reviewed. Confirm or undo review explicitly; later turns remain independent.
- File previews are read-only virtual diff documents containing the selected turn's recorded operations, not the workspace Git diff. Opening the current file is a separate, workspace-scoped action.
- Initial history becomes a baseline rather than a flood of notifications. New turns do not replace the turn being inspected; changed evidence requires review again.

Decisions are stored in VS Code's local workspace state. Verified JSONL file-change records recover patches on demand, without creating a new permanent code archive. Missing or oversized evidence is explicit. Record-only mode still supports recorded outcomes and review; active waits require monitoring.

### Per-session statistics

- The Token column has a default and minimum width of 136px. It keeps input, output, cached input and total visible in two compact rows, labeled 入 / 出 / 缓 / 总. Values use three-significant-digit K/M/B/T formatting without unnecessary trailing decimals; the font stays at 12px. Hover retains exact numbers, cache writes and reasoning output. Values come from the latest cumulative snapshot; cached input is not added to the total again.
- A separate session-turn column counts distinct recorded turn IDs, including completed, failed, interrupted and unclosed turns—not message count. Incomplete history shows `—`; hover explains the result breakdown or missing count.
- The latest-turn duration uses recorded milliseconds. Details include recorded turn counts, completed/failed/interrupted outcomes, recorded execution time and the number of turns with duration data.
- Missing values are `—`, not zero. Fork inheritance, incomplete records and rollback markers are called out. Context occupancy percentages are not shown.

### Optional live status

Click **本地记录** in the panel header, confirm **启用实时监听**, then reload this window after active work finishes. The command **Codex 会话: 配置实时状态监听（当前窗口）** provides the same action.

Running sessions spin only when the backend explicitly reports an active state without waiting flags. Approval and user-input waits use static icons; decisions remain in the official Codex panel. Idle and system errors also come from backend events. Disconnecting removes live overrides and stops spinners; reload after active work finishes to restore monitoring.

The selection is saved per workspace and does not enable other windows. Observed sessions show 运行中, 待批准, 待回复, 待处理, 空闲 or 异常. Without live status, the row shows the previous turn's 已完成, 失败 or 已停止; unavailable results use `—`. Hover identifies the source. Per-turn analysis applies live running/waiting status only when the observed active turn ID matches, never to older turns. First-time activation confirms takeover of the shared startup entry point, including replacement of an existing custom executable. It never restarts active work automatically. Disable from the same header action, then reload after tasks finish to remove the forwarding layer. Token usage and turn statistics remain file-based.

Historical counting completeness is separate from the latest outcome: a later explicit terminal event restores its result and recorded duration even when full-history counts remain unavailable.

Working directories retain complete relative paths (a directory-name label such as `yhx（根目录）` for a single workspace root), or full paths for multi-root workspaces. Hover shows the original cwd. The model column reports the latest recorded configuration.

### Data sources and transport

Titles and historical statistics read only `$CODEX_HOME/session_index.jsonl` and `sessions/**/*.jsonl`, never SQLite or credential files. Initial indexing streams files; later updates read appended records. File changes trigger refresh, with a 15-second rescan and an immediate read when the panel becomes visible. `codexProfiles.codexHome` selects the directory, defaulting to `CODEX_HOME` or `~/.codex`.

With live monitoring off, the Profile launcher inherits stdio. With explicit opt-in, it forwards the original bytes with backpressure and observes status, turn lifecycle and bounded file patches in an isolated Worker. It does not inject requests, rewrite messages, answer approvals, retain conversation logs or start another Codex backend. Parser or panel failure does not block forwarding; a failure of the forwarding process itself can still interrupt the official connection.

Refreshes reuse rows, preserve scroll position and do not reclaim focus from the editor or official sidebar. Source changes invalidate old reads and errors. Window-specific Profile selection remains independent.

See [session panel and statistics](docs/SESSIONS.md).

An independent, MIT-licensed community project, not affiliated with OpenAI. This preview uses a development-only setting in the official extension.

## Features

- Discover `$CODEX_HOME/*.config.toml`, defaulting to `~/.codex`.
- Show the selected profile and pending reloads in the status bar.
- Keep different projects on different profiles; resetting one window leaves others unchanged.
- Search profiles by name, provider, or model using a native quick pick.
- Open the selected config, reload the window, or restore the default launcher.
- Use VS Code's built-in runtime; no separate Node.js or Python installation is needed by users.

The session panel uses a compact theme-aware table with Lucide icons, alongside native VS Code controls. Its current UI language is Chinese.

## Install / use Profiles

1. Install the official [`openai.chatgpt`](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt) extension.
2. Download a `.vsix` from [GitHub Releases](https://github.com/huixiangyang/codex-profile-switcher/releases).
3. Run **Extensions: Install from VSIX…** from the Command Palette.
4. Click **Codex: …** in the status bar, select a profile, choose **重新加载窗口** (Reload Window), and start a new Codex conversation.

Alternatively:

```sh
code --install-extension codex-profile-switcher-0.9.3.vsix
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

Profile names may contain letters, numbers, hyphens, and underscores. Invalid TOML prevents switching. Installing the extension does not take over an existing custom launcher; it is replaced only after you select a profile or explicitly confirm live monitoring.

## Commands and settings

| Command | Purpose |
| --- | --- |
| `Codex Profiles: 切换 Profile` | Select a profile or the default configuration |
| `Codex Profiles: 打开当前配置文件` | Open the selected profile, or `config.toml` in default mode |
| `Codex Profiles: 刷新 Profiles` | Check the config directory and refresh the status bar |
| `Codex Profiles: 当前窗口恢复默认 Profile` | Use `config.toml` in this window without changing other windows |
| `Codex Profiles: 停用切换器（所有窗口）` | Confirm removal of the shared launcher before uninstalling; affects all windows |
| `Codex Profiles: 修复 Codex 已知问题（所有窗口）` | Back up and repair two known defects in a verified Codex build |
| `Codex Profiles: 还原 Codex 官方文件（所有窗口）` | Verify backups and restore the original Codex files |

`codexProfiles.codexHome` selects an absolute or `~/` config directory. Leave it empty to use `CODEX_HOME` or `~/.codex`. `codexProfiles.showStatusBar` controls status bar visibility and defaults to `true`. Both settings support workspace overrides. Profile choices are saved in VS Code's local workspace state, without writing project files.

Profiles are rescanned whenever the picker opens. Reload after editing a profile. Select a profile again after changing the config directory. Switching or resetting affects only the current window; reload only that window. Existing conversations may retain their original provider. Use one window per project; multiple windows for the same workspace do not have separate persisted choices. Open a folder or workspace before selecting a profile in an empty window.

## Optional Codex repair

Version 0.3.0 adds explicit repair and restore commands. Installation, activation, and profile changes never apply repairs automatically. Finish active tasks, run the repair command, then reload every window using the same Codex installation. The command edits two official extension files, so its scope is all those windows.

Only `openai.chatgpt 26.5928.31416` with both verified full-file SHA-256 hashes is accepted. Unknown versions or modified files are rejected. The repair:

- Returns valid JSON when releasing a queued-message send lock, preventing `JSON.parse(undefined)`.
- Prevents background execution from acquiring threads for messages loaded from another window's shared queue. The current owner can drain its queue; a newly accepted local head message can still acquire ownership under the upstream rules. Explicit send and send-now paths retain their existing checks.

After reload, an unowned historical queue remains pending until the conversation is opened and owned, or the user explicitly sends it. Messages are not deleted, ownership locks are not forcibly cleared, and backends are not stopped.

Original files and hashes are retained under `codex-repairs/` in the switcher's global storage. All preflight checks and backups precede writes; ordinary failures roll back, and interrupted mixed states can be repaired or restored again. A loopback TCP listener provides cross-window mutual exclusion without transmitting data. An occupied port prevents the operation. External changes to targets or backups are never overwritten.

To undo, run the restore command and reload the affected windows. Disabling or uninstalling the switcher does not restore official files: restore first, or reinstall Codex. Codex upgrades are not patched automatically; each new build needs verification.

This addresses the identified response and queue defects, not the Electron native renderer crash. Branch behavior and real extension-file copies have been checked, including syntax and byte-for-byte restoration. Real VS Code multi-window interaction, model sends, and long-term stability remain unverified. See [verification details](VERIFICATION.md).

## Compatibility

- Local macOS and Linux, arm64 / x64, VS Code 1.95.0 or later.
- Actual Codex configuration loading has been verified on macOS arm64 with official extension `26.5908.31748`.
- CI is configured to run the automated suite on macOS and Linux. A real Linux Codex extension host has not been validated.
- Windows, WSL, Remote SSH, Dev Containers, and VS Code for the web are not supported.
- Profile unit tests use an API stub; session-panel verification also has an isolated real VS Code host script. See [verification details](VERIFICATION.md).

## How it works

The tested official extension has no profile picker, its `app-server` rejects `--profile`, and `chatgpt.cliExecutable` has application scope. This extension sets that setting to one shared launcher on takeover. The launcher connects to its parent extension host's Unix socket to obtain that window's selection, translates the profile into `-c key=value` arguments, and runs the official extension's bundled Codex binary. Default mode adds no profile arguments. Regular switching and resetting do not rewrite the global setting.

- User config files and credentials are not edited. Only explicit repair/restore commands edit verified official extension files.
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

If you applied a Codex repair, restore official files first. Before uninstalling or disabling, run **Codex Profiles: 停用切换器（所有窗口）**, then reload all affected windows. Resetting only the current window's profile keeps the shared launcher installed. If already uninstalled, remove `chatgpt.cliExecutable` from user settings and reload; reinstall Codex to restore its files. Disconnecting does not reinstate an earlier third-party launcher; its original path is saved in `previous-startup.json`.

## Development

```sh
npm ci
npm run check
npm test
npm run package
```

Development requires Node.js 22. Tests do not require personal Codex accounts or profiles. Favorites/tags and CSV tests cover persistence, composable filters, failure recovery, export fields and cancellation. API stubs and synthetic browser fixtures do not establish real VS Code extension-host acceptance. VSIX packages are written to `artifacts/`. See [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), and [license](LICENSE).

With the official extension installed, run `node scripts/smoke.mjs` to initialize a temporary state directory with one backend, then verify two independent host processes against real Codex backends. It checks each provider, model, and reasoning effort, then resets one host to defaults and verifies the other remains unchanged. No personal profile, model request, or VS Code settings change is required.

To validate the repair against an unmodified installed extension, run `node scripts/verify-repair.mjs /absolute/path/to/openai.chatgpt-26.5928.31416-darwin-arm64`. It copies only the two listed files into a temporary directory, applies the repair, checks syntax and idempotency, and restores the original bytes. It never modifies the installed extension or opens VS Code.
