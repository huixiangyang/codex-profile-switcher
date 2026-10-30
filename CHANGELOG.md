# Changelog

## Unreleased — Session organization and CSV (preview)

- Add per-session favorites and lightweight custom tags, stored only in the extension's workspace metadata and isolated by Codex source/session ID. Serialize writes, preserve saved values on failure and reject stale source actions; leave official records untouched.
- Combine favorites-only and tag filters with existing status/search controls. Keep favorites first in ordinary lists without changing attention priority, next-attention navigation or per-turn review semantics.
- Export the current filtered sessions from a host-validated fixed snapshot through native field selection and a save dialog. Keep identifying fields opt-in; omit conversation bodies, patches and working-directory fields. Cancellation writes nothing.
- Preserve unknown versus zero, flag inherited/incomplete records and label usage as latest session totals rather than period consumption or cost. Escape CSV and neutralize formula-like text; do not add a cross-session total row.
- Add focused persistence/filter/export coverage. Unit and synthetic-browser checks do not replace native VS Code interaction acceptance; this feature preview has not completed real extension-host acceptance.

## Unreleased — UI polish (preview)

- Refine the bottom session panel with grouped filters, consistent input/action sizing, subtle row separators and a selected-row rail. Keep 44px rows, the 136px minimum Token column, saved layouts and all existing actions.
- Clarify the analysis metric strip, numeric alignment, table sections and turn inspector while preserving the table-first layout and compact typography. Stack sections for narrow editors and contain table scrolling.
- Improve focus, high-contrast and reduced-motion styling without changing records, statistics, navigation, profiles or live monitoring.
- Add portable Chrome/Chromium discovery and a synthetic analytics browser verification script. This preview has not completed browser rendering or real VS Code extension-host acceptance; the restricted build environment could not launch Chromium.

## 0.9.3

- Adapt navigation and live monitoring to official Codex `26.51021.22027`. Keep the existing window-bound `/local/<threadId>` sidebar route.
- Include the installed and supported versions in mismatch notices, including the analysis page, instead of the generic adaptation warning.
- Verify the installed extension's actual URI/sidebar methods in an isolated VM, and revalidate running/approval/input events, current-turn association and recorded patches against its bundled backend with local fixed responses.
- Add one focused navigation regression for the current version, window binding and unsupported-version rejection. Do not modify or reload the installed official extension.

## 0.9.2

- Use one status vocabulary across the session panel, analysis and review: running, approval/reply waits, completed, failed and stopped. Show a neutral dash for unavailable state instead of exposing log-parser labels.
- Associate live per-turn status with an explicit turn-start ID. Do not apply a session's running state to old turns or patch-only records; clear the association on completion, inactivity, observation reset or disconnection.
- Keep historical results and statistics file-based. Outcome summaries list recorded terminal results; unfinished or missing results are not treated as execution states.
- Replace internal review-baseline wording with “未审阅” and shorten review messages. Preserve review decisions, reminders, dense layout and all existing actions.

## 0.9.1

- Remove heading/subtitle page blocks from analysis. Keep the session title, directory, model and state in one compact toolbar.
- Put the overview's session table first with charts alongside it. Align per-session usage, duration chart and turn inspector in one row on wide editors, with the record table immediately below.
- Use a compact six-value summary strip, tighter rows and spacing while retaining 12–13px body text. Keep chart-axis labels at 12px independently of SVG scaling.
- Preserve statistics, filters, turn selection, paging and review actions; adapt the same fields to narrower editor groups.

## 0.9.0

- Add a session-analysis editor tab, opened from the bottom-panel toolbar, a row's chart button, or the command palette. Reuse one tab per window without changing ordinary sidebar navigation.
- Compare current-workspace usage, weighted cache-hit rates, turn counts and recorded execution time with shared search/directory filters and sortable session rows. Exclude inherited sessions from additive totals and retain missing-value coverage.
- Add per-session token composition, duration median/P95, paged turn charts and linked turn/file-operation details. Chart selection follows the matching table page, and review actions open the existing turn-review flow.
- Reuse local records and refresh events; send only the selected session's turn/file summaries. Preserve selection during updates and clear stale workspace/source state.
- Use a compact, theme-aware layout with Lucide icons. Add three focused aggregation, panel-lifecycle and source-isolation tests plus an isolated browser fixture generator.

## 0.8.1

