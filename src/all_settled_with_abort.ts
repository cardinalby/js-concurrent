import {Semaphore} from "./semaphore";
import {TaskFn, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {createGroupAc} from "./group_abort_controller";

export async function allSettledWithAbort(
    tasks: Iterable<TaskFn<any>>,
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
    const resultsPromise = options.concurrency === undefined || options.concurrency <= 0
        ? allSettledWithAbortUnlimited(tasks, groupAc)
        : allSettledWithAbortLimited(tasks, new Semaphore(options.concurrency), groupAc)

    try {
        return await raceWithAbortSignal(resultsPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function allSettledWithAbortUnlimited(
    tasks: Iterable<TaskFn<any>>,
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
    tasks: Iterable<TaskFn<any>>,
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

