/**
 * Notification Service
 */

import * as vscode from 'vscode';
import { createDecorator } from '../di/instantiation';

export const INotificationService = createDecorator<INotificationService>('notificationService');

export interface INotificationService {
	readonly _serviceBrand: undefined;
	showInformation(message: string, ...items: string[]): Thenable<string | undefined>;
	showWarning(message: string, ...items: string[]): Thenable<string | undefined>;
	showError(message: string, ...items: string[]): Thenable<string | undefined>;
}

export class NotificationService implements INotificationService {
	readonly _serviceBrand: undefined;

	private isNotificationEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('relay');
		return config.get<boolean>('showNotifications', true);
	}

	showInformation(message: string, ...items: string[]): Thenable<string | undefined> {
		if (!this.isNotificationEnabled()) {
			return Promise.resolve(undefined);
		}
		return vscode.window.showInformationMessage(message, ...items);
	}

	showWarning(message: string, ...items: string[]): Thenable<string | undefined> {
		if (!this.isNotificationEnabled()) {
			return Promise.resolve(undefined);
		}
		return vscode.window.showWarningMessage(message, ...items);
	}

	showError(message: string, ...items: string[]): Thenable<string | undefined> {
		if (!this.isNotificationEnabled()) {
			return Promise.resolve(undefined);
		}
		return vscode.window.showErrorMessage(message, ...items);
	}
}
