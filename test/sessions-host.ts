// 在隔离 VS Code 中验证底部面板与官方侧栏切换，不创建聊天编辑器标签。
import * as vscode from "vscode";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
export async function run(): Promise<void> {
  const root = process.env.SESSIONS_VERIFY_ROOT!;
  const { ids, workspace } = JSON.parse(
    await fs.readFile(path.join(root, "seed.json"), "utf8"),
  );
  try {
    await vscode.extensions
      .getExtension("huixiangyang.codex-profile-switcher")!
      .activate();
    const live = process.env.SESSIONS_VERIFY_LIVE === '1';
    if (live && !vscode.workspace.getConfiguration('chatgpt').get('cliExecutable')) {
      await fs.writeFile(path.join(root, 'enable-required'), '');
      await vscode.commands.executeCommand('codexSessions.configureLive');
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      // 重载由新宿主继续；旧驱动不能在 finally 中退出整个测试窗口。
      await new Promise(() => {});
    }
    assert.equal(!!vscode.workspace.getConfiguration('chatgpt').get('cliExecutable'), live, '只有明确启用实时监听时才配置启动入口');
    const file = vscode.Uri.file(path.join(workspace, "alpha", "review.ts"));
    const editor = await vscode.window.showTextDocument(file, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    editor.selection = new vscode.Selection(17, 0, 17, 6);
    const groups = vscode.window.tabGroups.all.length;
    await vscode.commands.executeCommand("codexSessions.open");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await vscode.commands.executeCommand("codexSessions.refresh");
    void vscode.commands.executeCommand("codexSessions.switch", ids[0]);
    await fs.writeFile(path.join(root, "ready.json"), "{}");
    const deadline = Date.now() + 90000;
    while (
      Date.now() < deadline &&
      !(await fs.stat(path.join(root, "release")).catch(() => false))
    ) {
      if (await fs.stat(path.join(root,'check-review')).catch(()=>false)) {
        const doc = vscode.workspace.textDocuments.find(doc=>doc.uri.scheme==='codex-session-review');
        if (doc) {
          const text = doc.getText();
          await fs.writeFile(path.join(root,'review-check.json'),JSON.stringify({success:text.includes('-before-1')&&text.includes('+after-1')&&!text.includes('before-2')&&!doc.isDirty,error:'补丁必须属于第一轮，不能混入第二轮或当前文件'}));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(
      vscode.window.tabGroups.all.length,
      groups,
      "切换不能增加编辑器组",
    );
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => tab.input instanceof vscode.TabInputCustom),
      false,
      "不能创建聊天编辑器标签",
    );
    assert.equal(editor.selection.start.line, 17, "代码审阅位置应保留");
    const restoredEditor = await vscode.window.showTextDocument(editor.document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand("codexSessions.refresh");
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(vscode.window.activeTextEditor, restoredEditor, "后台刷新不能抢走代码编辑器焦点");
    await fs.writeFile(
      path.join(root, "result.json"),
      JSON.stringify({
        success: true,
        noChatEditorTabs: true,
        noExtraEditorGroups: true,
        codeSelectionUnchanged: true,
        noLauncherConfigured: !live,
        liveExplicitlyEnabled: live,
        backgroundRefreshKeepsEditor: true,
      }),
    );
  } catch (error) {
    await fs.writeFile(
      path.join(root, "result.json"),
      JSON.stringify({ success: false, error: String(error) }),
    );
    throw error;
  }
}
