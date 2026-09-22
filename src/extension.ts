import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLauncher, binaryRelativePath, readManagedSpec, atomicWrite } from './launcher';
import { listProfiles, resolveHome, readProfile, profileArgs, Profile } from './profiles';

interface Choice extends vscode.QuickPickItem { profile?: Profile }

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = context.globalStorageUri.fsPath;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  status.name = 'Codex Profile';
  status.command = 'codexProfiles.switch';
  const executable = () => vscode.workspace.getConfiguration('chatgpt').get<string | null>('cliExecutable') || undefined;
  const home = () => resolveHome(vscode.workspace.getConfiguration('codexProfiles').get<string>('codexHome'));
  const startupExecutable = executable();
  let busy = false;

  function requireLocal(): void {
    if (vscode.env.remoteName || process.platform === 'win32') throw new Error('当前版本仅支持本机 macOS / Linux；暂不支持 Remote SSH、容器或 Windows / WSL。');
  }

  async function refresh(): Promise<void> {
    const spec = await readManagedSpec(storage, executable());
    const pending = executable() !== startupExecutable;
    const moved = spec && spec.codexHome !== home();
    const label = spec?.profile || (executable() ? '外部启动配置' : '默认');
    status.text = `Codex: ${label}${moved ? ' · 请重新选择' : pending ? ' · 待重载' : ''}`;
    status.tooltip = `切换 Codex profile\n当前选择：${label}\n${moved ? '配置目录已更改，请重新选择 profile。' : pending ? '选择已保存，重新加载窗口后用于新对话。' : '显示启动配置选择，不代表旧对话已切换。'}`;
    status.accessibilityInformation = { label: `Codex profile：${label}${pending ? '，等待重新加载窗口' : ''}` };
    if (vscode.workspace.getConfiguration('codexProfiles').get('showStatusBar', true)) status.show(); else status.hide();
  }

  async function reloadNotice(): Promise<void> {
    const action = await vscode.window.showInformationMessage('Codex 启动配置已保存。重新加载窗口后，请新建对话；旧对话可能保留原来的 provider。', '重新加载窗口', '稍后');
    if (action === '重新加载窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async function setProfile(profile?: Profile): Promise<void> {
    requireLocal();
    const config = vscode.workspace.getConfiguration('chatgpt');
    const inspected = config.inspect<string | null>('cliExecutable');
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      throw new Error('工作区覆盖了 Codex 启动路径，请先移除工作区中的 chatgpt.cliExecutable。');
    }
    let next: string | undefined;
    if (profile) {
      profileArgs(await readProfile(home(), profile.name));
      const codex = vscode.extensions.getExtension('openai.chatgpt');
      if (!codex) throw new Error('请先安装官方 Codex 扩展（openai.chatgpt）。');
      const binary = path.join(codex.extensionPath, binaryRelativePath());
      await fs.access(binary, fs.constants.X_OK);
      // macOS 使用 VS Code 主程序的 Node 模式，不依赖用户安装 Python 或 Node。
      const runtime = process.platform === 'darwin'
        ? path.resolve(vscode.env.appRoot, '../../MacOS/Code') : process.execPath;
      next = await createLauncher(storage, context.asAbsolutePath('dist/bridge.cjs'), runtime, {
        version: 1, profile: profile.name, codexHome: home(), binary
      });
    }
    if (executable() === next) { void reloadNotice(); return; }
    await fs.mkdir(storage, { recursive: true, mode: 0o700 });
    // 接管前保留原启动路径，不复制用户配置或凭据。
    const backup = path.join(storage, 'previous-startup.json');
    try { await fs.access(backup); }
    catch { await atomicWrite(backup, JSON.stringify({ cliExecutable: inspected?.globalValue ?? null })); }
    await config.update('cliExecutable', next, vscode.ConfigurationTarget.Global);
    await refresh();
    void reloadNotice();
  }

  async function choose(): Promise<void> {
    requireLocal();
    const profiles = await listProfiles(home());
    const current = await readManagedSpec(storage, executable());
    const items: Choice[] = [{ label: '默认配置', description: !executable() ? '当前选择' : undefined, detail: '使用 Codex 原生启动方式和 config.toml' }];
    for (const profile of profiles) items.push({
      label: profile.name,
      description: profile.name === current?.profile && home() === current.codexHome ? '当前选择' : undefined,
      detail: profile.error || [profile.provider ? `Provider: ${profile.provider}` : '继承默认 provider', profile.model || '继承默认模型'].join(' · '),
      profile
    });
    const selection = await vscode.window.showQuickPick(items, {
      title: '切换 Codex Profile', placeHolder: profiles.length ? '选择后可重新加载窗口，使新对话使用该配置' : '未发现 profile，可先创建 <名称>.config.toml',
      matchOnDescription: true, matchOnDetail: true
    });
    if (!selection) return;
    if (selection.profile?.error) {
      const action = await vscode.window.showErrorMessage(selection.profile.error, '打开配置文件');
      if (action) await vscode.window.showTextDocument(vscode.Uri.file(selection.profile.file));
      return;
    }
    await setProfile(selection.profile);
  }

  const run = (action: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      await vscode.window.showErrorMessage(code ? `Codex Profiles 操作失败（${code}），请检查文件路径和访问权限。` : (error as Error).message);
    } finally { busy = false; }
  };
  context.subscriptions.push(status,
    vscode.commands.registerCommand('codexProfiles.switch', run(choose)),
    vscode.commands.registerCommand('codexProfiles.reset', run(() => setProfile())),
    vscode.commands.registerCommand('codexProfiles.refresh', run(async () => { await listProfiles(home()); await refresh(); })),
    vscode.commands.registerCommand('codexProfiles.open', run(async () => {
      const spec = await readManagedSpec(storage, executable());
      const file = spec ? path.join(spec.codexHome, `${spec.profile}.config.toml`) : path.join(home(), 'config.toml');
      await vscode.window.showTextDocument(vscode.Uri.file(file));
    })),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('chatgpt.cliExecutable') || event.affectsConfiguration('codexProfiles')) void run(refresh)();
    })
  );
  await refresh();
}

export function deactivate(): void { /* 重载时保持用户选择，不在退出时重写设置。 */ }
