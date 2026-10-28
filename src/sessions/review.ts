import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { within } from './catalog';
import { maxPatchBytes, renderPatch, type PatchBody, type TurnSummary } from './turns';

/** 当前文件是显式导航目标，不是审阅补丁的历史基线。 */
export async function reviewFileTarget(cwd: string, file: string, roots: string[]): Promise<string> {
  const candidate = path.resolve(cwd, file);
  const realRoots = await Promise.all(roots.map(root => fs.realpath(root).catch(() => null)));
  const real = await fs.realpath(candidate);
  if (!realRoots.some(root => root !== null && within(root, real))) throw new Error('文件不在当前工作区内，已阻止打开。');
  if (!(await fs.stat(real)).isFile()) throw new Error('该路径不是可打开的文件。');
  return real;
}
export class SessionReview implements vscode.TextDocumentContentProvider {
  private documents = new Map<string, string>();
  private bytes = 0;
  provideTextDocumentContent(uri: vscode.Uri): string { return this.documents.get(uri.toString()) ?? '补丁预览已释放，请从会话面板重新打开。'; }
  async open(turn: TurnSummary, file: string, bodies: PatchBody[]): Promise<void> {
    if (turn.items.reduce((n, item) => n + item.bytes, 0) > maxPatchBytes) throw new Error('本轮补丁超过 512 KiB 预览限制；请在官方会话中查看。');
    const selected = turn.items.filter(item => item.files.some(row => row.path === file));
    if (!selected.length) throw new Error('文件不属于所选回合。');
    const parts: string[] = [];
    for (const item of selected) {
      const body = bodies.find(body => body.item.fingerprint === item.fingerprint);
      const patch = body?.patches.find(patch => patch.path === file);
      if (!patch) throw new Error('该版本补丁已不可用或仍未落盘，请刷新后重试；未使用当前文件替代。');
      parts.push(`# 操作 ${item.id} · ${item.status}\n${renderPatch(patch)}`);
    }
    const content = `# 本轮已记录改动 · ${turn.id}\n# 按逐次操作展示；不是整个工作区的净差异。\n\n${parts.join('\n')}`;
    const uri = vscode.Uri.from({ scheme: 'codex-session-review', path: `/${path.basename(file)}.diff`, query: encodeURIComponent(JSON.stringify([turn.id, selected.map(i => i.fingerprint), file])) });
    const key = uri.toString();
    if (!this.documents.has(key)) this.bytes += Buffer.byteLength(content);
    this.documents.set(key, content);
    // 和实时补丁缓存各保留 8 MiB；用户固定的编辑器内容仍由 VS Code 管理。
    while (this.bytes > 8 * 1024 * 1024) {
      const [old, text] = this.documents.entries().next().value!; this.documents.delete(old); this.bytes -= Buffer.byteLength(text);
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true, preserveFocus: false });
  }
  dispose(): void { this.documents.clear(); this.bytes = 0; }
}
