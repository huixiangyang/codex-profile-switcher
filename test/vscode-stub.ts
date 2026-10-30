export interface StubPickItem { label: string; action?: string; value?: unknown; detail?: string; description?: string }
export const state = {
  values: new Map<string, unknown>(), commands: new Map<string, () => Promise<void>>(),
  updates: [] as unknown[], notifications: [] as string[], choice: '', extensionPath: '', confirmDisconnect: false, confirmLive: '', extensionVersion: '26.51021.22027',
  quickPickHandler: undefined as ((items: StubPickItem[], options: unknown) => Promise<StubPickItem | undefined>) | undefined,
  inputBoxHandler: undefined as ((options: unknown) => Promise<string | undefined>) | undefined,
  picks: [] as { items: StubPickItem[]; options: unknown }[], inputs: [] as unknown[],
  documents: [] as { language?: string; content?: string }[], shownDocuments: [] as unknown[],
  status: { text: '', tooltip: '', name: '', command: '', accessibilityInformation: {}, show() {}, hide() {}, dispose() {} }
};
export const StatusBarAlignment = { Right: 1 };
export const ViewColumn = { Active: -1, One: 1 };
export const ConfigurationTarget = { Global: 1 };
export const env = { remoteName: undefined, uriScheme: 'vscode', asExternalUri: async (uri: unknown) => uri, appRoot: '/Applications/Visual Studio Code.app/Contents/Resources/app' };
export class Uri {
  constructor(readonly scheme: string, readonly authority: string, readonly path: string, readonly query = '') {}
  get fsPath() { return this.path; }
  toString() { return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ''}`; }
  static file(file: string) { return new Uri('file', '', file); }
  static from(value: { scheme: string; authority?: string; path: string; query?: string }) { return new Uri(value.scheme, value.authority ?? '', value.path, value.query); }
  static parse(value: string) { const url = new URL(value); return new Uri(url.protocol.slice(0, -1), url.hostname, decodeURIComponent(url.pathname)); }
  static joinPath(base: Uri, ...parts: string[]) { return new Uri(base.scheme, base.authority, [base.path, ...parts].join('/')); }
}
export class RelativePattern { constructor(readonly base: Uri, readonly pattern: string) {} }
export const extensions = { getExtension: () => ({ extensionPath: state.extensionPath, packageJSON: { version: state.extensionVersion } }) };
export const commands = {
  registerCommand(name: string, action: () => Promise<void>) { state.commands.set(name, action); return { dispose() {} }; },
  async executeCommand() {}
};
export const workspace = {
  fs: { async writeFile() { throw new Error("测试需要显式提供文件写入替身"); } },
  workspaceFolders: [{ uri: Uri.file('/test/project') }],
  isTrusted: true,
  workspaceFile: undefined,
  getConfiguration(section: string) {
    return {
      get(key: string, fallback?: unknown) { return state.values.get(`${section}.${key}`) ?? fallback; },
      inspect(key: string) { return { globalValue: state.values.get(`${section}.${key}`) }; },
      async update(key: string, value: unknown) { state.values.set(`${section}.${key}`, value); state.updates.push(value); }
    };
  },
  registerTextDocumentContentProvider() { return { dispose() {} }; },
  async openTextDocument(input: Uri | { language?: string; content?: string }) {
    if (input instanceof Uri) return { uri: input };
    state.documents.push(input);
    return { uri: Uri.from({ scheme: 'untitled', path: '/Untitled-1' }), isUntitled: true, languageId: input.language, getText: () => input.content ?? '' };
  },
  createFileSystemWatcher() { return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} }; },
  onDidChangeConfiguration() { return { dispose() {} }; },
  onDidChangeWorkspaceFolders() { return { dispose() {} }; }
};
export const window = {
  createWebviewPanel() { throw new Error('测试需要显式提供 WebviewPanel 替身'); },
  registerWebviewViewProvider() { return { dispose() {} }; },
  createStatusBarItem: () => state.status,
  async showSaveDialog() { return undefined; },
  async showQuickPick(items: StubPickItem[], options?: unknown) {
    state.picks.push({ items, options });
    return state.quickPickHandler ? state.quickPickHandler(items, options) : items.find(x => x.label === state.choice);
  },
  async showInputBox(options?: unknown) { state.inputs.push(options); return state.inputBoxHandler?.(options); },
  async showInformationMessage(message: string) { state.notifications.push(message); },
  async showErrorMessage(message: string) { state.notifications.push(message); },
  async showWarningMessage(message: string) { state.notifications.push(message); return state.confirmLive || (state.confirmDisconnect ? '停用所有窗口' : undefined); },
  async showTextDocument(document?: unknown, options?: unknown) { state.shownDocuments.push({ document, options }); }
};
