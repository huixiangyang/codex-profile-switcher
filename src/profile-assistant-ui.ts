import * as vscode from 'vscode';
import { listProfiles, readProfile, type Profile } from './profiles';
import {
  createProfileDraft, readAssistantMetadata, reasoningEfforts, safeMetadataValue,
  templates, validateDraftName, previewOverrides,
  type ProfileTemplate, type ReasoningEffort
} from './profile-assistant';

interface ValueChoice<T> extends vscode.QuickPickItem { value: T }
class AssistantError extends Error {}

function sourceGuard(home: () => string): { source: string; check: () => void } {
  if (!vscode.workspace.isTrusted) throw new AssistantError('请先信任工作区，再使用 Profile 配置助手。');
  const source = home();
  return { source, check: () => {
    if (!vscode.workspace.isTrusted || home() !== source) throw new AssistantError('配置目录或工作区信任状态已更改，请重新打开 Profile 配置助手。');
  } };
}

// Used by the normal switch picker too; never return raw malformed metadata.
export function profileDescription(profile: Profile): string {
  if (profile.error) return '配置不可用；请检查文件权限与 TOML 格式';
  const provider = safeMetadataValue(profile.provider), model = safeMetadataValue(profile.model);
  return [provider ? `Provider: ${provider}` : profile.provider ? 'Provider 值已隐藏' : '继承默认 provider', model || (profile.model ? '模型值已隐藏' : '继承默认模型')].join(' · ');
}

export async function createProfileDocument(home: () => string): Promise<void> {
  try {
    const { source, check } = sourceGuard(home);
    const metadata = await readAssistantMetadata(source);
    check();
    const name = await vscode.window.showInputBox({
      title: '创建 Profile 草稿 · 1/5', prompt: '名称（仅生成未保存的 TOML 草稿，不新建或覆盖文件）',
      placeHolder: '例如 coding 或 review', ignoreFocusOut: true,
      validateInput: value => validateDraftName(value, metadata.names)
    });
    check();
    if (name === undefined) return;
    const nameError = validateDraftName(name, metadata.names);
    if (nameError) throw new AssistantError(nameError);
    const template = await vscode.window.showQuickPick<ValueChoice<ProfileTemplate>>(
      (Object.entries(templates) as [ProfileTemplate, typeof templates[ProfileTemplate]][]).map(([value, info]) => ({
        label: info.label, value,
        detail: info.effort ? `建议推理强度 ${info.effort}；模型与 Provider 默认继承，不改变权限` : '所有设置默认继承，按需选择覆盖项'
      })), { title: '创建 Profile 草稿 · 2/5', placeHolder: '选择起点；模板不保证所选模型支持该推理强度', ignoreFocusOut: true }
    );
    check();
    if (!template) return;
    const pickMetadata = async (label: string, values: string[], step: number) => {
      const choice = await vscode.window.showQuickPick<ValueChoice<string | undefined>>([
        { label: '继承默认', detail: '不在草稿中写入此项', value: undefined },
        ...values.map(value => ({ label: value, value }))
      ], { title: `创建 Profile 草稿 · ${step}/5 · ${label}`, ignoreFocusOut: true,
        placeHolder: metadata.incomplete ? '部分配置不可读取；仅列出可安全读取的现有标识，也可继承默认' : '仅使用现有配置中的标识；不查询网络或复制 Provider 定义' });
      check();
      return choice;
    };
    const model = await pickMetadata('模型', metadata.models, 3);
    if (!model) return;
    const provider = await pickMetadata('Provider', metadata.providers, 4);
    if (!provider) return;
    const suggested = templates[template.value].effort;
    const efforts: ValueChoice<ReasoningEffort | null>[] = [
      ...(suggested ? [{ label: `模板建议：${suggested}`, value: suggested }] : []),
      { label: '继承默认', value: null },
      ...reasoningEfforts.filter(value => value !== suggested).map(value => ({ label: value, value }))
    ];
    const effort = await vscode.window.showQuickPick(efforts, {
      title: '创建 Profile 草稿 · 5/5 · 推理强度', ignoreFocusOut: true,
      placeHolder: '这里只提供已验证的常用值；模型支持情况需自行确认，其他值可在草稿中编辑'
    });
    check();
    if (!effort) return;
    // The catalog may have changed while a native dialog was open.
    const latest = await readAssistantMetadata(source);
    check();
    const collision = validateDraftName(name, latest.names);
    if (collision) throw new AssistantError(collision);
    const content = createProfileDraft({ name, template: template.value, model: model.value, provider: provider.value, effort: effort.value });
    // Passing content/language (no URI) creates an untitled dirty document.
    // Never save, apply, create directories, or update extension configuration.
    const document = await vscode.workspace.openTextDocument({ language: 'toml', content });
    check();
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof AssistantError ? error.message : '无法生成 Profile 草稿；请检查配置目录与 TOML 格式后重试。配置内容不会显示在错误中。');
  }
}

export async function showProfilePreview(home: () => string): Promise<void> {
  try {
    const { source, check } = sourceGuard(home);
    const profiles = await listProfiles(source);
    check();
    const choice = await vscode.window.showQuickPick<ValueChoice<string | null>>([
      { label: '默认配置', value: null, detail: '切换器不添加 Profile 覆盖项；不读取默认配置内容' },
      ...profiles.map(profile => ({ label: profile.name, value: profile.name, detail: profileDescription(profile) }))
    ], { title: '预览 Profile 覆盖项 · 选择配置', placeHolder: '只读预览，不切换 Profile、不保存配置', matchOnDetail: true });
    check();
    if (!choice) return;
    const data = choice.value ? await readProfile(source, choice.value) : {};
    check();
    const preview = previewOverrides(data);
    await vscode.window.showQuickPick([
      ...preview.fields.map(field => ({ label: field.key, description: field.value })),
      ...(preview.omitted ? [{ label: `另有 ${preview.omitted} 个顶层覆盖项`, detail: '名称和值均隐藏；实际切换仍完整应用，不会丢弃未知项' }] : []),
      ...(!preview.fields.length && !preview.omitted ? [{ label: '切换器不添加覆盖项', detail: '继续使用 Codex 自己的默认配置解析，不代表运行时没有其他设置' }] : []),
      { label: '关闭预览', detail: '未切换、未保存；如需切换，请使用状态栏或“切换 Profile”命令' }
    ], { title: `${choice.value ?? '默认配置'} · 覆盖项预览（只读）`,
      placeHolder: '仅列出安全的 Profile 覆盖项；不是运行时最终配置，不包含凭据或完整 TOML', matchOnDescription: true, matchOnDetail: true });
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof AssistantError ? error.message : '无法预览此 Profile；请检查文件权限、TOML 格式和顶层配置键。配置内容不会显示在错误中。');
  }
}
