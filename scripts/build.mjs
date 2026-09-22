import { build } from 'esbuild';
await build({
  entryPoints: { extension: 'src/extension.ts', bridge: 'src/bridge.ts' },
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  external: ['vscode'], outdir: 'dist', outExtension: { '.js': '.cjs' },
  sourcemap: false, legalComments: 'eof'
});
