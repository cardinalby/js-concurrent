import { Semaphore } from './semaphore'

function delay(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms))
}

describe('Semaphore', () => {
    test('acquire resolves immediately when below limit', async () => {
        const s = new Semaphore(2)
        await expect(s.acquire()).resolves.toBeUndefined()
        expect(s.count).toBe(1)
    })

    test('release frees a slot when no waiters', async () => {
        const s = new Semaphore(1)
        await s.acquire()
        expect(s.count).toBe(1)
        s.release()
        expect(s.count).toBe(0)
    })

    test('FIFO ordering for queued waiters', async () => {
        const s = new Semaphore(1)
        // consume slot
        await s.acquire()
        const p1 = s.acquire().then(() => 'first')
        const p2 = s.acquire().then(() => 'second')

        // release should hand to first waiter (FIFO)
        s.release()
        await expect(p1).resolves.toBe('first')

        // then release should hand to second waiter
        s.release()
        await expect(p2).resolves.toBe('second')
    })

    test('aborted waiter should not block next waiter', async () => {
        const s = new Semaphore(1)
        // consume slot
        await s.acquire()

        const acA = new AbortController()
        const pA = s.acquire(acA.signal) // will be aborted
        const pB = s.acquire()            // should get slot after A is aborted

        // abort the first waiter before releasing the slot
        acA.abort('a-reason')

        // allow abort handlers to run
        await Promise.resolve()

        // pA must reject with the abort reason
        await expect(pA).rejects.toBe('a-reason')

        // releasing should grant the slot to pB (if implementation removes aborted waiters)
        s.release()

        // give a little time for queued waiter to be scheduled if implementation is buggy
        await delay(20)

        // expect pB to resolve
        await expect(pB).resolves.toBeUndefined()
    })
})

describe('Semaphore.tryAcquire', () => {
    test('tryAcquire succeeds when below limit', () => {
        const s = new Semaphore(2)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)
    })

    test('tryAcquire fails when at limit', () => {
        const s = new Semaphore(1)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)
        expect(s.tryAcquire()).toBe(false)
        expect(s.count).toBe(1) // count should not change
    })

    test('tryAcquire succeeds multiple times until limit is reached', () => {
        const s = new Semaphore(3)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(2)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(3)
        expect(s.tryAcquire()).toBe(false)
        expect(s.count).toBe(3)
    })

    test('tryAcquire succeeds after release', () => {
        const s = new Semaphore(1)
        expect(s.tryAcquire()).toBe(true)
        expect(s.tryAcquire()).toBe(false)

        s.release()
        expect(s.count).toBe(0)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)
    })

    test('tryAcquire works alongside acquire', async () => {
        const s = new Semaphore(2)

        // Use tryAcquire to get first slot
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)

        // Use acquire to get second slot
        await s.acquire()
        expect(s.count).toBe(2)

        // Both tryAcquire and acquire should now fail/wait
        expect(s.tryAcquire()).toBe(false)

        const p = s.acquire()
        await delay(10)
        // p should still be pending

        // Release one slot
        s.release()
        // The waiting acquire should get it
        await expect(p).resolves.toBeUndefined()
        expect(s.count).toBe(2)

        // tryAcquire should still fail
        expect(s.tryAcquire()).toBe(false)

        // Release another slot
        s.release()
        expect(s.count).toBe(1)

        // Now tryAcquire should succeed
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(2)
    })

    test('tryAcquire requires release like acquire', () => {
        const s = new Semaphore(1)
        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)

        // Must release before another acquisition
        s.release()
        expect(s.count).toBe(0)

        expect(s.tryAcquire()).toBe(true)
        expect(s.count).toBe(1)
    })
})

function makeSyncAbortingSignal(reason: any) {
    let aborted = false
    return {
        get aborted() {
            return aborted
        },
        reason,
        addEventListener(_type: string, listener: any) {
            // simulate the race: the signal becomes aborted and invokes the listener synchronously
            aborted = true
            if (typeof listener === 'function') {
                listener()
            } else if (listener && typeof listener.handleEvent === 'function') {
                listener.handleEvent()
            }
        },
    }
}

describe('Semaphore race conditions', () => {
    test('synchronously-aborting signal should not cause acquire to throw and should not block next waiter', async () => {
        const s = new Semaphore(1)
        // consume the only slot
        await s.acquire()

        const syncSignal = makeSyncAbortingSignal('sync-reason')

        let pA: Promise<void>
        // acquiring with a signal that aborts synchronously must not throw synchronously
        try {
            pA = s.acquire(syncSignal as unknown as AbortSignal)
        } catch (err) {
            throw new Error('acquire threw synchronously: ' + String(err))
        }

        const pB = s.acquire()

        // the aborted waiter must reject with the abort reason
        await expect(pA).rejects.toBe('sync-reason')

        // releasing should grant the slot to the next waiter (no stale entry blocking)
        s.release()
        await expect(pB).resolves.toBeUndefined()
    })
})

test('synchronously-aborting signal during listener registration should not leave stale queue entry', async () => {
    const s = new Semaphore(1)
    // consume the only slot
    await s.acquire()

    // Create a signal that aborts synchronously when addEventListener is called
    const syncSignal = makeSyncAbortingSignal('sync-reason')

    // Acquire with the synchronously-aborting signal
    const pA = s.acquire(syncSignal as unknown as AbortSignal)

    // The promise should reject
    await expect(pA).rejects.toBe('sync-reason')

    // At this point, if there's a race condition, the queue might have a stale entry
    // Check queue size directly (you may need to expose this for testing)
    expect(s['queue'].size).toBe(0) // Should be empty, but with the bug it will be 1

    // Release the slot - should decrement count, not try to resolve a stale queue entry
    s.release()
    expect(s.count).toBe(0)

    // A subsequent acquire should work immediately
    await expect(s.acquire()).resolves.toBeUndefined()
    expect(s.count).toBe(1)
})