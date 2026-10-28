import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLauncher, binaryRelativePath, launcherPath, atomicWrite } from './launcher';
import { listProfiles, resolveHome, readProfile, profileArgs, Profile } from './profiles';
import { serveWindow } from './window';
import { repairCodex } from './repair';
import { SessionPanel } from './sessions/controller';
import { supportsNavigation, supportedCodexVersion } from './sessions/navigation';
import { LiveSessions } from './live/channel';
import type { LiveMode } from './live/protocol';

interface Choice extends vscode.QuickPickItem { profile?: Profile }
interface Selection { profile: string | null; codexHome: string }
const selectionKey = 'windowSelection';
const liveKey = 'sessionLiveEnabled';
let stopWindow: (() => Promise<void>) | undefined;
let sessionPanel: SessionPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = context.globalStorageUri.fsPath;
  // macOS 使用 VS Code 主程序的 Node 模式，不依赖另装 Node。
  const runtime = process.platform === 'darwin' ? path.resolve(vscode.env.appRoot, '../../MacOS/Code') : process.execPath;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  status.name = 'Codex Profile';
  status.command = 'codexProfiles.switch';
  const executable = () => vscode.workspace.getConfiguration('chatgpt').get<string | null>('cliExecutable') || undefined;
  const managed = () => executable() === launcherPath(storage);
  const home = () => resolveHome(vscode.workspace.getConfiguration('codexProfiles').get<string>('codexHome'));
  const startupExecutable = executable();
  let selection = context.workspaceState.get<Selection>(selectionKey) ?? { profile: null, codexHome: home() };
  const startupSelection = { ...selection };
  let liveEnabled = context.workspaceState.get<boolean>(liveKey) ?? false;
  const startupLive = liveEnabled && managed() && supportsNavigation() && vscode.workspace.isTrusted
    && !vscode.env.remoteName && process.platform !== 'win32';
  const live = new LiveSessions();
  let liveStartupFailed = false;
  const liveMode = (): LiveMode => {
    if (!liveEnabled && !startupLive) return 'off';
    if (liveEnabled && !supportsNavigation()) return 'unsupported';
    if (liveEnabled && liveStartupFailed) return 'disconnected';
    if (liveEnabled !== startupLive || !managed()) return 'reload';
    try { if (startupSelection.codexHome !== home()) return 'reload'; }
    catch { return 'reload'; } // 无效目录的具体错误由记录读取器展示，不能打断状态渲染。
    return live.connected ? 'connected' : live.seenConnection || live.startedAt > 0 && Date.now() - live.startedAt > 15000 ? 'disconnected' : 'connecting';
  };
  let busy = false;

  function requireLocal(): void {
    if (vscode.env.remoteName || process.platform === 'win32') throw new Error('当前版本仅支持本机 macOS / Linux；暂不支持 Remote SSH、容器或 Windows / WSL。');
  }

  function binary(): string {
    const codex = vscode.extensions.getExtension('openai.chatgpt');
    if (!codex) throw new Error('请先安装官方 Codex 扩展（openai.chatgpt）。');
    return path.join(codex.extensionPath, binaryRelativePath());
  }

  async function refresh(): Promise<void> {
    const pending = executable() !== startupExecutable || (managed() && (
      selection.profile !== startupSelection.profile || selection.codexHome !== startupSelection.codexHome
    ));
    const moved = managed() && selection.codexHome !== home();
    const label = managed() ? selection.profile || '默认' : executable() ? '外部启动配置' : '默认';
    status.text = `Codex: ${label}${moved ? ' · 请重新选择' : pending ? ' · 待重载' : ''}`;
    status.tooltip = `当前窗口的 Codex profile\n当前选择：${label}\n${moved ? '配置目录已更改，请重新选择 profile。' : pending ? '选择已保存，只需重新加载当前窗口。' : '此窗口独立选择；旧对话可能保留原有 provider。'}`;
    status.accessibilityInformation = { label: `当前窗口 Codex profile：${label}${pending ? '，等待重新加载窗口' : ''}` };
    if (vscode.workspace.getConfiguration('codexProfiles').get('showStatusBar', true)) status.show(); else status.hide();
    sessionPanel?.update();
  }

  async function reloadNotice(): Promise<void> {
    const action = await vscode.window.showInformationMessage('当前窗口的 Codex 配置已保存。重新加载此窗口后，请新建对话；其他窗口的选择不变。', '重新加载窗口', '稍后');
    if (action === '重新加载窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async function setProfile(profile?: Profile): Promise<void> {
    requireLocal();
    if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile) {
      throw new Error('请先打开文件夹或工作区，再为当前窗口选择 profile。');
    }
    const next: Selection = { profile: profile?.name ?? null, codexHome: home() };
    await saveStartup(next, liveEnabled);
    await refresh();
    void reloadNotice();
  }

  async function saveStartup(next: Selection, observe: boolean): Promise<void> {
    if (next.profile) profileArgs(await readProfile(next.codexHome, next.profile));
    await fs.access(binary(), fs.constants.X_OK);
    const config = vscode.workspace.getConfiguration('chatgpt');
    const inspected = config.inspect<string | null>('cliExecutable');
    const launcher = await createLauncher(storage, context.asAbsolutePath('dist/bridge.cjs'), runtime, observe ? context.asAbsolutePath('dist/observer.cjs') : undefined);
    if (!managed()) {
      const backup = path.join(storage, 'previous-startup.json');
      try { await fs.access(backup); }
      catch { await atomicWrite(backup, JSON.stringify({ cliExecutable: inspected?.globalValue ?? null })); }
    }
    const previous = context.workspaceState.get<Selection>(selectionKey);
    await context.workspaceState.update(selectionKey, next);
    try {
      // 只在接管时安装统一入口；日常切换与恢复默认均不修改全局设置。
      if (!managed()) await config.update('cliExecutable', launcher, vscode.ConfigurationTarget.Global);
    } catch (error) {
      await context.workspaceState.update(selectionKey, previous);
      throw error;
    }
    selection = next;
  }

  async function configureLive(): Promise<void> {
    requireLocal();
    const enable = !liveEnabled;
    if (enable) {
      if (!vscode.workspace.isTrusted) throw new Error('请先信任工作区，再启用实时监听。');
      if (!vscode.workspace.workspaceFolders?.length) throw new Error('请先打开文件夹或工作区。');
      if (!supportsNavigation()) throw new Error(`实时监听只支持已核验的官方版本 ${supportedCodexVersion}。`);
      if (managed() && selection.codexHome !== home()) throw new Error('配置目录已更改，请先重新选择当前窗口的 Profile。');
    }
    const label = enable ? '启用实时监听' : '关闭实时监听';
    const detail = enable
      ? `监听当前窗口后端的运行、批准和输入等待事件，通信原样转发，不代答批准。${!managed() ? executable() ? '将替换现有自定义启动入口；其他窗口重载后也会经过统一启动器，但不会自动启用监听。' : '需要设置统一启动入口；其他窗口重载后默认不监听。' : ''}当前任务不会重启，请在任务结束后重载本窗口。`
      : '立即停止面板显示实时状态；转发层在任务结束、重载本窗口后退出。Profile 选择保留。';
    if (await vscode.window.showWarningMessage(detail, { modal: true }, label) !== label) return;
    await context.workspaceState.update(liveKey, enable);
    try { if (enable) await saveStartup(managed() ? selection : { profile: null, codexHome: home() }, true); }
    catch (error) { await context.workspaceState.update(liveKey, liveEnabled); throw error; }
    liveEnabled = enable;
    sessionPanel?.update();
    const reload = await vscode.window.showInformationMessage(`${label}设置已保存。请在当前任务结束后重载窗口生效。`, '重新加载窗口', '稍后');
    if (reload === '重新加载窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async function choose(): Promise<void> {
    requireLocal();
    const profiles = await listProfiles(home());
    const items: Choice[] = [{ label: '默认配置', description: (managed() && selection.profile === null || !executable()) ? '当前选择' : undefined, detail: '仅当前窗口使用 config.toml，其他窗口不变' }];
    for (const profile of profiles) items.push({
      label: profile.name,
      description: managed() && profile.name === selection.profile && home() === selection.codexHome ? '当前选择' : undefined,
      detail: profile.error || [profile.provider ? `Provider: ${profile.provider}` : '继承默认 provider', profile.model || '继承默认模型'].join(' · '),
      profile
    });
    const selected = await vscode.window.showQuickPick(items, {
      title: '当前窗口：切换 Codex Profile', placeHolder: profiles.length ? '仅修改当前窗口，按工作区记住选择' : '未发现 profile，可先创建 <名称>.config.toml',
      matchOnDescription: true, matchOnDetail: true
    });
    if (!selected) return;
    if (selected.profile?.error) {
      const action = await vscode.window.showErrorMessage(selected.profile.error, '打开配置文件');
      if (action) await vscode.window.showTextDocument(vscode.Uri.file(selected.profile.file));
      return;
    }
    await setProfile(selected.profile);
  }

  async function disconnect(): Promise<void> {
    requireLocal();
    if (!managed()) return;
    const action = await vscode.window.showWarningMessage('停用后，所有窗口重载时将恢复 Codex 官方启动方式。各工作区保存的选择仍会保留。', { modal: true }, '停用所有窗口');
    if (action !== '停用所有窗口' || !managed()) return;
    await vscode.workspace.getConfiguration('chatgpt').update('cliExecutable', undefined, vscode.ConfigurationTarget.Global);
    await refresh();
    const reload = await vscode.window.showInformationMessage('已停用切换器。卸载前请重新加载所有正在使用 Codex 的窗口。', '重新加载当前窗口');
    if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async function repair(restore = false): Promise<void> {
    requireLocal();
    const codex = vscode.extensions.getExtension('openai.chatgpt');
    if (!codex) throw new Error('请先安装官方 Codex 扩展（openai.chatgpt）。');
    const result = await repairCodex(codex.extensionPath, storage, restore);
    const message = restore
      ? result.changed ? '已还原 Codex 官方文件。' : 'Codex 文件已是官方原版。'
      : result.changed ? '已修复 Codex 空响应解析，并阻止其他窗口自动接管待发送队列。' : 'Codex 已应用此修复。';
    const reload = await vscode.window.showInformationMessage(
      `${message}请在任务结束后重载所有使用 Codex 的窗口。此修复不处理 Electron 原生崩溃。`, '重新加载当前窗口', '稍后'
    );
    if (reload === '重新加载当前窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
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
    vscode.commands.registerCommand('codexSessions.configureLive', run(configureLive)),
    vscode.commands.registerCommand('codexProfiles.reset', run(() => setProfile())),
    vscode.commands.registerCommand('codexProfiles.disconnect', run(disconnect)),
    vscode.commands.registerCommand('codexProfiles.repairCodex', run(() => repair())),
    vscode.commands.registerCommand('codexProfiles.restoreCodex', run(() => repair(true))),
    vscode.commands.registerCommand('codexProfiles.refresh', run(async () => { await listProfiles(home()); await refresh(); })),
    vscode.commands.registerCommand('codexProfiles.open', run(async () => {
      const current = managed() ? selection : { profile: null, codexHome: home() };
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(current.codexHome, current.profile ? `${current.profile}.config.toml` : 'config.toml')));
    })),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('chatgpt.cliExecutable') || event.affectsConfiguration('codexProfiles')) void run(refresh)();
    })
  );
  if (!vscode.env.remoteName && process.platform !== 'win32') {
    // 更新我们自己的启动桥接，不重启现有后端，不改官方扩展或 Profile。
    if (managed()) {
      await createLauncher(storage, context.asAbsolutePath('dist/bridge.cjs'), runtime, startupLive ? context.asAbsolutePath('dist/observer.cjs') : undefined);
    }
  }
  sessionPanel = new SessionPanel(context, home, live, liveMode);
  await sessionPanel.start();
  if (!vscode.env.remoteName && process.platform !== 'win32') {
    // 固定本次宿主启动时的选择；保存新选择后，必须重载此窗口才会用于后端。
    let liveSocket: string | undefined;
    if (startupLive) {
      try { liveSocket = await live.start(storage); }
      catch {
        liveStartupFailed = true;
        await live.dispose();
        sessionPanel.update();
        void vscode.window.showErrorMessage('实时监听未能启动，已保留原始标准流启动方式和本地记录面板。请检查扩展存储权限后重载。');
      }
    }
    stopWindow = await serveWindow(storage, { version: 2, ...startupSelection, binary: binary(), ...(liveSocket ? { liveSocket } : {}) });
  }
  await refresh();
}

export async function deactivate(): Promise<void> {
  const current = sessionPanel; sessionPanel = undefined;
  await current?.dispose();
  const stop = stopWindow;
  stopWindow = undefined;
  await stop?.();
}
