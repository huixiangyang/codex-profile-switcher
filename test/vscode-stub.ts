export const state = {
  values: new Map<string, unknown>(), commands: new Map<string, () => Promise<void>>(),
  updates: [] as unknown[], notifications: [] as string[], choice: '', extensionPath: '', confirmDisconnect: false,
  status: { text: '', tooltip: '', name: '', command: '', accessibilityInformation: {}, show() {}, hide() {}, dispose() {} }
};
export const StatusBarAlignment = { Right: 1 };
export const ConfigurationTarget = { Global: 1 };
export const env = { remoteName: undefined, appRoot: '/Applications/Visual Studio Code.app/Contents/Resources/app' };
export const Uri = { file: (file: string) => ({ fsPath: file }) };
export const extensions = { getExtension: () => ({ extensionPath: state.extensionPath }) };
export const commands = {
  registerCommand(name: string, action: () => Promise<void>) { state.commands.set(name, action); return { dispose() {} }; },
  async executeCommand() {}
};
export const workspace = {
  workspaceFolders: [{ uri: { fsPath: '/test/project' } }],
  workspaceFile: undefined,
  getConfiguration(section: string) {
    return {
      get(key: string, fallback?: unknown) { return state.values.get(`${section}.${key}`) ?? fallback; },
      inspect(key: string) { return { globalValue: state.values.get(`${section}.${key}`) }; },
      async update(key: string, value: unknown) { state.values.set(`${section}.${key}`, value); state.updates.push(value); }
    };
  },
  onDidChangeConfiguration() { return { dispose() {} }; }
};
export const window = {
  createStatusBarItem: () => state.status,
  async showQuickPick(items: { label: string }[]) { return items.find(x => x.label === state.choice); },
  async showInformationMessage(message: string) { state.notifications.push(message); },
  async showErrorMessage(message: string) { state.notifications.push(message); },
  async showWarningMessage(message: string) { state.notifications.push(message); return state.confirmDisconnect ? '停用所有窗口' : undefined; },
  async showTextDocument() {}
};
