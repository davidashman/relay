import esbuild from "esbuild";
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
 * Copy node-pty and its prebuilt native binaries into resources/node-pty/ so
 * they are bundled in the VSIX without relying on node_modules being present.
 * ClaudeTerminalService resolves the path via context.extensionPath at runtime.
 */
const copyNodePtyPlugin = {
    name: 'copy-node-pty',
    setup(build: { onEnd: (arg0: () => Promise<void>) => void }) {
        build.onEnd(async () => {
            try {
                const src = path.resolve(process.cwd(), 'node_modules', 'node-pty');
                const dst = path.resolve(process.cwd(), 'resources', 'node-pty');
                await fs.cp(src, dst, { recursive: true, force: true });
                console.log('[build] Copied node-pty -> resources/node-pty');
            } catch (err: any) {
                console.warn('[build] copy-node-pty failed:', err?.message || err);
            }
        });
    },
};



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
			copyNodePtyPlugin,
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