- Apply the approved soft, native-style list: remove regular row rules and filled status/count badges, soften selection, and refine the toolbar and column menu. Preserve theme colors, Lucide icons and keyboard/high-contrast focus boundaries.
- Keep 44px rows, the 136px minimum Token column and all four visible metrics. Retain column resizing, visibility choices and saved workspace layouts; reveal dividers on hover or focus with a 9px drag target.
- Scope the empty-page style to its container so sessions with no turn records retain the same row height and alignment as other sessions.

## 0.8.0

- Add draggable column dividers and a compact column-visibility menu, available from the Lucide header button or any header's context menu. Keep the conversation title mandatory and the Token column at least 136px wide.
- Save layouts per workspace and restore them when reopening the panel. Apply changes immediately; serialize writes, ignore stale snapshots while saving, and roll back failed saves with a visible error.
- Preserve default responsive behavior until customized. Explicitly selected columns stay visible in narrow panels with horizontal scrolling; manually resized widths stay fixed. Double-click resets one width, while the menu reset restores all default sizing and visibility.
- Support keyboard resizing, cancellation and focus restoration. Preserve horizontal as well as vertical scroll when returning from turn review; header actions never switch conversations.
- Add two focused layout/storage tests and rendered interaction checks, including pending writes, failure recovery and light/dark/high-contrast compact menus. Keep dynamic layout styles nonce-authorized under the existing restrictive CSP.

## 0.7.2

- Reduce the Token column from 196px to 136px, returning 60px to conversation titles while keeping input, output, cached input and total visible in one column.
- Use compact 入 / 出 / 缓 / 总 labels, tighter spacing and three-significant-digit K/M/B/T values without redundant decimal zeros. Preserve the 12px font and 44px table rows.
- Retain exact integer tooltips, full accessible statistics, independent missing values and explicit zero. Token collection and arithmetic are unchanged.
- Add one focused formatter regression and rendered checks for the actual 136px width, large values, narrow layouts and exact tooltips.

## 0.7.1

- Refine the compact panel presentation using VS Code theme tokens: grouped filter counts, explicit source icons, clearer selected rows and pending-review buttons.
- Improve status hierarchy and contrast with readable text plus semantic icons and subtle backgrounds, keeping the running-only spinner and reduced-motion behavior.
- Clarify review details with a separate review-state badge, a prominent confirmation action, a secondary undo action and differentiated directory/filename text.
- Preserve 44px rows, token/turn columns, all actions and backend behavior. Remove the redundant title arrow to give compact titles more room.
- Extend rendered checks for light/dark status contrast, high-contrast controls and a 360px toolbar. No new unit tests or runtime protocol changes.

## 0.7.0

- Add all/active/attention/review filters with conversation counts and next-attention navigation in the official sidebar.
- Track review decisions per turn and evidence version. Establish an initial historical baseline, distinguish opening from reviewing, preserve multiple pending turns, and reopen review when evidence changes.
- Normalize verified live and persisted FileChange items. Recover recorded add/update/delete patches on demand and display read-only operation diffs without attributing workspace Git changes to a conversation.
- Add a compact review detail view, turn selector, explicit mark/undo controls and workspace-scoped current-file navigation. Preserve the selected old turn when new results arrive.
- Bound patch caches, refuse oversized or missing previews, and keep source directories and stale actions isolated. Save decisions through workspace state without writing official records or retaining raw conversation logs.
- Extend focused workflow/path tests, rendered UI checks and isolated native VS Code verification for preview ownership and next-attention behavior.

## 0.6.0

- Add explicitly enabled, per-workspace live monitoring for running, approval waits and user-input waits. Only backend-confirmed running states spin; waiting states remain static, with reduced-motion support.
- Forward official stdio bytes unchanged with backpressure. Parse status notifications in a bounded Worker and send only state summaries over a private per-window channel. Do not inject queries, rewrite responses, answer approvals or retain protocol logs.
- Preserve inherited stdio when monitoring is disabled, and preserve existing Profile choices. Confirm shared-launcher takeover, require a later window reload, and keep unverified official versions on recorded status.
- Clear live state on disconnection or observation gaps. Only sessions observed on the current backend connection receive live overrides; historical statistics remain file-based.
- Refresh records immediately when the panel becomes visible. Extend actual UI and isolated backend/VS Code verification, including automatic file updates without clicking Refresh.

## 0.5.4

