import * as vscode from 'vscode';

export const supportedCodexVersion = '26.51021.22027';
export function navigationError(): string | undefined {
  const version = vscode.extensions.getExtension('openai.chatgpt')?.packageJSON.version;
  if (!version) return '请先安装官方 Codex 扩展（openai.chatgpt）。';
  if (version !== supportedCodexVersion) return `当前 Codex 为 ${version}，本扩展适配 ${supportedCodexVersion}。请检查官方 Codex 和本扩展的更新。`;
}
export function supportsNavigation(): boolean {
  return navigationError() === undefined;
}
export async function openSession(id: string): Promise<void> {
  const error = navigationError();
  if (error) throw new Error(error);
  // 由官方 URI handler 切换侧栏；asExternalUri 绑定当前窗口，不连接或代理 app-server。
  const uri = await vscode.env.asExternalUri(vscode.Uri.from({ scheme: vscode.env.uriScheme, authority: 'openai.chatgpt', path: `/local/${id}` }));
  await vscode.commands.executeCommand('vscode.open', uri);
}
