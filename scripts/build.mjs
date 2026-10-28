import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: { extension: 'src/extension.ts', bridge: 'src/bridge.ts', observer: 'src/live/observer.ts' },
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  external: ['vscode'], outdir: 'dist', outExtension: { '.js': '.cjs' },
  sourcemap: false, legalComments: 'eof'
});
await build({
  entryPoints: {sessions:'src/sessions/webview.ts',analytics:'src/sessions/analytics-webview.ts'}, bundle: true, platform: 'browser',
  target: 'chrome130', format: 'iife', outdir: 'dist', minify: true, legalComments: 'eof'
});