- Separate incremental JSONL I/O, typed rollout interpretation, workspace indexing, official navigation and keyed table rendering without changing the approved layout or statistics semantics.
- Handle long JSONL lines with one concatenation per complete line instead of repeatedly copying growing buffers. Restrict fast skipping to known top-level record envelopes so nested `type` fields cannot hide lifecycle events or titles.
- Reuse table rows and cells across refreshes, preserve scrolling and keyboard focus during reordering, and never restore focus from a background Webview.
- Coalesce refresh requests, cancel obsolete source reads and reject stale results/errors after source changes. Discard partially updated caches on read failure. Validate Webview actions at the host boundary.
- Keep the read-only session source, version-pinned official sidebar navigation and independent Profile launcher. Add two focused regressions and extend rendered/native-host checks.

## 0.5.3

- Display cumulative input, output, cached input and total tokens together in one compact two-row cell, keeping exact values in the tooltip and preserving per-field unknown values.
- Add a separate session-turn count column with outcome details; incomplete history stays unknown instead of being shown as zero.
- Keep both statistics columns visible in compact layouts and retain row-click navigation. No changes to local-record collection or the no-proxy architecture.

## 0.5.2

- Distinguish a recorded start without an end, no lifecycle records, and genuinely unknown state. Status tooltips explain the reason and show the record timestamp without claiming live execution.
- Decouple the latest lifecycle result and duration from full-history counting completeness. Historical missing IDs, malformed records or rollback markers no longer suppress a later explicit terminal result; incomplete aggregate counts remain unavailable.

## 0.5.1

- Replace the nearly invisible `.` working-directory label with the root directory name and a root marker, for example `yhx（根目录）`. Keep the original full cwd in the tooltip and preserve nested relative paths.

## 0.5.0

- Remove the conversation JSONL proxy, injected metadata queries and session socket. Restore inherited stdio in the Profile launcher.
- Read session titles and rollout files directly, with streaming first-load and incremental append processing. The panel no longer requires a custom CLI executable or a live backend connection.
- Add per-session cumulative tokens and latest recorded turn duration; hover for token breakdown, unique turn counts, outcomes and recorded execution time. Keep missing values distinct from zero and flag inherited or incomplete history.
- Label persisted outcomes as historical. A start without a terminal record is unknown; remove inferred live spinners and approval/input status claims.
- Handle partial UTF-8 lines, truncation, replacement, title updates and archive removal without modifying source files or opening SQLite.
- Keep official sidebar navigation, bottom-panel placement and independent window Profile selection.

Upgrade: finish active tasks and reload the window after installing so any 0.4.x proxy process can exit. No new Profile selection is required.

## 0.4.2

- Replace the inferred Project column with the actual working directory (`cwd`), including search and accessible labels.
- Preserve nested relative paths instead of collapsing them to a first-level folder. Show `.` for a single workspace root and full paths for multi-root workspaces; hover retains the original backend cwd.
- Rename the internal display field to `cwdLabel` without retaining the inferred-project alias. Keep bottom-panel navigation and running indicators unchanged.

## 0.4.1

- Animate the Lucide loader only for running sessions; keep other runtime states static and respect reduced-motion preferences.

## 0.4.0

- Add a compact Codex Sessions panel beside Terminal: title, runtime status, project, model/provider and updated time, with search and refresh.
- Click a session to switch the official Codex sidebar in the same VS Code window. No new chat editor tabs, editor groups or code-layout changes. The adapter targets official Codex `26.51007.21434`.
- Read metadata and live status through the official app-server connection using the existing launcher. The private side channel permits only metadata reads and isolates injected query IDs and responses.
- Show unknown status for unloaded sessions and disconnected backends. Do not infer completion from timestamps or send extra task notifications.
- Preserve the existing per-window Profile flow. Add focused protocol and metadata tests, rendered table checks, and isolated real-VS-Code verification for bottom-panel navigation.
- Update the production TOML parser to 1.9.1 to address GHSA-r4xh-jqrq-34v2.

## 0.3.0

- Add explicit repair/restore commands for verified Codex `26.5928.31416` files; no automatic patching on activation or upgrade.
- Fix the queued-message lock release response and prevent background queues in unrelated windows from acquiring a shared thread. Preserve newly accepted local sends and upstream explicit-send checks.
- Require exact version and full-file hashes, back up originals, serialize concurrent repairs, and support rollback, idempotency, and interrupted-operation recovery.
- Document that unowned historical queues need the conversation to be opened or explicitly sent after reload. Disabling the switcher does not restore patched official files.
- Add three focused tests and a read-only-to-installed-files validation script. This is not a fix for Electron native renderer crashes; real multi-window UI and model E2E remain unverified.

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
