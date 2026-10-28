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

Explicit repair/restore commands can edit two verified official extension files.
They require a fixed version and full-file hashes, preserve original backups in
global storage, and reject unknown content. No repair runs automatically. A
loopback TCP listener is used only for mutual exclusion and exchanges no data.
Repair backups contain extension code, not credentials or conversation history.

Session titles and historical statistics use read-only handles for
`session_index.jsonl` and JSONL rollouts under `CODEX_HOME/sessions`. The extension
does not repair those files, open SQLite or read credential files. Cached history
contains summaries rather than complete conversations.

Live monitoring is off by default, requires confirmation in a trusted local
workspace, and activates on a subsequent window reload. It changes the existing
launcher to byte-for-byte stdio forwarding with backpressure. An isolated Worker
observes verified status, turn lifecycle and file-change completion events.
No protocol requests are injected and no approvals are answered by the switcher.

The forwarding path encounters conversation and tool content. Raw chunks are
transient, bounded, and never written to logs. The private Unix channel carries
state/turn summaries and explicit, bounded file patches, not arbitrary protocol
messages. The Webview receives summaries; read-only virtual documents display
patch content only on an explicit user action. It exposes no backend command API.
The original window-config socket still only supplies startup configuration.

Worker backlog is bounded at 2 MiB. Overload or worker failure stops observation
without stopping forwarding. Observer lines are bounded at 1 MiB; recognized oversized patch lines skip the patch, while unknown oversized or
malformed lines invalidate runtime state. Snapshot sizes and send buffers are
bounded. Disconnects remove live state rather than leaving stale running icons.
The forwarding process remains part of the connection: its own crash can still
interrupt official communication. Disable monitoring and reload after active
tasks finish to return to inherited stdio. Unknown official versions do not
activate monitoring. Global launcher takeover requires explicit confirmation;
other windows keep monitoring disabled unless opted in separately.

Navigation uses the official extension URI handler and VS Code's window-bound
`asExternalUri` through the internal opener. It does not launch a system browser,
create chat editor tabs, or execute Git commands. Webview content uses text nodes
and a restrictive CSP. Session discovery requires a trusted local workspace;
this does not change the existing Profile switcher's trust contract.

The explicit analysis action creates one Webview editor tab in the current editor
group. It reuses the workspace-scoped record source and sends turn/file-operation
summaries only for the selected session, without patch bodies or chat content.
Its message allowlist supports navigation, refresh and existing review actions;
session and turn membership are checked by the host. Text uses DOM text nodes and
charts use numeric SVG geometry under a restrictive CSP, without remote assets
or scripts. Search and selection preferences stay in Webview-local state.

Column widths and visibility are local workspace metadata, separate from Profile
and review state. Host validation accepts only known column IDs and bounded
integer widths. Generated layout CSS uses fixed selectors, numeric geometry and
a host-issued nonce; the CSP does not enable `unsafe-inline`. No conversation
content is used as CSS. A failed save restores the last persisted layout.

Review decisions, baseline turn IDs and evidence fingerprints are stored via
VS Code workspace state, namespaced by canonical source directory. Fingerprints
bind review acknowledgements to content and detect evidence changes; patch text
is not persisted by the extension. Historical patch content is recovered from
verified JSONL FileChange records on demand. Each turn's preview is capped at
512 KiB; live patch and preview caches each retain at most 8 MiB of content.

Real-file navigation resolves symlinks and rejects paths outside current workspace
roots. Patch previews never apply changes, invoke Git or replace missing history
with current working files. Failed persistence retains the pending-review state.
