import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['./src/cli/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: './dist/cli/index.cjs',
    external: [],
    minify: false, // Disable minify to preserve function names
    sourcemap: !isProduction,
    treeShaking: true,
    metafile: isProduction,
    define: {
      'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    },
    // Add CJS-compatible main() call at the end
    footer: {
      js: 'main().catch((e) => { console.error("Критическая ошибка:", e); process.exit(1); });',
    },
  });

  // Ensure dist directory exists
  mkdirSync(dirname('./dist/cli/index.js'), { recursive: true });

  if (isWatch) {
    await ctx.watch();
    console.log('👀 Watching for changes...');
  } else {
    await ctx.rebuild();
    ctx.dispose();

    if (isProduction) {
      console.log('✅ Production build complete');
    } else {
      console.log('✅ Build complete');
    }
  }
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
