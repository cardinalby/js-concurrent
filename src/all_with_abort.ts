import {Semaphore} from "./semaphore";
import {ConcurrentTaskFailedError, Task, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {createGroupAc} from "./group_abort_controller";

/**
 * allWithAbort is similar to Promise.all() but receives Tasks and runs all provided tasks concurrently,
 * respecting `options.concurrencyLimit`.
 * If any task fails, or `options.signal` is aborted:
 * - all other running tasks are aborted and new tasks are not started
 * - the resulting Promise is rejected with the first error or abort reason.
 * The result array has the same length as the input tasks, with each result
 * corresponding to the task at the same index
 */
export function allWithAbort<T extends readonly Task<unknown>[] | []>(
    tasks: T,
    options?: RunOptions
): Promise<{ -readonly [P in keyof T]: Awaited<ReturnType<T[P]>> }>;

/**
 * allWithAbort is similar to Promise.all() but receives Tasks and runs all provided tasks concurrently,
 * respecting the provided RunOptions. If any task fails, all other running tasks are aborted (or never started),
 * and the resulting Promise is rejected. The result array has the same length as the input tasks, with each result
 * corresponding to the task at the same index
 */
export function allWithAbort<T>(
    tasks: Iterable<Task<T>>,
    options?: RunOptions
): Promise<Awaited<T>[]>;

export async function allWithAbort(
    tasks: Iterable<Task<any>>,
    options: RunOptions = {}
): Promise<Awaited<any>[]> {
    // copy the signal in case options is mutated during execution
    const signal = options.signal
    if (signal?.aborted) {
        return Promise.reject(signal.reason)
    }
    const groupAc = createGroupAc(options.signal)

    // noinspection ES6MissingAwait
    const resultsPromise = options.concurrencyLimit === undefined || options.concurrencyLimit <= 0
        ? allWithAbortUnlimited(tasks, groupAc)
        : allWithAbortLimited(tasks, new Semaphore(options.concurrencyLimit), groupAc)

    try {
        return await raceWithAbortSignal(resultsPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function allWithAbortUnlimited(
    tasks: Iterable<Task<any>>,
    ac: AbortController,
): Promise<Awaited<any>[]> {
    const promises: Promise<any>[] = []
    let hasFirstError = false
    let firstError: any = null

    for (const task of tasks) {
        promises.push(task(ac.signal).catch(reason => {
            if (!hasFirstError) {
                hasFirstError = true;
                firstError = reason;
            }
            if (!ac.signal.aborted) {
                ac.abort(new ConcurrentTaskFailedError(reason));
            }
            throw reason
        }))
    }
    return Promise.all(promises).catch(() => {
        // We only care about the first error
        throw firstError;
    })
}

function allWithAbortLimited(
    tasks: Iterable<Task<any>>,
    semaphore: Semaphore,
    ac: AbortController,
): Promise<Awaited<any>[]> {
    const promises: Promise<any>[] = []
    let hasFirstError = false
    let firstError: any = null

    for (const task of tasks) {
        const p = semaphore.acquire(ac.signal)
            .then(async () => {
                try {
                    try {
                        return await task(ac.signal);
                    } catch (reason) {
                        if (!hasFirstError) {
                            hasFirstError = true;
                            firstError = reason;
                        }
                        if (!ac.signal.aborted) {
                            ac.abort(new ConcurrentTaskFailedError(reason));
                        }
                        throw reason;
                    }
                } finally {
                    semaphore.release();
                }
            })
        promises.push(p)
    }
    return Promise.all(promises).catch(() => {
        // We only care about the first error
        throw firstError;
    })
}