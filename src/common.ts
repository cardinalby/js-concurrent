export type RunOptions = {
    /**
     * Maximum number of tasks to run concurrently. If not specified or <= 0, all tasks will run concurrently
     */
    concurrency?: number

    /**
     * AbortSignal to cancel the entire group of tasks
     */
    signal?: AbortSignal
}

/**
 * ConcurrentTaskFailedError is thrown when a task running concurrently with others fails.
 * It wraps the original error as its cause.
 * Is returned by Task.all when any task fails.
 */
export class ConcurrentTaskFailedError extends Error {
    public readonly cause: any;

    constructor(cause: any) {
        super("Concurrent task failed");
        this.name = 'ConcurrentTaskFailedError';
        this.cause = cause;
    }
}

/**
 * Internal callable shape used by the concurrency implementations.
 * The public Task<T> interface (callable + constructor + statics) is in task.ts.
 * These are structurally identical so Task<T> satisfies TaskFn<T> and vice versa.
 * @internal
 */
export type TaskFn<T> = (signal: AbortSignal) => Promise<T>
