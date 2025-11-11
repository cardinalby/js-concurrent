import {Semaphore} from "./semaphore";
import {Task, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {createGroupAc} from "./group_abort_controller";

/**
 * allSettledWithAbort is similar to Promise.allSettled() but receives Tasks and runs all provided tasks
 * concurrently, respecting `options.concurrencyLimit`.
 * Unlike allWithAbort, task failures do NOT abort other tasks - all tasks run to completion unless:
 * `options.signal` is aborted, in which case all running tasks are aborted and new tasks are not started.
 * Tasks that are not started due to abort are marked as rejected with the abort reason.
 * The resulting Promise resolves with an array of settled results (fulfilled or rejected) for all tasks.
 * The result array has the same length as the input tasks, with each result corresponding to the task at the same index.
 */
export function allSettledWithAbort<T extends readonly Task<unknown>[] | []>(
    tasks: T,
    options?: RunOptions
): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[P]>>> }>;

/**
 * allSettledWithAbort is similar to Promise.allSettled() but receives Tasks and runs all provided tasks
 * concurrently, respecting the provided RunOptions.
 * Unlike allWithAbort, task failures do NOT abort other tasks - all tasks run to completion unless:
 * `options.signal` is aborted, in which case all running tasks are aborted and new tasks are not started.
 * The resulting Promise resolves with an array of settled results for all tasks.
 * The result array has the same length as the input tasks, with each result corresponding to the task at the same index.
 */
export function allSettledWithAbort<T>(
    tasks: Iterable<Task<T>>,
    options?: RunOptions
): Promise<PromiseSettledResult<Awaited<T>>[]>;

export async function allSettledWithAbort(
    tasks: Iterable<Task<any>>,
    options: RunOptions = {}
): Promise<PromiseSettledResult<Awaited<any>>[]> {
    // copy the signal in case options is mutated during execution
    const signal = options.signal
    if (signal?.aborted) {
        const rejectedResult: PromiseRejectedResult = {status: 'rejected', reason: signal.reason}
        const results: PromiseSettledResult<Awaited<any>>[] = []
        for (const _ of tasks) {
            results.push(rejectedResult)
        }
        return results
    }
    const groupAc = createGroupAc(options.signal)

    // noinspection ES6MissingAwait
    const resultsPromise = options.concurrencyLimit === undefined || options.concurrencyLimit <= 0
        ? allSettledWithAbortUnlimited(tasks, groupAc)
        : allSettledWithAbortLimited(tasks, new Semaphore(options.concurrencyLimit), groupAc)

    try {
        return await raceWithAbortSignal(resultsPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function allSettledWithAbortUnlimited(
    tasks: Iterable<Task<any>>,
    ac: AbortController,
): Promise<PromiseSettledResult<Awaited<any>>[]> {
    const promises: Promise<PromiseSettledResult<any>>[] = []
    for (const task of tasks) {
        const promise = task(ac.signal)
            .then(
                (value): PromiseFulfilledResult<any> => ({status: 'fulfilled', value}),
                (reason): PromiseRejectedResult => ({status: 'rejected', reason})
            )
        promises.push(promise)
    }
    return Promise.all(promises)
}

function allSettledWithAbortLimited(
    tasks: Iterable<Task<any>>,
    semaphore: Semaphore,
    ac: AbortController,
): Promise<PromiseSettledResult<Awaited<any>>[]> {
    const promises: Promise<PromiseSettledResult<any>>[] = []
    for (const task of tasks) {
        const p = semaphore.acquire(ac.signal)
            .then(async (): Promise<PromiseSettledResult<any>> => {
                try {
                    const value = await task(ac.signal);
                    return {status: 'fulfilled', value};
                } catch (reason) {
                    return {status: 'rejected', reason};
                } finally {
                    semaphore.release();
                }
            })
            .catch((reason): PromiseSettledResult<any> => {
                // This catch is only for semaphore acquisition failures due to abort
                return {status: 'rejected', reason};
            })
        promises.push(p)
    }
    return Promise.all(promises)
}

