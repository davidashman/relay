/**
 * FileSystem Service
 * File operation wrappers + file search functionality
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile, ExecFileException } from 'child_process';
import Fuse from 'fuse.js';
import { createDecorator } from '../di/instantiation';

/**
 * Check if error is an ExecFileException
 */
function isExecException(error: unknown): error is ExecFileException {
	return error instanceof Error && ('code' in error || 'signal' in error);
}

export const IFileSystemService = createDecorator<IFileSystemService>('fileSystemService');

/**
 * File search result entry
 */
export interface FileSearchResult {
	path: string;      // relative path
	name: string;      // filename
	type: 'file' | 'directory';
}

/**
 * Ripgrep execution result
 */
interface RipgrepResult {
	absolute: string;  // absolute path
	relative: string;  // relative path
}

export interface IFileSystemService {
	readonly _serviceBrand: undefined;

	readFile(uri: vscode.Uri): Thenable<Uint8Array>;
	writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
	delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void>;
	rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Thenable<void>;
	createDirectory(uri: vscode.Uri): Thenable<void>;
	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
	stat(uri: vscode.Uri): Thenable<vscode.FileStat>;

	/**
	 * List files using Ripgrep (no search, returns raw list)
	 * @param cwd working directory
	 * @returns array of file paths (relative)
	 */
	listFilesWithRipgrep(cwd: string): Promise<string[]>;

	/**
	 * Search files (full pipeline: Ripgrep + directory extraction + Fuse.js)
	 * @param pattern search pattern
	 * @param cwd working directory
	 * @returns array of file search results
	 */
	searchFiles(pattern: string, cwd: string): Promise<FileSearchResult[]>;

	/**
	 * Search files using VSCode API (Ripgrep fallback)
	 * @param pattern search pattern
	 * @param cwd working directory
	 * @returns array of file search results
	 */
	searchFilesWithWorkspace(pattern: string, cwd: string): Promise<FileSearchResult[]>;

	/**
	 * Extract all parent directories from file path list (aligned with official implementation)
	 * @param filePaths array of file paths (relative)
	 * @returns deduplicated array of directory paths (relative, with / suffix)
	 */
	extractParentDirectories(filePaths: string[]): string[];

	/**
	 * Get workspace top-level directories (for empty queries)
	 * @param cwd working directory
	 * @returns array of top-level directories
	 */
	getTopLevelDirectories(cwd: string): Promise<FileSearchResult[]>;

	/**
	 * Normalize to absolute path
	 * @param filePath file path (absolute or relative)
	 * @param cwd working directory
	 * @returns normalized absolute path
	 */
	normalizeAbsolutePath(filePath: string, cwd: string): string;

	/**
	 * Convert to workspace-relative path
	 * @param absolutePath absolute path
	 * @param cwd working directory
	 * @returns relative path
	 */
	toWorkspaceRelative(absolutePath: string, cwd: string): string;

	/**
	 * Resolve file path (supports ~ expansion and relative paths)
	 * @param filePath file path
	 * @param cwd working directory
	 * @returns normalized absolute path
	 */
	resolveFilePath(filePath: string, cwd: string): string;

	/**
	 * Check if path exists
	 * @param target target path
	 * @returns whether it exists
	 */
	pathExists(target: string): Promise<boolean>;

  /**
   * Check if file is executable
   * @param target target path
   * @returns whether it is executable
   */
  isExecutable(target: string): Promise<boolean>;

	/**
	 * Sanitize filename (remove illegal characters)
	 * @param fileName original filename
	 * @returns sanitized filename
	 */
	sanitizeFileName(fileName: string): string;

	/**
	 * Create temporary file
	 * @param fileName filename
	 * @param content file content
	 * @returns temporary file path
	 */
	createTempFile(fileName: string, content: string): Promise<string>;

	/**
	 * Resolve and find an existing path (with fuzzy search)
	 * @param filePath file path
	 * @param cwd working directory
	 * @param searchResults optional search results (if provided, fuzzy matching is used)
	 * @returns absolute path of the existing file
	 */
	resolveExistingPath(filePath: string, cwd: string, searchResults?: FileSearchResult[]): Promise<string>;

