/**
 * EventEmitter -
 *
 * Tool /
 */
export class EventEmitter<T = any> {
    private callbacks: Array<(data: T) => void> = [];

    /**
     * @param callback
     * @returns
     */
    add(callback: (data: T) => void): () => void {
        this.callbacks.push(callback);

        return () => {
            const index = this.callbacks.indexOf(callback);
            if (index !== -1) {
                this.callbacks.splice(index, 1);
            }
        };
    }

    /**
     * @param data
     */
    emit(data: T): void {
        for (const callback of this.callbacks) {
            try {
                callback(data);
            } catch (error) {
                console.error('[EventEmitter] Callback error:', error);
            }
        }
    }

    /**
     */
    clear(): void {
        this.callbacks = [];
    }

    /**
     */
    get listenerCount(): number {
        return this.callbacks.length;
    }
}
