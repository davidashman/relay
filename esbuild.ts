import esbuild from "esbuild";
import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

    setup(build: { onStart: (arg0: () => void) => void; onEnd: (arg0: (result: esbuild.BuildResult) => void) => void; }) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            });
            console.log('[watch] build finished');
        });
	},
};


/**
 * After build, copy the Claude CLI and its runtime assets from the SDK package
 * into resources/claude-code/ so they are bundled in the VSIX without being
 * committed to the repository.
 * @type {import('esbuild').Plugin}
 */
const copyClaudeCliPlugin = {
    name: 'copy-claude-cli',
    setup(build: { onEnd: (arg0: () => Promise<void>) => void; }) {
        const require = createRequire(import.meta.url);
        build.onEnd(async () => {
            try {
                const pkgDir = path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk/cli.js'));
                const outDir = path.resolve(process.cwd(), 'resources/claude-code');
                await fs.mkdir(outDir, { recursive: true });

                // copy cli.js
                const cliSrc = path.join(pkgDir, 'cli.js');
                const cliDst = path.join(outDir, 'cli.js');
                await fs.copyFile(cliSrc, cliDst);
                console.log(`[build] Copied Claude CLI -> ${path.relative(process.cwd(), cliDst)}`);

                // copy all .wasm files (resvg.wasm, tree-sitter.wasm, tree-sitter-bash.wasm, etc.)
                const entries = await fs.readdir(pkgDir);
                for (const entry of entries) {
                    if (entry.endsWith('.wasm')) {
                        await fs.copyFile(path.join(pkgDir, entry), path.join(outDir, entry));
                        console.log(`[build] Copied ${entry}`);
                    }
                }

                // copy vendor directory (platform-specific ripgrep binaries)
                const vendorSrc = path.join(pkgDir, 'vendor');
                try {
                    const st = await fs.stat(vendorSrc);
                    if (st.isDirectory()) {
                        await copyDir(vendorSrc, path.join(outDir, 'vendor'));
                        console.log('[build] Copied vendor/ directory');
                    }
                } catch {}
            } catch (err: any) {
                console.warn('[build] copy-claude-cli failed:', err?.message || err);
            }
        });
    },
};

async function copyDir(src: string, dst: string) {
    await fs.mkdir(dst, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const ent of entries) {
        const s = path.join(src, ent.name);
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) {
            await copyDir(s, d);
        } else if (ent.isFile()) {
            await fs.copyFile(s, d);
        }
    }
}

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
    outfile: 'dist/extension.cjs',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			copyClaudeCliPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
