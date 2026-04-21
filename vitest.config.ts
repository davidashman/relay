/**
 * Vitest Test Configuration
 */

import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['**/*.spec.ts', '**/*.spec.tsx'],
		exclude: ['**/node_modules/**', '**/dist/**'],
		globals: true,
		environment: 'node',
	},
	resolve: {
		alias: {
			// Mock vscode module for tests
			vscode: path.resolve(__dirname, 'test/mocks/vscode.ts')
		}
	}
});
