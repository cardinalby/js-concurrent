import {Semaphore} from "./semaphore";
import {ConcurrentTaskFailedError, TaskFn, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {createGroupAc} from "./group_abort_controller";

/**
 * Error thrown to abort tasks when another task has already completed.
 * Can be returned by:
 * - `Task.race` to indicate that the task was aborted because another task completed first
 * - `Task.any` to indicate that the task was aborted because another task fulfilled first
 */
export class GotRaceWinnerError extends Error {
    constructor() {
        super("Another task has already completed")
        this.name = 'RaceWinnerError'
    }
}

export async function raceWithAbort(
    tasks: Iterable<TaskFn<any>>,
    options: RunOptions = {}
): Promise<Awaited<any>> {
    // copy the signal in case options is mutated during execution
    const signal = options.signal
    if (signal?.aborted) {
        return Promise.reject(signal.reason)
    }

    const tasksArray = Array.from(tasks)
    if (tasksArray.length === 0) {
        // Return a promise that never resolves, similar to Promise.race([])
        return new Promise(() => {})
    }

    const groupAc = createGroupAc(options.signal)

    // noinspection ES6MissingAwait
    const resultPromise = options.concurrency === undefined || options.concurrency <= 0
        ? raceWithAbortUnlimited(tasksArray, groupAc)
        : raceWithAbortLimited(tasksArray, new Semaphore(options.concurrency), groupAc)

    try {
        return await raceWithAbortSignal(resultPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function raceWithAbortUnlimited(
    tasks: TaskFn<any>[],
    ac: AbortController,
): Promise<Awaited<any>> {
    const promises: Promise<any>[] = []
    for (const task of tasks) {
        const promise = task(ac.signal).finally(() => {
            // When any task completes (resolves or rejects), abort all others
            if (!ac.signal.aborted) {
                ac.abort(new GotRaceWinnerError())
            }
        })
        promises.push(promise)
    }
    return Promise.race(promises)
}

function raceWithAbortLimited(
    tasks: TaskFn<any>[],
    semaphore: Semaphore,
    ac: AbortController,
): Promise<Awaited<any>> {
    return new Promise((resolve, reject) => {
        let settled = false

        const onTaskComplete = (result: any, isError: boolean) => {
            if (settled) {
                return
            }
            settled = true

            // Abort all other tasks
            if (!ac.signal.aborted) {
                ac.abort(isError
                    ? new ConcurrentTaskFailedError(result)
                    : new GotRaceWinnerError()
                )
            }

            if (isError) {
                reject(result)
            } else {
                resolve(result)
            }
        }

        // Start all tasks - they will queue up at the semaphore
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i]
            semaphore.acquire(ac.signal)
                .then(async () => {
                    if (settled) {
                        semaphore.release()
                        return
                    }

                    try {
                        const result = await task(ac.signal)
                        onTaskComplete(result, false)
                    } catch (error) {
                        onTaskComplete(error, true)
                    } finally {
                        semaphore.release()
                    }
                })
                .catch((error) => {
                    // Semaphore acquisition was aborted
                    if (!settled) {
                        onTaskComplete(error, true)
                    }
                })
        }
    })
}

