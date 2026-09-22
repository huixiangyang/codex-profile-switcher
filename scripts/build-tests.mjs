import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
await mkdir('.test-build', { recursive: true });
await build({
  entryPoints: (await readdir('test')).filter(x => x.endsWith('.test.ts') || x === 'window-host.ts').map(x => `test/${x}`),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  outdir: '.test-build', outExtension: { '.js': '.cjs' },
  alias: { vscode: './test/vscode-stub.ts' }
});
