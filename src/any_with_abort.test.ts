import { Task } from './task'
import { CancellableTasksTracker, delay } from "./test_util.test";
import { GotRaceWinnerError } from "./race_with_abort";

describe('anyWithAbort', () => {
    describe('basic functionality', () => {
        test('returns the first task that resolves', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 50, 2),  // completes first
                tr.createTask(3, 150, 3)
            ]

            const result = await Task.any(tasks)
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

        test('handles empty task array', async () => {
            await expect(Task.any([])).rejects.toThrow(AggregateError)
            await expect(Task.any([])).rejects.toThrow('All promises were rejected')
        })

        test('returns result with different types', async () => {
            const tr = new CancellableTasksTracker(4)
            const tasks = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 200, 'string'),
                tr.createTask(3, 50, { key: 'value' }),  // completes first
                tr.createTask(4, 150, true)
            ] as const

            const result = await Task.any(tasks)
            expect(result).toEqual({ key: 'value' })
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([3])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(3)
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('runs tasks concurrently', async () => {
            const tr = new CancellableTasksTracker(4)
            await Task.any([
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

            const result = await Task.any(tasks)
            expect(result).toBe(2)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(2)

            // Wait for ignored tasks to complete
            await delay(150)
            expect(tr.resolvedTasks).toContain(1)
            expect(tr.resolvedTasks).toContain(3)
        })

        test('ignores rejections and returns first fulfilled task', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),
                tr.createTask(2, 100, 5),  // fulfills first
                tr.createTask(3, 75, error2),
                tr.createTask(4, 150, 10)
            ]

            const result = await Task.any(tasks)
            expect(result).toBe(5)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([2])
            expect(tr.selfRejectedTasks).toEqual([1, 3])
            expect(tr.abortedTasks.size).toBe(1)
            expect(tr.abortedTasks.get(4)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })
    })

    describe('error handling', () => {
        test('rejects with AggregateError when all tasks reject', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const error3 = new Error('error-3')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, error1),
                tr.createTask(2, 50, error2),
                tr.createTask(3, 150, error3)
            ]

            const promise = Task.any(tasks)
            await expect(promise).rejects.toBeInstanceOf(AggregateError)

            try {
                await promise
            } catch (error: any) {
                expect(error.errors).toEqual([error1, error2, error3])
                expect(error.message).toBe('All promises were rejected')
            }

            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks.sort()).toEqual([1, 2, 3])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('returns first fulfilled task even if some tasks reject', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, error),
                tr.createTask(2, 50, 42),  // fulfills first
                tr.createTask(3, 150, error)
            ]

            const result = await Task.any(tasks)
            expect(result).toBe(42)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([2])
            // Task 1 might reject or get aborted depending on timing
            // Task 3 should be aborted
            expect(tr.abortedTasks.has(3)).toBe(true)
            expect(tr.abortedTasks.get(3)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('waits for first fulfillment even if earlier tasks reject', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error),   // rejects at 50ms
                tr.createTask(2, 60, error),   // rejects at 60ms
                tr.createTask(3, 100, 100),    // fulfills at 100ms
                tr.createTask(4, 200, 200)
            ]

            const result = await Task.any(tasks)
            expect(result).toBe(100)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([3])
            expect(tr.selfRejectedTasks).toEqual([1, 2])
            expect(tr.abortedTasks.size).toBe(1)
            expect(tr.abortedTasks.get(4)).toBeInstanceOf(GotRaceWinnerError)
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('single task that fulfills', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 42)
            ]

            const result = await Task.any(tasks)
            expect(result).toBe(42)
            expect(tr.executionOrder).toEqual([1])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(1)
        })

        test('single task that rejects', async () => {
            const error = new Error('single-error')
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error)
            ]

            try {
                await Task.any(tasks)
                fail('Should have thrown')
            } catch (e: any) {
                expect(e).toBeInstanceOf(AggregateError)
                expect(e.errors).toEqual([error])
            }

            expect(tr.executionOrder).toEqual([1])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(1)
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

            const promise = Task.any(tasks, { signal: parentAc.signal })
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

            const promise = Task.any(tasks, { signal: parentAc.signal })
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

            await expect(Task.any(tasks, { signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
        })

        test('parent abort takes precedence even if task would fulfill', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 80, 1),
                tr.createTask(2, 80, 2)
            ]

            const promise = Task.any(tasks, { signal: parentAc.signal })
            await delay(50)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
        })
    })

    describe('concurrency limiting', () => {
        test('respects concurrency limit', async () => {
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 50, 3),  // will fulfill first when it runs
                tr.createTask(4, 100, 4),
                tr.createTask(5, 100, 5)
            ]

            await Task.any(tasks, { concurrency })
            // Task 1 and 2 start first, one of them completes in 100ms
            // Since all tasks in first batch take 100ms, one of them wins
            expect(tr.executionOrder).toContain(1)
            expect(tr.executionOrder).toContain(2)
            expect(tr.resolvedTasks.length).toBe(1)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('zero concurrency limit runs all tasks', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 150, 3)
            ]

            const result = await Task.any(tasks, { concurrency: 0 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('single task with concurrency limit', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1)
            ]

            const result = await Task.any(tasks, { concurrency: 1 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(1)
        })

        test('concurrency limit larger than number of tasks', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 150, 3)
            ]

            const result = await Task.any(tasks, { concurrency: 10 })
            expect(result).toBe(1)
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(2)
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('first batch all rejects, second batch fulfills with concurrency limit', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),  // first batch - rejects
                tr.createTask(2, 50, error2),  // first batch - rejects
                tr.createTask(3, 50, 3),       // second batch - fulfills
                tr.createTask(4, 50, 4)        // second batch - should be aborted
            ]

            const result = await Task.any(tasks, { concurrency })
            expect(result).toBe(3)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.selfRejectedTasks).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([3])
            expect(tr.abortedTasks.size).toBeGreaterThanOrEqual(1)
            expect(tr.abortedTasks.has(4)).toBe(true)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('all tasks reject with concurrency limit', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const error3 = new Error('error-3')
            const error4 = new Error('error-4')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),
                tr.createTask(2, 50, error2),
                tr.createTask(3, 50, error3),
                tr.createTask(4, 50, error4)
            ]

            try {
                await Task.any(tasks, { concurrency })
                fail('Should have thrown')
            } catch (e: any) {
                expect(e).toBeInstanceOf(AggregateError)
                expect(e.errors).toEqual([error1, error2, error3, error4])
            }

            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.selfRejectedTasks.sort()).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('respects parent signal with concurrency limit', async () => {
            const parentAc = new AbortController()
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 100, 3),
                tr.createTask(4, 100, 4)
            ]

            const promise = Task.any(tasks, { concurrency, signal: parentAc.signal })
            await delay(20)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            // First 2 tasks should have started and been aborted
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            await delay(150) // wait to ensure other tasks haven't started
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.resolvedTasks).toEqual([])
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

            await expect(Task.any(tasks, { concurrency: 2, signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
            await delay(150) // wait to ensure no tasks have started
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
        })

        test('fulfillment occurs while parent signal aborted with concurrency limit', async () => {
            const parentAc = new AbortController()
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 80, 1),  // will fulfill
                tr.createTask(2, 150, 2),
                tr.createTask(3, 200, 3)
            ]

            const promise = Task.any(tasks, { concurrency, signal: parentAc.signal })
            await delay(50)
            parentAc.abort('parent-abort')

            // expect parent abort to take precedence
            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
        })

        test('handles mixed results with concurrency limit', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, error1),
                tr.createTask(2, 100, error2),
                tr.createTask(3, 100, error1),
                tr.createTask(4, 50, 42),      // will fulfill first in its batch
                tr.createTask(5, 100, 5)
            ]

            const result = await Task.any(tasks, { concurrency })
            expect(result).toBe(42)
            expect(tr.resolvedTasks).toEqual([4])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })
    })
})

