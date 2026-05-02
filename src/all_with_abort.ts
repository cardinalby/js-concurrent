import {Semaphore} from "./semaphore";
import {ConcurrentTaskFailedError, TaskFn, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {createGroupAc} from "./group_abort_controller";

export async function allWithAbort(
    tasks: Iterable<TaskFn<any>>,
    options: RunOptions = {}
): Promise<Awaited<any>[]> {
    // copy the signal in case options is mutated during execution
    const signal = options.signal
    if (signal?.aborted) {
        return Promise.reject(signal.reason)
    }
    const groupAc = createGroupAc(options.signal)

    // noinspection ES6MissingAwait
    const resultsPromise = options.concurrency === undefined || options.concurrency <= 0
        ? allWithAbortUnlimited(tasks, groupAc)
        : allWithAbortLimited(tasks, new Semaphore(options.concurrency), groupAc)

    try {
        return await raceWithAbortSignal(resultsPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function allWithAbortUnlimited(
    tasks: Iterable<TaskFn<any>>,
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
    tasks: Iterable<TaskFn<any>>,
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