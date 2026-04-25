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
 * After build, copy the Claude native binaries from the platform-specific SDK
 * packages into resources/native-binaries/{platform}-{arch}/ so they are
 * bundled in the VSIX without being committed to the repository.
 *
 * The new @anthropic-ai/claude-agent-sdk (>=0.2.x) ships a native executable
 * per platform via optional dependencies named
 *   @anthropic-ai/claude-agent-sdk-{platform}-{arch}
 * e.g. @anthropic-ai/claude-agent-sdk-darwin-arm64
 *
 * ClaudeSdkService.getClaudeExecutablePath() checks
 *   resources/native-binaries/{platform}-{arch}/claude[.exe]
 * first, so copying here is all that's needed.
 * @type {import('esbuild').Plugin}
 */
const copyClaudeCliPlugin = {
    name: 'copy-claude-cli',
    setup(build: { onEnd: (arg0: () => Promise<void>) => void; }) {
        build.onEnd(async () => {
            try {
                // Read the manifest to discover which platforms the SDK supports.
                const sdkDir = path.resolve(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk');
                const manifestPath = path.join(sdkDir, 'manifest.json');
                const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                // platforms is an object keyed by platform name in the new SDK format
                const platforms: string[] = Array.isArray(manifest.platforms)
                    ? manifest.platforms
                    : Object.keys(manifest.platforms ?? {});

                let copied = 0;
                for (const platform of platforms) {
                    const pkgName = `@anthropic-ai/claude-agent-sdk-${platform}`;
                    const pkgDir = path.resolve(process.cwd(), 'node_modules', pkgName);

                    // Use binary name from manifest if available, otherwise infer from platform.
                    const manifestEntry = !Array.isArray(manifest.platforms) ? manifest.platforms[platform] : null;
                    const binaryName = manifestEntry?.binary ?? (platform.startsWith('win32') ? 'claude.exe' : 'claude');
                    const src = path.join(pkgDir, binaryName);

                    try {
                        await fs.access(src);
                    } catch {
                        // Package not installed (expected – npm only installs the current platform's package)
                        continue;
                    }

                    const outDir = path.resolve(process.cwd(), 'resources/native-binaries', platform);
                    await fs.mkdir(outDir, { recursive: true });
                    const dst = path.join(outDir, binaryName);
                    await fs.copyFile(src, dst);

                    // Ensure the binary is executable on non-Windows.
                    if (!platform.startsWith('win32')) {
                        await fs.chmod(dst, 0o755);
                    }

                    console.log(`[build] Copied Claude binary (${platform}) -> ${path.relative(process.cwd(), dst)}`);
                    copied++;
                }

                if (copied === 0) {
                    console.warn('[build] copy-claude-cli: no platform binary packages found in node_modules');
                }
            } catch (err: any) {
                console.warn('[build] copy-claude-cli failed:', err?.message || err);
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
