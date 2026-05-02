import { Task } from './task'
import {CancellableTasksTracker, delay} from "./test_util.test";
import {ConcurrentTaskFailedError} from "./common";

describe('allWithAbort', () => {
    describe('basic functionality', () => {
        test('runs all tasks successfully and returns results in order', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 30, 2),
                tr.createTask(3, 10, 3)
            ]

            const results = await Task.all(tasks)
            expect(results).toEqual([1, 2, 3])
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([3, 2, 1])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('handles empty task array', async () => {
            const results = await Task.all([])
            expect(results).toEqual([])
        })

        test('returns results with different types', async () => {
            const tr = new CancellableTasksTracker(4)
            const tasks = [
                tr.createTask(1, 10, 1),
                tr.createTask(2, 20, 'string'),
                tr.createTask(3, 15, { key: 'value' }),
                tr.createTask(4, 5, true)
            ] as const

            const results = await Task.all(tasks)
            expect(results).toEqual([1, 'string', { key: 'value' }, true])
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([4, 1, 3, 2])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('runs tasks concurrently', async () => {
            const tr = new CancellableTasksTracker(4)
            await Task.all([
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3),
                tr.createTask(4, 50, 4)
            ])
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks.length).toBe(4)
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })
    })

    describe('error handling', () => {
        test('aborts other tasks when one fails', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 80, 2),
                tr.createTask(3, 60, error),
                tr.createTask(4, 40, 4)
            ]

            await expect(Task.all(tasks)).rejects.toBe(error)
            const concTaskErr = new ConcurrentTaskFailedError(error)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([4])
            expect(tr.selfRejectedTasks).toEqual([3])
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr], [2, concTaskErr]]))
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })

        test('propagates the first error when multiple tasks fail', async () => {
            const error1 = new Error('first-error')
            const error2 = new Error('second-error')
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 80, error1, { ignoreSignal: true }),
                tr.createTask(3, 60, error2),
                tr.createTask(4, 40, 4)
            ]
            await expect(Task.all(tasks)).rejects.toBe(error2)
            const concTaskErr = new ConcurrentTaskFailedError(error2)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.resolvedTasks).toEqual([4])
            // even though task 2 ignored the abort signal, task 3 failed first so its error is propagated
            // and allWithAbort rejects with error2 (it doesn't wait all tasks to be settled)
            expect(tr.selfRejectedTasks).toEqual([3])
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr], [2, concTaskErr]]))
            expect(tr.maxSeenConcurrentTasks).toBe(4)
        })
    })

    describe('parent signal', () => {
        test('respects parent abort signal tasks ignoring abort', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1, { ignoreSignal: true }),
                tr.createTask(2, 500, 2, { ignoreSignal: true })
            ]

            const promise = Task.all(tasks, { signal: parentAc.signal })
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
            expect(tr.resolvedTasks).toEqual([1,2])
        })

        test('respects parent abort signal tasks no ignoring abort', async () => {
            const parentAc = new AbortController()
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 500, 1),
                tr.createTask(2, 500, 2)
            ]

            const promise = Task.all(tasks, { signal: parentAc.signal })
            // Abort after starting
            await delay(100)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(2)
        })

        test('throws immediately if parent signal already aborted', async () => {
            const parentAc = new AbortController()
            parentAc.abort('pre-aborted')

            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2)
            ]

            await expect(Task.all(tasks, { signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
        })
    })

    describe('concurrency limiting', () => {
        test('respects concurrency limit', async () => {
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 100, 2),
                tr.createTask(3, 100, 3),
                tr.createTask(4, 100, 4),
                tr.createTask(5, 100, 5)
            ]

            await Task.all(tasks, { concurrency })
            expect(tr.executionOrder).toEqual([1, 2, 3, 4, 5])
            expect(tr.resolvedTasks).toEqual([1, 2, 3, 4, 5])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('zero concurrency limit', async () => {
            const tr = new CancellableTasksTracker(3)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3)
            ]

            const results = await Task.all(tasks, { concurrency: 0 })
            expect(results).toEqual([1, 2, 3])
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks).toEqual([1, 2, 3])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('single task with concurrency limit', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1)
            ]

            const results = await Task.all(tasks, { concurrency: 1 })
            expect(results).toEqual([1])
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
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3)
            ]

            const results = await Task.all(tasks, { concurrency: 10 })
            expect(results).toEqual([1, 2, 3])
            expect(tr.executionOrder).toEqual([1, 2, 3])
            expect(tr.resolvedTasks.length).toBe(3)
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(3)
        })

        test('aborts pending tasks when one fails with concurrency limit', async () => {
            const error = new Error('task-2-error')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1),
                tr.createTask(2, 50, error), // fails first
                tr.createTask(3, 100, 3),    // should not start or be aborted
                tr.createTask(4, 100, 4),    // should not start or be aborted
                tr.createTask(5, 100, 5)     // should not start or be aborted
            ]

            await expect(Task.all(tasks, { concurrency })).rejects.toBe(error)
            const concTaskErr = new ConcurrentTaskFailedError(error)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.selfRejectedTasks).toEqual([2])
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr]]))
            // Task 1 should be aborted, tasks 3, 4, 5 should not start
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            expect(tr.resolvedTasks).toEqual([])
            await delay(200) // wait to ensure tasks 3,4,5 haven't started
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr]]))
            expect(tr.resolvedTasks).toEqual([])
        })

        test('handles error in first batch with concurrency limit', async () => {
            const error = new Error('task-1-error')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error), // fails in first batch
                tr.createTask(2, 100, 2),
                tr.createTask(3, 100, 3),
                tr.createTask(4, 100, 4)
            ]

            await expect(Task.all(tasks, { concurrency })).rejects.toBe(error)
            const concTaskErr = new ConcurrentTaskFailedError(error)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.selfRejectedTasks).toEqual([1])
            expect(tr.abortedTasks).toEqual(new Map([[2, concTaskErr]]))
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('handles error in last batch with concurrency limit', async () => {
            const error = new Error('task-4-error')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 100, 3),
                tr.createTask(4, 50, error) // fails in last batch
            ]
            await expect(Task.all(tasks, { concurrency })).rejects.toBe(error)
            const concTaskErr = new ConcurrentTaskFailedError(error)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.selfRejectedTasks).toEqual([4])
            expect(tr.abortedTasks).toEqual(new Map([[3, concTaskErr]]))
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            expect(tr.resolvedTasks).toEqual([1,2])
        })

        test('respects parent signal with concurrency limit', async () => {
            const parentAc = new AbortController()
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2),
                tr.createTask(3, 50, 3),
                tr.createTask(4, 50, 4)
            ]

            const promise = Task.all(tasks, { concurrency, signal: parentAc.signal })
            await delay(20)
            parentAc.abort('parent-abort')

            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            // First 2 tasks should have started and been aborted
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            await delay(100) // wait to ensure other tasks haven't started
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

            await expect(Task.all(tasks, { concurrency: 2, signal: parentAc.signal }))
                .rejects.toBe('pre-aborted')

            expect(tr.executionOrder).toEqual([])
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(0)
            await delay(200) // wait to ensure no tasks have started
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map())
        })

        test('error occurs while parent signal aborted with concurrency limit', async () => {
            const parentAc = new AbortController()
            const error = new Error('task-error')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, error),
                tr.createTask(2, 150, 2),
                tr.createTask(3, 200, 3)
            ]

            const promise = Task.all(tasks, { concurrency, signal: parentAc.signal })
            await delay(50)
            parentAc.abort('parent-abort')

            // expect parent error
            await expect(promise).rejects.toBe('parent-abort')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            expect(tr.selfRejectedTasks).toEqual([])
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))

            await delay(200) // wait to ensure other tasks have been aborted
            expect(tr.abortedTasks).toEqual(new Map([[1, 'parent-abort'], [2, 'parent-abort']]))
        })

        test('all tasks fail quickly with concurrency limit', async () => {
            const error1 = new Error('error-1')
            const error2 = new Error('error-2')
            const error3 = new Error('error-3')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, error1),
                tr.createTask(2, 40, error2), // fails first
                tr.createTask(3, 60, error3)
            ]

            await expect(Task.all(tasks, { concurrency })).rejects.toBe(error2)
            const concTaskErr = new ConcurrentTaskFailedError(error2)
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.selfRejectedTasks).toEqual([2])
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr]]))
            expect(tr.resolvedTasks).toEqual([])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
            await delay(100) // wait to ensure task 3 hasn't been started
            expect(tr.abortedTasks).toEqual(new Map([[1, concTaskErr]]))
            expect(tr.selfRejectedTasks).toEqual([2])
        })

        test('tasks ignoring abort signal with concurrency limit', async () => {
            const error = new Error('task-error')
            const concurrency = 2
            const tr = new CancellableTasksTracker(concurrency)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 150, 2, { ignoreSignal: true }),
                tr.createTask(3, 50, error)
            ]

            await expect(Task.all(tasks, { concurrency })).rejects.toBe(error)
            const concTaskErr = new ConcurrentTaskFailedError(error)
            expect(tr.executionOrder).toEqual([1,2,3])
            expect(tr.selfRejectedTasks).toEqual([3])
            expect(tr.abortedTasks).toEqual(new Map([[2, concTaskErr]]))
            expect(tr.resolvedTasks).toEqual([1])
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })

        test('tasks with mixed results and concurrency limit', async () => {
            const concurrency = 3
            const tr = new CancellableTasksTracker(concurrency)
            const tasks = [
                tr.createTask(1, 50, 'a'),
                tr.createTask(2, 60, 42),
                tr.createTask(3, 40, true),
                tr.createTask(4, 70, { data: 'test' }),
                tr.createTask(5, 30, null),
                tr.createTask(6, 80, undefined)
            ] as const

            const results = await Task.all(tasks, { concurrency })
            expect(tr.executionOrder).toEqual([1,2,3,4,5,6])
            expect(results).toEqual(['a', 42, true, { data: 'test' }, null, undefined])
            expect(tr.resolvedTasks).toEqual([3, 1, 2, 5, 4, 6])
            expect(tr.abortedTasks.size).toBe(0)
            expect(tr.maxSeenConcurrentTasks).toBe(concurrency)
        })
    })

    describe('edge cases', () => {
        test('single task that succeeds', async () => {
            const tr = new CancellableTasksTracker(1)
            const tasks: Task<string>[] = [
                tr.createTask(1, 50, 'success')
            ]

            const results = await Task.all(tasks)
            expect(results).toEqual(['success'])
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

            await expect(Task.all(tasks)).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1])
            expect(tr.selfRejectedTasks).toEqual([1])
            expect(tr.abortedTasks.size).toBe(0)
        })

        test('task that completes synchronously', async () => {
            const syncTask: Task<number> = async (_signal) => 42
            const results = await Task.all([syncTask])
            expect(results).toEqual([42])
        })

        test('task that throws synchronously', async () => {
            const error = new Error('sync-error')
            const syncTask: Task<number> = async (_signal) => {
                throw error
            }
            await expect(Task.all([syncTask])).rejects.toBe(error)
        })

        test('tasks with no delay all succeed', async () => {
            const tr = new CancellableTasksTracker(5)
            const tasks: Task<number>[] = [
                tr.createTask(1, 0, 1),
                tr.createTask(2, 0, 2),
                tr.createTask(3, 0, 3),
                tr.createTask(4, 0, 4),
                tr.createTask(5, 0, 5)
            ]

            const results = await Task.all(tasks)
            expect(results).toEqual([1, 2, 3, 4, 5])
            expect(tr.executionOrder).toEqual([1, 2, 3, 4, 5])
            expect(tr.resolvedTasks.length).toBe(5)
        })

        test('task that ignores abort signal but still completes', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 100, 1, { ignoreSignal: true }),
                tr.createTask(2, 50, new Error('error'))
            ]

            await expect(Task.all(tasks)).rejects.toThrow('error')
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.selfRejectedTasks).toEqual([2])
            expect(tr.abortedTasks.size).toBe(1)

            // Wait for ignored task to complete
            await delay(200)
            expect(tr.resolvedTasks).toEqual([1])
        })

        test('multiple tasks ignoring abort signal', async () => {
            const error = new Error('task-error')
            const tr = new CancellableTasksTracker(4)
            const tasks: Task<number>[] = [
                tr.createTask(1, 200, 1, { ignoreSignal: true }),
                tr.createTask(2, 200, 2, { ignoreSignal: true }),
                tr.createTask(3, 50, error),
                tr.createTask(4, 100, 4)
            ]

            await expect(Task.all(tasks)).rejects.toBe(error)
            expect(tr.executionOrder).toEqual([1, 2, 3, 4])
            expect(tr.selfRejectedTasks).toEqual([3])
            expect(tr.abortedTasks.size).toBe(3)

            // Wait for ignored tasks to complete
            await delay(300)
            expect(tr.resolvedTasks).toContain(1)
            expect(tr.resolvedTasks).toContain(2)
        })

        test('options object without any options', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks: Task<number>[] = [
                tr.createTask(1, 50, 1),
                tr.createTask(2, 50, 2)
            ]

            const results = await Task.all(tasks, {})
            expect(results).toEqual([1, 2])
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks.length).toBe(2)
        })

        test('tasks returning undefined', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks = [
                tr.createTask(1, 50, undefined),
                tr.createTask(2, 50, undefined)
            ] as const

            const results = await Task.all(tasks)
            expect(results).toEqual([undefined, undefined])
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1, 2])
        })

        describe('resolve with Promise (flattening)', () => {
            test('new Task: resolve(Promise<T>) flattens to T, not Promise<T>', async () => {
                const inner = Promise.resolve(42)
                const task = new Task<number>((resolve, _reject, _signal) => {
                    resolve(inner)
                })
                const results = await Task.all([task])
                // Must be 42, not the Promise object itself
                expect(results).toEqual([42])
                expect(results[0]).toBe(42)
                expect(results[0]).not.toBeInstanceOf(Promise)
            })

            test('new Task: resolve(rejected Promise) causes task to reject', async () => {
                const error = new Error('inner-error')
                const task = new Task<number>((resolve, _reject, _signal) => {
                    resolve(Promise.reject(error))
                })
                await expect(Task.all([task])).rejects.toBe(error)
            })

            test('new Task: resolve(pending Promise) waits for it to settle', async () => {
                const task = new Task<string>((resolve, _reject, _signal) => {
                    resolve(new Promise(r => setTimeout(() => r('deferred'), 50)))
                })
                const results = await Task.all([task])
                expect(results).toEqual(['deferred'])
            })

            test('plain Task fn: returning Promise<Promise<T>> also flattens (await semantics)', async () => {
                // async functions always flatten — returning a Promise<T> from an async fn
                // gives Promise<T>, not Promise<Promise<T>>
                const task: Task<number> = async (_signal) => {
                    return Promise.resolve(99)
                }
                const results = await Task.all([task])
                expect(results).toEqual([99])
                expect(results[0]).not.toBeInstanceOf(Promise)
            })
        })

        test('tasks returning null', async () => {
            const tr = new CancellableTasksTracker(2)
            const tasks = [
                tr.createTask(1, 50, null),
                tr.createTask(2, 50, null)
            ] as const

            const results = await Task.all(tasks)
            expect(results).toEqual([null, null])
            expect(tr.executionOrder).toEqual([1, 2])
            expect(tr.resolvedTasks).toEqual([1, 2])
        })
    })
})

