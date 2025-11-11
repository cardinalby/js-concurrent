/**
 * ErrGroupTask is a function that starts an asynchronous task that can be aborted via an AbortSignal
 */
export type ErrGroupTask<T> = (abortSignal?: AbortSignal) => Promise<T>
export type RunOptions = {
    /**
     * Maximum number of tasks to run concurrently. If not specified or <= 0, all tasks will run concurrently
     */
    concurrencyLimit?: number

    /**
     * AbortSignal to cancel the entire group of tasks
     */
    signal?: AbortSignal
}

export class ConcurrentTaskFailedError extends Error {
    public readonly cause: any;

    constructor(cause: any) {
        super("Concurrent task failed");
        this.name = 'ConcurrentTaskFailedError';
        this.cause = cause;
    }
}