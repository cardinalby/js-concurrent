import { raceWithAbort, GotRaceWinnerError } from './race_with_abort'
import {CancellableTasksTracker, delay} from "./test_util.test";
import {Task} from "./common";

describe('raceWithAbort', () => {
    describe('basic functionality', () => {
        test('returns the first task that resolves', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 50, 2),  // completes first
                tr.createTask(3, 150, 3)
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe(2)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([2])
            expect(tr.selfRejectedTasks).toEqual([])
            // Other tasks should be aborted with GotRaceWinnerError
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.abortedTasks.get(1)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.abortedTasks.get(3)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('returns the first task that rejects', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 50, error),  // fails first
                tr.createTask(3, 150, 3)
            ]

            await expect(raceWithAbort(tasks)).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([2])
            // Other tasks should be aborted with GotRaceWinnerError
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.abortedTasks.get(1)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.abortedTasks.get(3)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('handles empty task array', async () => {
            const promise = raceWithAbort([])
            // Promise.race([]) returns a promise that never resolves
            // We can't await it, but we can verify it's a promise
            expect(promise).toBeInstanceOf(Promise)
            promise.then(() => {
                throw new Error('Promise should not have resolved')
            })
            // Don't wait for it - it should never resolve
            await delay(100)
        })

        test('returns result with different types', async () => {
            const tr = new CancellableTasksTracker(4)
            const tasks = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 200, 'string'),
                tr.createTask(3, 50, { key: 'value' }),  // completes first
                tr.createTask(4, 150, true)
            ] as const

            const result = await raceWithAbort(tasks)
            expect(result).toEqual({ key: 'value' })
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([3])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(3)
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('runs tasks concurrently', async () => {
            const tr = new CancellableTasksTracker(4)
            await raceWithAbort([
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3),
                tr.createTask(4, 50, 4)
            ])
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            // One should resolve, others should be aborted
            expect(tr.resolvedTasks.length).toBe(1)
            expect(tr.abortedTasks.size).toBe(3)
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('aborts tasks that ignore signal eventually resolve', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1, { ignoreSignal: true }),
                tr.createTask(2, 50, 2),  // completes first
                tr.createTask(3, 100, 3, { ignoreSignal: true })
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe(2)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(2)

            // Wait for ignored tasks to complete
            await delay(150)
            expect(tr.resolvedTasks).toContain(1)
            expect(tr.resolvedTasks).toContain(3)
        })
    })

    describe('error handling', () => {
        test('resolves with first successful task even if later task would fail', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),  // completes first
                tr.createTask(2, 100, error),
                tr.createTask(3, 150, 3)
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('rejects with first error even if later task would succeed', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 50, error),  // fails first
                tr.createTask(3, 150, 3)
            ]

            await expect(raceWithAbort(tasks)).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('propagates the first error when multiple tasks fail simultaneously', async () => {
            const error1 = new Error('first-error')
            const error2 = new Error('second-error')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),
                tr.createTask(2, 50, error2),
                tr.createTask(3, 100, 3)
            ]

            // One of the errors should be propagated
            await expect(raceWithAbort(tasks)).rejects.toThrow()
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks.length).toBeGreaterThanOrEqual(1)
            expect(tr.abortedTasks.size).toBeGreaterThanOrEqual(1)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })
    })

    describe('parent signal', () => {
        test('respects parent abort signal during execution', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1),
                tr.createTask(2, 500, 2),
                tr.createTask(3, 500, 3)
            ]

            const promise = raceWithAbort(tasks, { signal: parentAc.signal })
            // Abort after starting
            await delay(100)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort'], [3, 'parent-abort']]))
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('respects parent abort signal with tasks ignoring abort', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1, { ignoreSignal: true }),
                tr.createTask(2, 500, 2, { ignoreSignal: true })
            ]

            const promise = raceWithAbort(tasks, { signal: parentAc.signal })
            // Abort after starting
            await delay(100)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(2)

            await delay(600) // wait to ensure tasks would have completed if not aborted
            expect(tr.resolvedTasks).toEqual([1, 2])
        })

        test('throws immediately if parent signal already aborted', async () => {
            const parentAc = new AbortController()
            parentAc.abort('pre-aborted')

            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2)
            ]

            await expect(raceWithAbort(tasks, { signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
        })

        test('parent signal aborted while task completes', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),  // will complete first
                tr.createTask(2, 500, 2)
            ]

            const promise = raceWithAbort(tasks, { signal: parentAc.signal })
            // Abort after first task completes
            await delay(100)
            parentAc.abort('parent-abort')

            // Should resolve with first task's result, not parent abort
            const result = await promise
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1])
        })
    })

    describe('concurrency limiting', () => {
        test('respects concurrency limit', async () => {
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 50, 3),  // This will complete first once it starts
                tr.createTask(4, 100, 4),
                tr.createTask(5, 100, 5)
            ]

            await raceWithAbort(tasks, { concurrencyLimit })
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)
            // At least the first 2 tasks should have started
            expect(tr.executionOrder.length).toBeGreaterThanOrEqual(2)
            // One task should have completed
            expect(tr.resolvedTasks.length + tr.selfRejectedTasks.length).toBe(1)
        })

        test('zero concurrency limit means unlimited', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 150, 3)
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit: 0 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('single task with concurrency limit', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1)
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit: 1 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(1)
        })

        test('concurrency limit larger than number of tasks', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 150, 3)
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit: 10 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('first batch task completes before others start with concurrency limit', async () => {
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),   // completes first
                tr.createTask(2, 200, 2),
                tr.createTask(3, 100, 3),  // should not start
                tr.createTask(4, 100, 4),  // should not start
                tr.createTask(5, 100, 5)   // should not start
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2])  // Only first 2 tasks start
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(1)  // Only task 2 is aborted
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)

            // Wait to ensure tasks 3,4,5 never started
            await delay(200)
            expect(tr.executionOrder).toEqual([1, 2])
        })

        test('task fails in first batch with concurrency limit', async () => {
            const error = new Error('task-1-error')
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error),  // fails first
                tr.createTask(2, 200, 2),
                tr.createTask(3, 100, 3),
                tr.createTask(4, 100, 4)
            ]

            await expect(raceWithAbort(tasks, { concurrencyLimit })).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1, 2])  // Only first batch starts
            expect(tr.selfRejectedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(1)  // Task 2 is aborted
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)

            // Wait to ensure tasks 3,4 never started
            await delay(200)
            expect(tr.executionOrder).toEqual([1, 2])
        })

        test('later batch task completes first with concurrency limit', async () => {
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 200, 1),
                tr.createTask(2, 200, 2),
                tr.createTask(3, 10, 3),   // This will complete first once it starts
                tr.createTask(4, 200, 4)
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit })
            // One of the first batch tasks will complete first (1 or 2)
            // since they both take 200ms and task 3 can't start until one completes
            expect([1, 2]).toContain(result)
            expect(tr.executionOrder).toEqual([1, 2])  // Only first batch starts
            expect(tr.resolvedTasks.length).toBe(1)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)
        })

        test('respects parent signal with concurrency limit', async () => {
            const parentAc = new AbortController()
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1),
                tr.createTask(2, 500, 2),
                tr.createTask(3, 500, 3),
                tr.createTask(4, 500, 4)
            ]

            const promise = raceWithAbort(tasks, { concurrencyLimit, signal: parentAc.signal })
            await delay(100)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])  // Only first 2 tasks start
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)

            await delay(200)
            expect(tr.executionOrder).toEqual([1, 2])  // Tasks 3,4 never start
        })

        test('parent signal aborted before any task starts with concurrency limit', async () => {
            const parentAc = new AbortController()
            parentAc.abort('pre-aborted')

            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 100, 3)
            ]

            await expect(raceWithAbort(tasks, { concurrencyLimit: 2, signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
        })

        test('semaphore acquisition aborted stops race with concurrency limit', async () => {
            const concurrencyLimit = 1
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1),  // blocks the semaphore
                tr.createTask(2, 100, 2),  // waiting for semaphore
                tr.createTask(3, 100, 3)   // waiting for semaphore
            ]

            const parentAc = new AbortController()
            const promise = raceWithAbort(tasks, { concurrencyLimit, signal: parentAc.signal })

            await delay(100)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1])  // Only first task started
            expect(tr.maxSeenConcurrentTasks).toBe(1)
        })

        test('all tasks fail quickly with concurrency limit', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),
                tr.createTask(2, 40, error2),  // fails first
                tr.createTask(3, 60, 3)
            ]

            await expect(raceWithAbort(tasks, { concurrencyLimit })).rejects.toBe(error2)
            expect(tr.executionOrder).toEqual([1, 2])  // Only first batch starts
            expect(tr.selfRejectedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(1)
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)

            await delay(100)
            expect(tr.executionOrder).toEqual([1, 2])  // Task 3 never starts
        })

        test('tasks ignoring abort signal with concurrency limit', async () => {
            const concurrencyLimit = 2
            const tr = new CancellableTasksTracker(concurrencyLimit)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 200, 2, { ignoreSignal: true }),
                tr.createTask(3, 100, 3)
            ]

            const result = await raceWithAbort(tasks, { concurrencyLimit })
            expect(result).toBe(1)
            // Only first batch starts because task 1 completes first
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([])
            // Task 2 ignores signal but is aborted, task 3 never starts
            expect(tr.abortedTasks.size).toBe(1)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrencyLimit)
        })
    })

    describe('edge cases', () => {
        test('single task that succeeds', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<string>[] = [
                tr.createTask(1, 50, 'success')
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe('success')
            expect(tr.executionOrder).toEqual([1])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(0)
        })

        test('single task that fails', async () => {
            const error = new Error('single-error')
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<string>[] = [
                tr.createTask(1, 50, error)
            ]

            await expect(raceWithAbort(tasks)).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(0)
        })

        test('task that completes synchronously', async () => {
            const syncTask: Task<number> = async () => 42
            const slowTask: Task<number> = async () => {
                await delay(100)
                return 1
            }
            const result = await raceWithAbort([syncTask, slowTask])
            expect(result).toBe(42)
        })

        test('task that throws synchronously', async () => {
            const error = new Error('sync-error')
            const syncTask: Task<number> = async () => {
                throw error
            }
            const slowTask: Task<number> = async () => {
                await delay(100)
                return 1
            }
            await expect(raceWithAbort([syncTask, slowTask])).rejects.toBe(error)
        })

        test('tasks with no delay - first one wins', async () => {
            const tr = new CancellableTasksTracker(5)
            const tasks: Task<number>[] = [
                tr.createTask(1, 0, 1),
                tr.createTask(2, 0, 2),
                tr.createTask(3, 0, 3),
                tr.createTask(4, 0, 4),
                tr.createTask(5, 0, 5)
            ]

            const result = await raceWithAbort(tasks)
            expect([1, 2, 3, 4, 5]).toContain(result)
            expect(tr.resolvedTasks.length).toBe(1)
            expect(tr.abortedTasks.size).toBe(4)
        })

        test('task that ignores abort signal but completes slowly', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 200, 1, { ignoreSignal: true }),
                tr.createTask(2, 50, 2)  // completes first
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe(2)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(1)

            // Wait for ignored task to complete
            await delay(250)
            expect(tr.resolvedTasks).toContain(1)
        })

        test('multiple tasks ignoring abort signal', async () => {
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 200, 1, { ignoreSignal: true }),
                tr.createTask(2, 200, 2, { ignoreSignal: true }),
                tr.createTask(3, 50, 3),  // completes first
                tr.createTask(4, 200, 4, { ignoreSignal: true })
            ]

            const result = await raceWithAbort(tasks)
            expect(result).toBe(3)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([3])
            expect(tr.abortedTasks.size).toBe(3)

            // Wait for ignored tasks to complete
            await delay(250)
            expect(tr.resolvedTasks).toContain(1)
            expect(tr.resolvedTasks).toContain(2)
            expect(tr.resolvedTasks).toContain(4)
        })

        test('options object without any options', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 100, 2)
            ]

            const result = await raceWithAbort(tasks, {})
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1])
        })

        test('task returning undefined', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks = [
                tr.createTask(1, 50, undefined),
                tr.createTask(2, 100, 2)
            ] as const

            const result = await raceWithAbort(tasks)
            expect(result).toBeUndefined()
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1])
        })

        test('task returning null', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks = [
                tr.createTask(1, 50, null),
                tr.createTask(2, 100, 2)
            ] as const

            const result = await raceWithAbort(tasks)
            expect(result).toBeNull()
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1])
        })

        test('all tasks same delay - one wins', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3)
            ]

            const result = await raceWithAbort(tasks)
            expect([1, 2, 3]).toContain(result)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks.length).toBe(1)
            expect(tr.abortedTasks.size).toBe(2)
        })
    })
})

