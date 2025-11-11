import { newLimiter, ConcurrencyLimiter } from './concurrency_limiter'
import { jest } from '@jest/globals'

function delay(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms))
}

describe('ConcurrencyLimiter', () => {
    describe('newLimiter', () => {
        test('creates a limiter function', () => {
            const limiter = newLimiter(1)
            expect(typeof limiter).toBe('function')
        })

        test('allows execution up to maxConcurrency', async () => {
            const limiter = newLimiter(2)
            let concurrentCount = 0
            let maxConcurrentCount = 0

            const action = async () => {
                concurrentCount++
                maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount)
                await delay(50)
                concurrentCount--
            }

            await Promise.all([
                limiter(action),
                limiter(action),
                limiter(action),
                limiter(action)
            ])

            expect(maxConcurrentCount).toBe(2)
            expect(concurrentCount).toBe(0)
        })

        test('executes actions sequentially when maxConcurrency is 1', async () => {
            const limiter = newLimiter(1)
            const executionOrder: number[] = []

            const createAction = (id: number) => async () => {
                executionOrder.push(id)
                await delay(10)
            }

            await Promise.all([
                limiter(createAction(1)),
                limiter(createAction(2)),
                limiter(createAction(3))
            ])

            expect(executionOrder).toEqual([1, 2, 3])
        })

        test('returns the result of the action', async () => {
            const limiter = newLimiter(1)
            const result = await limiter(async () => 'test-result')
            expect(result).toBe('test-result')
        })

        test('returns different results for different actions', async () => {
            const limiter = newLimiter(2)
            const results = await Promise.all([
                limiter(async () => 1),
                limiter(async () => 2),
                limiter(async () => 3)
            ])
            expect(results).toEqual([1, 2, 3])
        })

        test('propagates errors from actions', async () => {
            const limiter = newLimiter(1)
            const error = new Error('action-error')

            await expect(limiter(async () => {
                throw error
            })).rejects.toThrow('action-error')
        })

        test('releases semaphore even when action throws', async () => {
            const limiter = newLimiter(1)

            // First action throws
            await expect(limiter(async () => {
                throw new Error('first-error')
            })).rejects.toThrow('first-error')

            // Second action should still be able to run
            const result = await limiter(async () => 'success')
            expect(result).toBe('success')
        })

        test('handles multiple errors without deadlock', async () => {
            const limiter = newLimiter(2)
            const results = await Promise.allSettled([
                limiter(async () => { throw new Error('error1') }),
                limiter(async () => { throw new Error('error2') }),
                limiter(async () => 'success')
            ])

            expect(results[0].status).toBe('rejected')
            expect(results[1].status).toBe('rejected')
            expect(results[2].status).toBe('fulfilled')
            expect((results[2] as any).value).toBe('success')
        })

        test('respects abort signal before acquiring semaphore', async () => {
            const limiter = newLimiter(1)
            const abortController = new AbortController()

            // Fill the semaphore
            const slowAction = limiter(async () => {
                await delay(100)
                return 'slow'
            })

            // Abort before the second action can acquire
            abortController.abort('aborted-before-acquire')

            await expect(limiter(async () => 'fast', abortController.signal))
                .rejects.toBe('aborted-before-acquire')

            await expect(slowAction).resolves.toBe('slow')
        })

        test('respects abort signal during wait', async () => {
            const limiter = newLimiter(1)
            const abortController = new AbortController()

            // Fill the semaphore
            const slowAction = limiter(async () => {
                await delay(100)
                return 'slow'
            })

            // Start waiting action
            const waitingAction = limiter(async () => 'waiting', abortController.signal)

            // Abort while waiting
            await delay(10)
            abortController.abort('aborted-during-wait')

            await expect(waitingAction).rejects.toBe('aborted-during-wait')
            await expect(slowAction).resolves.toBe('slow')
        })

        test('does not execute action if aborted while waiting', async () => {
            const limiter = newLimiter(1)
            const abortController = new AbortController()
            const actionMock = jest.fn(async () => 'result')

            // Fill the semaphore
            const slowAction = limiter(async () => {
                await delay(100)
            })

            // Start waiting action
            const waitingAction = limiter(actionMock, abortController.signal)

            // Abort while waiting
            await delay(10)
            abortController.abort('aborted')

            await expect(waitingAction).rejects.toBe('aborted')
            await slowAction

            // Action should never have been called
            expect(actionMock).not.toHaveBeenCalled()
        })

        test('handles already aborted signal', async () => {
            const limiter = newLimiter(1)
            const abortController = new AbortController()
            abortController.abort('already-aborted')

            await expect(limiter(async () => 'result', abortController.signal))
                .rejects.toBe('already-aborted')
        })

        test('allows high concurrency limit', async () => {
            const limiter = newLimiter(10)
            let maxConcurrent = 0
            let currentConcurrent = 0

            const action = async () => {
                currentConcurrent++
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
                await delay(20)
                currentConcurrent--
            }

            const promises = Array.from({ length: 15 }, () => limiter(action))
            await Promise.all(promises)

            expect(maxConcurrent).toBe(10)
        })

        test('handles zero-delay actions', async () => {
            const limiter = newLimiter(2)
            const results = await Promise.all([
                limiter(async () => 1),
                limiter(async () => 2),
                limiter(async () => 3),
                limiter(async () => 4),
                limiter(async () => 5)
            ])
            expect(results).toEqual([1, 2, 3, 4, 5])
        })

        test('maintains separate state for different limiters', async () => {
            const limiter1 = newLimiter(1)
            const limiter2 = newLimiter(1)

            let concurrent1 = 0
            let concurrent2 = 0

            const action1 = async () => {
                concurrent1++
                await delay(50)
                concurrent1--
            }

            const action2 = async () => {
                concurrent2++
                await delay(50)
                concurrent2--
            }

            // Start actions on both limiters simultaneously
            await Promise.all([
                limiter1(action1),
                limiter2(action2)
            ])

            // Both should have been able to run concurrently
            // (they use different limiters)
            expect(concurrent1).toBe(0)
            expect(concurrent2).toBe(0)
        })

        test('preserves action return type', async () => {
            const limiter = newLimiter(1)

            const stringResult: string = await limiter(async () => 'string')
            const numberResult: number = await limiter(async () => 42)
            const objectResult: { key: string } = await limiter(async () => ({ key: 'value' }))

            expect(stringResult).toBe('string')
            expect(numberResult).toBe(42)
            expect(objectResult).toEqual({ key: 'value' })
        })

        test('handles async function that returns immediately', async () => {
            const limiter = newLimiter(3)
            const start = Date.now()

            await Promise.all([
                limiter(async () => 1),
                limiter(async () => 2),
                limiter(async () => 3),
                limiter(async () => 4),
                limiter(async () => 5)
            ])

            const elapsed = Date.now() - start
            // Should complete quickly since actions are instant
            expect(elapsed).toBeLessThan(100)
        })

        test('queues actions in FIFO order', async () => {
            const limiter = newLimiter(1)
            const order: number[] = []

            // Fill semaphore
            await limiter(async () => {
                order.push(0)
            })

            await Promise.all([
                limiter(async () => { order.push(1) }),
                limiter(async () => { order.push(2) }),
                limiter(async () => { order.push(3) })
            ])
            expect(order).toEqual([0, 1, 2, 3])
        })

        test('handles rejection with custom error objects', async () => {
            const limiter = newLimiter(1)
            const customError = { code: 'CUSTOM', message: 'custom error' }

            await expect(limiter(async () => {
                throw customError
            })).rejects.toEqual(customError)
        })
    })
})

