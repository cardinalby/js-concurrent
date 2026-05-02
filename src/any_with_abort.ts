import {Semaphore} from "./semaphore";
import {TaskFn, RunOptions} from "./common";
import {raceWithAbortSignal} from "./race_with_abort_signal";
import {GotRaceWinnerError} from "./race_with_abort";
import {createGroupAc} from "./group_abort_controller";

const allTasksRejectedMessage = 'All promises were rejected'

export async function anyWithAbort(
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
        // Return a rejected promise with AggregateError, similar to Promise.any([])
        return Promise.reject(new AggregateError([], allTasksRejectedMessage))
    }

    const groupAc = createGroupAc(options.signal)

    // noinspection ES6MissingAwait
    const resultPromise = options.concurrency === undefined || options.concurrency <= 0
        ? anyWithAbortUnlimited(tasksArray, groupAc)
        : anyWithAbortLimited(tasksArray, new Semaphore(options.concurrency), groupAc)

    try {
        return await raceWithAbortSignal(resultPromise, signal)
    } finally {
        groupAc.abort()
    }
}

async function anyWithAbortUnlimited(
    tasks: TaskFn<any>[],
    ac: AbortController,
): Promise<Awaited<any>> {
    const errors: any[] = new Array(tasks.length)
    let rejectedCount = 0

    return new Promise((resolve, reject) => {
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i]
            task(ac.signal).then(
                value => {
                    // Task fulfilled - abort all others
                    if (!ac.signal.aborted) {
                        ac.abort(new GotRaceWinnerError())
                    }
                    resolve(value)
                },
                reason => {
                    // Task rejected - collect error
                    errors[i] = reason
                    rejectedCount++

                    if (rejectedCount === tasks.length) {
                        // All tasks rejected
                        reject(new AggregateError(errors, allTasksRejectedMessage))
                    }
                }
            )
        }
    })
}

function anyWithAbortLimited(
    tasks: TaskFn<any>[],
    semaphore: Semaphore,
    ac: AbortController,
): Promise<Awaited<any>> {
    return new Promise((resolve, reject) => {
        const errors: any[] = new Array(tasks.length)
        let rejectedCount = 0
        let settled = false

        const onTaskFulfilled = (result: any) => {
            if (settled) {
                return
            }
            settled = true

            // Abort all other tasks
            if (!ac.signal.aborted) {
                ac.abort(new GotRaceWinnerError())
            }

            resolve(result)
        }

        const onTaskRejected = (index: number, reason: any) => {
            if (settled) {
                return
            }
            errors[index] = reason
            rejectedCount++

            if (rejectedCount === tasks.length) {
                // All tasks rejected
                settled = true
                reject(new AggregateError(errors, allTasksRejectedMessage))
            }
        }

        // Start all tasks - they will queue up at the semaphore
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i]
            const index = i

            semaphore.acquire(ac.signal)
                .then(async () => {
                    if (settled) {
                        semaphore.release()
                        return
                    }

                    try {
                        const result = await task(ac.signal)
                        onTaskFulfilled(result)
                    } catch (error) {
                        onTaskRejected(index, error)
                    } finally {
                        semaphore.release()
                    }
                })
                .catch((error) => {
                    // Semaphore acquisition was aborted
                    onTaskRejected(index, error)
                })
        }
    })
}

