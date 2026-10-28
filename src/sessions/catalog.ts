import path from 'node:path';
import { promises as fs } from 'node:fs';

export function within(root: string, file: string): boolean {
  if (!path.isAbsolute(file)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export async function canonicalPath(file: string): Promise<string> {
  // 仅归一化匹配键，保留后端的实际 cwd；处理 macOS /var 与 /private/var 等路径别名。
  return fs.realpath(file).catch(() => path.resolve(file));
}
export function formatWorkingDirectory(roots: string[], cwd: string): string | undefined {
  const root = roots.filter(root => within(root, cwd)).sort((a, b) => b.length - a.length)[0];
  if (!root) return undefined;
  // 根目录不再缩写成难以辨认的点；多根工作区保留完整路径以避免歧义。
  return roots.length > 1 ? cwd : path.relative(root, cwd) || `${path.basename(root) || root}（根目录）`;
}