	/**
	 * Find files (complete business logic)
	 * - Empty query returns top-level content (directories + top-level files)
	 * - Non-empty query: Ripgrep + directory extraction + Fuse.js
	 * - Automatically falls back to VSCode API
	 * @param pattern search pattern (optional, empty query returns top-level content)
	 * @param cwd working directory
	 * @returns array of file search results
	 */
	findFiles(pattern: string | undefined, cwd: string): Promise<FileSearchResult[]>;
}

export class FileSystemService implements IFileSystemService {
	readonly _serviceBrand: undefined;

	// Ripgrep command cache
	private ripgrepCommandCache: { command: string; args: string[] } | null = null;

	// ===== Basic file operations =====

	readFile(uri: vscode.Uri): Thenable<Uint8Array> {
		return vscode.workspace.fs.readFile(uri);
	}

	writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void> {
		return vscode.workspace.fs.writeFile(uri, content);
	}

	delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void> {
		return vscode.workspace.fs.delete(uri, options);
	}

	rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Thenable<void> {
		return vscode.workspace.fs.rename(source, target, options);
	}

	createDirectory(uri: vscode.Uri): Thenable<void> {
		return vscode.workspace.fs.createDirectory(uri);
	}

	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
		return vscode.workspace.fs.readDirectory(uri);
	}

	stat(uri: vscode.Uri): Thenable<vscode.FileStat> {
		return vscode.workspace.fs.stat(uri);
	}

	// ===== File search functionality (aligned with official implementation) =====

	/**
	 * List all files using Ripgrep (no search, returns raw list)
	 */
	async listFilesWithRipgrep(cwd: string): Promise<string[]> {
		// 1. Build ripgrep arguments
		const args = ['--files', '--follow', '--hidden'];

		// 2. Add exclusion rules
		const excludeGlobs = this.buildExcludePatterns();
		for (const glob of excludeGlobs) {
			args.push('--glob', `!${glob}`);
		}

		// 3. Execute ripgrep, return raw file path list
		const rawPaths = await this.execRipgrep(args, cwd);

		// 4. Convert to relative paths
		return rawPaths.map(rawPath => {
			const absolute = this.normalizeAbsolutePath(rawPath.replace(/^\.\//, ''), cwd);
			return this.toWorkspaceRelative(absolute, cwd);
		});
	}

	/**
	 * Search files (full pipeline, aligned with official implementation)
	 * 1. Ripgrep lists all files
	 * 2. Extract parent directories
	 * 3. Merge [directories, files]
	 * 4. Fuse.js fuzzy search over the combined list
	 */
	async searchFiles(pattern: string, cwd: string): Promise<FileSearchResult[]> {
		// 1. Get file list with Ripgrep
		const files = await this.listFilesWithRipgrep(cwd);

		// 2. Extract all parent directories (with / suffix)
		const directories = this.extractParentDirectories(files);

		// 3. Merge: [directories first, files after]
		const allPaths = [...directories, ...files];

		// 4. Fuse.js search over entire list (aligned with official)
		return this.fuseSearchPaths(allPaths, pattern);
	}

	/**
	 * Search files using VSCode API (fallback)
	 */
	async searchFilesWithWorkspace(pattern: string, cwd: string): Promise<FileSearchResult[]> {
		const include = pattern.includes('*') || pattern.includes('?')
			? pattern
			: `**/*${pattern}*`;

		// Auto-build exclusion patterns
		const excludePatterns = this.buildExcludePatterns();
		const excludeGlob = this.toExcludeGlob(excludePatterns);

		const uris = await vscode.workspace.findFiles(include, excludeGlob, 100);

		return uris.map(uri => {
			const fsPath = uri.fsPath;
			const relative = this.toWorkspaceRelative(fsPath, cwd);
			return {
				path: relative,
				name: path.basename(fsPath),
				type: 'file' as const  // VSCode findFiles also only returns files
			};
		});
	}

	/**
	 * Extract all parent directories from file path list (fully aligned with official implementation)
	 */
	extractParentDirectories(filePaths: string[]): string[] {
		const dirSet = new Set<string>();

		filePaths.forEach(filePath => {
			let current = path.dirname(filePath);

			// Traverse upward, adding all parent directories
			while (current !== '.' && current !== path.parse(current).root) {
				dirSet.add(current);
				current = path.dirname(current);
			}
		});

		// Return directory list, add / suffix to mark as directory
		return Array.from(dirSet).map(dir => dir + path.sep);
	}

	/**
	 * Get workspace top-level directories (for empty queries)
	 */
	async getTopLevelDirectories(cwd: string): Promise<FileSearchResult[]> {
		const workspaceUri = vscode.Uri.file(cwd);

		try {
			const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
			const results: FileSearchResult[] = [];

			for (const [name, type] of entries) {
				if (type === vscode.FileType.Directory) {
					results.push({
						path: name,
						name: name,
						type: 'directory'
					});
				}
			}

			return results.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			return [];
		}
	}

	/**
	 * Get workspace top-level content (directories + top-level files, for empty queries)
	 */
	async getTopLevelContents(cwd: string): Promise<FileSearchResult[]> {
		try {
			const files = await this.listFilesWithRipgrep(cwd);
			const directories = this.extractParentDirectories(files);
			const allPaths = [...directories, ...files];

			return this.extractTopLevelItems(allPaths);

		} catch (error) {
			// Ripgrep failed, falling back to VSCode API
			console.warn('[FileSystemService] Ripgrep failed in getTopLevelContents, falling back to readDirectory:', error);

			try {
				const workspaceUri = vscode.Uri.file(cwd);
				const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
				const results: FileSearchResult[] = [];

				for (const [name, type] of entries) {
					if (type === vscode.FileType.Directory) {
						results.push({ path: name, name: name, type: 'directory' });
					} else if (type === vscode.FileType.File) {
						results.push({ path: name, name: name, type: 'file' });
					}
				}

				return results.sort((a, b) => {
					if (a.type === 'directory' && b.type === 'file') return -1;
					if (a.type === 'file' && b.type === 'directory') return 1;
					return a.name.localeCompare(b.name);
				});
			} catch (fallbackError) {
				console.error('[FileSystemService] getTopLevelContents fallback also failed:', fallbackError);
				return [];
			}
		}
	}

	/**
	 * Extract top-level items
	 * Extracts first-level paths from all paths and determines if each is a directory
	 */
	extractTopLevelItems(allPaths: string[]): FileSearchResult[] {
		const topLevelSet = new Set<string>();
		const maxItems = 200;

		for (const filePath of allPaths) {
			const firstLevel = filePath.split(path.sep)[0];
			if (firstLevel) {
				topLevelSet.add(firstLevel);
				if (topLevelSet.size >= maxItems) break;
			}
		}

		return Array.from(topLevelSet).sort().map(topLevel => {
			const hasChildren = allPaths.some(p => p.startsWith(topLevel + path.sep));

			return {
				path: hasChildren ? topLevel + path.sep : topLevel,
				name: path.basename(topLevel),
				type: hasChildren ? 'directory' as const : 'file' as const
			};
		});
	}

	// ===== Private helper methods =====

	/**
	 * Execute Ripgrep command (aligned with official implementation)
	 */
	private execRipgrep(args: string[], cwd: string): Promise<string[]> {
		const { command, args: defaultArgs } = this.getRipgrepCommand();

		return new Promise((resolve, reject) => {
			execFile(command, [...defaultArgs, ...args], {
				cwd,
				maxBuffer: 20 * 1024 * 1024,  // 20MB (aligned with official)
				timeout: 10_000                // 10s (aligned with official)
			}, (error, stdout) => {
				// No error, return normally
				if (!error) {
					resolve(stdout.split(/\r?\n/).filter(Boolean));
					return;
				}

				// Use type guard to safely access error properties
				if (isExecException(error)) {
					// code === 1 means no matches, not an error
					if (error.code === 1) {
						resolve([]);
						return;
					}

					// Timeout or buffer overflow but has partial results
					const hasOutput = stdout && stdout.trim().length > 0;
					if ((error.signal === 'SIGTERM' || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') && hasOutput) {
						const lines = stdout.split(/\r?\n/).filter(Boolean);
						// Remove potentially incomplete last line
						resolve(lines.length > 0 ? lines.slice(0, -1) : []);
						return;
					}
				}

				reject(error);
			});
		});
	}

	/**
	 * Get Ripgrep command path (aligned with official implementation, skips system detection)
	 */
	private getRipgrepCommand(): { command: string; args: string[] } {
		if (this.ripgrepCommandCache) {
			return this.ripgrepCommandCache;
		}

		// Use extension's built-in ripgrep directly (skip system detection)
		const rootDir = path.resolve(__dirname, '..', '..', '..');
		const vendorDir = path.join(rootDir, 'vendor', 'ripgrep');

		let command: string;
		if (process.platform === 'win32') {
			command = path.join(vendorDir, 'x64-win32', 'rg.exe');
		} else {
			const platformKey = `${process.arch}-${process.platform}`;
			command = path.join(vendorDir, platformKey, 'rg');
		}

		// If built-in ripgrep doesn't exist, fall back to system ripgrep
		try {
			require('fs').accessSync(command, require('fs').constants.X_OK);
		} catch {
			command = 'rg';
		}

		this.ripgrepCommandCache = { command, args: [] };
		return this.ripgrepCommandCache;
	}

	/**
	 * Use Fuse.js for fuzzy search over path list (fully aligned with official config)
	 * @param paths path list (relative, directories with / suffix)
	 * @param pattern search pattern
	 * @returns search results
	 */
	private fuseSearchPaths(paths: string[], pattern: string): FileSearchResult[] {
		// 1. Prepare data items
		const items = paths.map(filePath => {
			const isDirectory = filePath.endsWith(path.sep);
			const cleanPath = isDirectory ? filePath.slice(0, -1) : filePath;

			return {
				path: filePath,
				filename: path.basename(cleanPath),
				testPenalty: cleanPath.includes('test') || cleanPath.includes('spec') ? 1 : 0,
				isDirectory
			};
		});

		// 2. If search term contains path separator, filter to keep only items with same parent directory
		const lastSep = pattern.lastIndexOf(path.sep);
		let filteredItems = items;

		if (lastSep > 2) {
			const dirPrefix = pattern.substring(0, lastSep);
			filteredItems = items.filter(item =>
				item.path.substring(0, lastSep).startsWith(dirPrefix)
			);
		}

		// 3. Use Fuse.js for fuzzy search (fully aligned with official config)
		const fuse = new Fuse(filteredItems, {
			includeScore: true,
			threshold: 0.5,
			keys: [
				{ name: 'path', weight: 1 },
				{ name: 'filename', weight: 2 }  // filename has higher weight
			]
		});

		const results = fuse.search(pattern, { limit: 100 });

		// 4. Secondary sort: if score difference > 0.05, sort by score; otherwise test files rank lower
		const sorted = results.sort((a, b) => {
			const scoreA = a.score ?? 0;
			const scoreB = b.score ?? 0;

			if (Math.abs(scoreA - scoreB) > 0.05) {
				return scoreA - scoreB;
			}
			return a.item.testPenalty - b.item.testPenalty;
		});

		// 5. Convert to result format (limit 100)
		return sorted.slice(0, 100).map(r => {
			const cleanPath = r.item.isDirectory ? r.item.path.slice(0, -1) : r.item.path;

			return {
				path: cleanPath,
				name: r.item.filename,
				type: r.item.isDirectory ? 'directory' : 'file'
			};
		});
	}

	/**
	 * Normalize absolute path (public method, for handlers)
	 */
	normalizeAbsolutePath(filePath: string, cwd: string): string {
		return path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.normalize(path.join(cwd, filePath));
	}

	/**
	 * Convert to workspace-relative path (public method, for handlers)
	 */
	toWorkspaceRelative(absolutePath: string, cwd: string): string {
		const normalized = path.normalize(absolutePath);
		const normalizedCwd = path.normalize(cwd);

		if (normalized.startsWith(normalizedCwd)) {
			return normalized.substring(normalizedCwd.length + 1);
		}

		return normalized;
	}

	/**
	 * Resolve file path (supports ~ expansion and relative paths)
	 */
	resolveFilePath(filePath: string, cwd: string): string {
		if (!filePath) {
			return cwd;
		}

		// Expand ~ to user home directory
		const expanded = filePath.startsWith('~')
			? path.join(require('os').homedir(), filePath.slice(1))
			: filePath;

		// Convert to absolute path
		const absolute = path.isAbsolute(expanded)
			? expanded
			: path.join(cwd, expanded);

		return path.normalize(absolute);
	}

  /**
   * Check if file is executable
   * @param target target path
   * @returns whether it is executable
   */
  async isExecutable(target: string): Promise<boolean> {
    try {
      await require('fs').promises.access(target, require('fs').constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

	/**
	 * Check if path exists
	 */
	async pathExists(target: string): Promise<boolean> {
		try {
			await require('fs').promises.access(target, require('fs').constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Sanitize filename (remove illegal characters)
	 */
	sanitizeFileName(fileName: string): string {
		const fallback = fileName && fileName.trim() ? fileName.trim() : 'claude.txt';
		return fallback.replace(/[<>:"\\/|?*\x00-\x1F]/g, '_');
	}

	/**
	 * Create temporary file
	 */
	async createTempFile(fileName: string, content: string): Promise<string> {
		const tempDir = await require('fs').promises.mkdtemp(
			path.join(require('os').tmpdir(), 'claude-')
		);
		const sanitized = this.sanitizeFileName(fileName);
		const filePath = path.join(tempDir, sanitized);
		await require('fs').promises.writeFile(filePath, content, 'utf8');
		return filePath;
	}

	/**
	 * Resolve and find an existing path (with fuzzy search)
	 */
	async resolveExistingPath(filePath: string, cwd: string, searchResults?: FileSearchResult[]): Promise<string> {
		// 1. Try resolving path directly
		const absoluteCandidate = this.resolveFilePath(filePath, cwd);
		if (await this.pathExists(absoluteCandidate)) {
			return absoluteCandidate;
		}

		// 2. If search results provided, use the first match
		if (searchResults && searchResults.length > 0) {
			const candidate = searchResults[0].path;
			const absolute = this.resolveFilePath(candidate, cwd);
			if (await this.pathExists(absolute)) {
				return absolute;
			}
		}

		// 3. Return original candidate path (even if it doesn't exist)
		return absoluteCandidate;
	}

	/**
	 * Find files (complete business logic)
	 */
	async findFiles(pattern: string | undefined, cwd: string): Promise<FileSearchResult[]> {
		// Empty query returns top-level content (directories + top-level files)
		if (!pattern || !pattern.trim()) {
			return await this.getTopLevelContents(cwd);
		}

		// Queries containing "/" treat the part before the last "/" as an explicit directory,
		// and the part after as a fuzzy match term on direct children of that directory.
		// Falls back to workspace fuzzy search if the directory doesn't exist.
		if (/[\/\\]/.test(pattern)) {
			const scoped = await this.tryDirectoryScopedSearch(pattern, cwd);
			if (scoped) return scoped;
		}

		// Other patterns use the full search pipeline (Ripgrep + directory extraction + Fuse.js)
		try {
			return await this.searchFiles(pattern, cwd);
		} catch (error) {
			// Ripgrep failed, falling back to VSCode API
			console.warn(`[FileSystemService] Ripgrep search failed, falling back to VSCode API:`, error);

			try {
				return await this.searchFilesWithWorkspace(pattern, cwd);
			} catch (fallbackError) {
				console.error(`[FileSystemService] Fallback search also failed:`, fallbackError);
				return [];
			}
		}
	}

	/**
	 * Search within an explicitly given subdirectory (called by findFiles for queries containing "/").
	 *
	 * Splits on the last "/":
	 *   - The prefix is treated as an explicit directory (must resolve to a real directory within the workspace).
	 *   - The suffix is treated as a fuzzy match term on direct child names; empty suffix returns all children.
	 *
	 * Returns undefined when the directory doesn't exist or the path is out of bounds;
	 * the caller should fall back to another search strategy.
	 */
	private async tryDirectoryScopedSearch(
		pattern: string,
		cwd: string
	): Promise<FileSearchResult[] | undefined> {
		// Find the last path separator (supports / and \)
		const lastSep = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf('\\'));
		if (lastSep < 0) return undefined;

		const rawDir = pattern.substring(0, lastSep);
		const term = pattern.substring(lastSep + 1);

		// Normalize relative directory path (unify separators and collapse . / ..)
		const relDirNormalized = path.normalize(rawDir.replace(/[\\/]+/g, path.sep));

		// Only process relative directories within cwd to prevent path traversal
		if (!relDirNormalized || path.isAbsolute(relDirNormalized)) return undefined;
		if (relDirNormalized === '..' || relDirNormalized.startsWith('..' + path.sep)) return undefined;

		const absDir = path.normalize(path.join(cwd, relDirNormalized));
		const normalizedCwd = path.normalize(cwd);
		if (absDir !== normalizedCwd && !absDir.startsWith(normalizedCwd + path.sep)) {
			return undefined;
		}

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(absDir));
		} catch {
			return undefined;
		}

		const children: FileSearchResult[] = [];
		for (const [name, type] of entries) {
			if (type === vscode.FileType.Directory) {
				children.push({
					path: path.join(relDirNormalized, name),
					name,
					type: 'directory'
				});
			} else if (type === vscode.FileType.File) {
				children.push({
					path: path.join(relDirNormalized, name),
					name,
					type: 'file'
				});
			}
		}

		// No filter term: directories first, files after, sorted by name ascending
		if (!term) {
			return children.sort((a, b) => {
				if (a.type === 'directory' && b.type === 'file') return -1;
				if (a.type === 'file' && b.type === 'directory') return 1;
				return a.name.localeCompare(b.name);
			});
		}

		// With filter term: fuzzy match on child item names, sorted by score
		const fuse = new Fuse(children, {
			includeScore: true,
			threshold: 0.5,
			keys: ['name']
		});
		return fuse.search(term).map(r => r.item);
	}

	/**
	 * Build exclusion pattern array (from VSCode config and .gitignore)
	 * Private method, for internal use by searchFilesWithRipgrep
	 */
	private buildExcludePatterns(): string[] {
		const patterns = new Set<string>([
			'**/node_modules/**',
			'**/.git/**',
			'**/dist/**',
			'**/build/**',
			'**/.next/**',
			'**/.nuxt/**',
			'**/.DS_Store',
			'**/Thumbs.db',
			'**/*.log',
			'**/.env',
			'**/.env.*'
		]);

		try {
			const searchConfig = vscode.workspace.getConfiguration('search');
			const filesConfig = vscode.workspace.getConfiguration('files');
			const searchExclude = searchConfig.get<Record<string, boolean>>('exclude') ?? {};
			const filesExclude = filesConfig.get<Record<string, boolean>>('exclude') ?? {};

			for (const [glob, enabled] of Object.entries(searchExclude)) {
				if (enabled && typeof glob === 'string' && glob.length > 0) {
					patterns.add(glob);
				}
			}

			for (const [glob, enabled] of Object.entries(filesExclude)) {
				if (enabled && typeof glob === 'string' && glob.length > 0) {
					patterns.add(glob);
				}
			}

			const useIgnoreFiles = searchConfig.get<boolean>('useIgnoreFiles', true);
			if (useIgnoreFiles) {
				const folders = vscode.workspace.workspaceFolders;
				if (folders) {
					for (const folder of folders) {
						const gitignorePatterns = this.readGitignoreFile(path.join(folder.uri.fsPath, '.gitignore'));
						gitignorePatterns.forEach(p => patterns.add(p));
					}
				}
				const globalPatterns = this.readGitignoreFile(path.join(require('os').homedir(), '.config', 'git', 'ignore'));
				globalPatterns.forEach(p => patterns.add(p));
			}
		} catch {
			// ignore errors
		}

		return Array.from(patterns);
	}

	/**
	 * Read and parse gitignore file
	 */
	private readGitignoreFile(filePath: string): string[] {
		try {
			if (require('fs').existsSync(filePath)) {
				const content = require('fs').readFileSync(filePath, 'utf8');
				return this.parseGitignore(content);
			}
		} catch {
			// ignore errors
		}
		return [];
	}

	/**
	 * Parse .gitignore content
	 */
	private parseGitignore(content: string): string[] {
		const results: string[] = [];

		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#') || line.startsWith('!')) {
				continue;
			}

			let transformed = line;
			if (transformed.endsWith('/')) {
				transformed = `${transformed.slice(0, -1)}/**`;
			}
			if (transformed.startsWith('/')) {
				transformed = transformed.slice(1);
			} else {
				transformed = `**/${transformed}`;
			}
			results.push(transformed);
		}

		return results;
	}

	/**
	 * Convert exclusion pattern array to glob string
	 * Private method, for internal use by searchFilesWithWorkspace
	 */
	private toExcludeGlob(patterns: string[]): string | undefined {
		if (patterns.length === 0) {
			return undefined;
		}
		if (patterns.length === 1) {
			return patterns[0];
		}
		return `{${patterns.join(',')}}`;
	}
}
