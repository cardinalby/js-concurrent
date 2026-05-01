/**
 * Task is a function that starts a cancellable asynchronous operation
 */
export type Task<T> = (signal: AbortSignal) => Promise<T>
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

/**
 * ConcurrentTaskFailedError is thrown when a task running concurrently with others fails.
 * It wraps the original error as its cause.
 * Is returned by allWithAbort when any task fails.
 */
export class ConcurrentTaskFailedError extends Error {
    public readonly cause: any;

    constructor(cause: any) {
        super("Concurrent task failed");
        this.name = 'ConcurrentTaskFailedError';
        this.cause = cause;
    }
}