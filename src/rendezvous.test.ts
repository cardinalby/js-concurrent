import { Rendezvous } from './rendezvous'

describe('Rendezvous', () => {
    test('resolves immediately when count is 1', async () => {
        const barrier = new Rendezvous(1)
        await expect(barrier.arrive()).resolves.toBeUndefined()
    })

    test('all participants are released when the last one arrives', async () => {
        const barrier = new Rendezvous(3)
        const order: string[] = []

        const participants = [1, 2, 3].map(id =>
            barrier.arrive().then(() => order.push(`released-${id}`))
        )

        await Promise.all(participants)
        expect(order).toHaveLength(3)
        // all three must be released (order may vary)
        expect(order.sort()).toEqual(['released-1', 'released-2', 'released-3'])
    })

    test('participants do not resolve until all have arrived', async () => {
        const barrier = new Rendezvous(3)
        const resolved: boolean[] = [false, false, false]

        const p1 = barrier.arrive().then(() => { resolved[0] = true })
        const p2 = barrier.arrive().then(() => { resolved[1] = true })

        // yield to microtask queue — p1 and p2 should still be pending
        await Promise.resolve()
        expect(resolved[0]).toBe(false)
        expect(resolved[1]).toBe(false)

        // third participant arrives — all should resolve now
        const p3 = barrier.arrive().then(() => { resolved[2] = true })
        await Promise.all([p1, p2, p3])

        expect(resolved).toEqual([true, true, true])
    })

    test('is reusable across multiple rounds', async () => {
        const barrier = new Rendezvous(2)
        const results: number[] = []

        // Round 1
        await Promise.all([
            barrier.arrive().then(() => results.push(1)),
            barrier.arrive().then(() => results.push(1)),
        ])

        // Round 2
        await Promise.all([
            barrier.arrive().then(() => results.push(2)),
            barrier.arrive().then(() => results.push(2)),
        ])

        expect(results.filter(r => r === 1)).toHaveLength(2)
        expect(results.filter(r => r === 2)).toHaveLength(2)
    })

    test('second round does not resolve until all participants arrive again', async () => {
        const barrier = new Rendezvous(2)

        // Complete round 1
        await Promise.all([barrier.arrive(), barrier.arrive()])

        // Start round 2: only one participant arrives
        const resolved = { value: false }
        const p = barrier.arrive().then(() => { resolved.value = true })

        await Promise.resolve()
        expect(resolved.value).toBe(false)

        // Second participant completes round 2
        await Promise.all([p, barrier.arrive()])
        expect(resolved.value).toBe(true)
    })

    test('all participants receive the same resolved value (undefined)', async () => {
        const barrier = new Rendezvous(3)
        const results = await Promise.all([
            barrier.arrive(),
            barrier.arrive(),
            barrier.arrive(),
        ])
        expect(results).toEqual([undefined, undefined, undefined])
    })

    test('participants arriving at different times are all released together', async () => {
        const barrier = new Rendezvous(3)
        const releaseTimestamps: number[] = []

        function delayedArrive(ms: number) {
            return new Promise<void>(res => setTimeout(res, ms))
                .then(() => barrier.arrive())
                .then(() => releaseTimestamps.push(Date.now()))
        }

        await Promise.all([
            delayedArrive(0),
            delayedArrive(10),
            delayedArrive(20),
        ])

        // All three should have resolved within a very short window of each other
        const min = Math.min(...releaseTimestamps)
        const max = Math.max(...releaseTimestamps)
        expect(max - min).toBeLessThan(50)
    })
})

describe('Rendezvous.wait', () => {
    test('resolves when all participants arrive', async () => {
        const barrier = new Rendezvous(2)
        let waitResolved = false

        const w = barrier.wait().then(() => { waitResolved = true })

        await Promise.resolve()
        expect(waitResolved).toBe(false)

        await Promise.all([barrier.arrive(), barrier.arrive(), w])
        expect(waitResolved).toBe(true)
    })

    test('does not count toward the required arrivals', async () => {
        const barrier = new Rendezvous(2)

        // Even with many wait() calls, arrive() still needs exactly count arrivals
        const waiters = [barrier.wait(), barrier.wait(), barrier.wait()]

        let arrived = false
        const w = Promise.all(waiters).then(() => { arrived = true })

        await Promise.resolve()
        expect(arrived).toBe(false)

        // Only 2 arrive() calls should trigger resolution
        await Promise.all([barrier.arrive(), barrier.arrive(), w])
        expect(arrived).toBe(true)
    })

    test('multiple wait() callers are all released when barrier triggers', async () => {
        const barrier = new Rendezvous(2)
        const released: string[] = []

        const w1 = barrier.wait().then(() => released.push('w1'))
        const w2 = barrier.wait().then(() => released.push('w2'))
        const p1 = barrier.arrive().then(() => released.push('p1'))
        const p2 = barrier.arrive().then(() => released.push('p2'))

        await Promise.all([w1, w2, p1, p2])
        expect(released.sort()).toEqual(['p1', 'p2', 'w1', 'w2'])
    })

    test('wait() in next round is not affected by previous round', async () => {
        const barrier = new Rendezvous(2)

        // Complete round 1
        await Promise.all([barrier.arrive(), barrier.arrive()])

        // wait() in round 2 should not be immediately resolved
        let resolved = false
        const w = barrier.wait().then(() => { resolved = true })

        await Promise.resolve()
        expect(resolved).toBe(false)

        await Promise.all([barrier.arrive(), barrier.arrive(), w])
        expect(resolved).toBe(true)
    })
})

describe('Rendezvous.abort', () => {
    test('rejects all waiting arrive() promises with the given reason', async () => {
        const barrier = new Rendezvous(3)
        const reason = new Error('cancelled')

        const p1 = barrier.arrive()
        const p2 = barrier.arrive()

        barrier.abort(reason)

        await expect(p1).rejects.toThrow('cancelled')
        await expect(p2).rejects.toThrow('cancelled')
    })

    test('rejects all waiting wait() promises with the given reason', async () => {
        const barrier = new Rendezvous(3)
        const reason = new Error('cancelled')

        const w1 = barrier.wait()
        const w2 = barrier.wait()

        barrier.abort(reason)

        await expect(w1).rejects.toThrow('cancelled')
        await expect(w2).rejects.toThrow('cancelled')
    })

    test('rejects both arrive() and wait() promises together', async () => {
        const barrier = new Rendezvous(3)
        const reason = 'round-cancelled'

        const p = barrier.arrive()
        const w = barrier.wait()

        barrier.abort(reason)

        await expect(p).rejects.toBe(reason)
        await expect(w).rejects.toBe(reason)
    })

    test('resets the barrier — next round works normally', async () => {
        const barrier = new Rendezvous(2)

        const p1 = barrier.arrive()
        barrier.abort('oops')
        await expect(p1).rejects.toBe('oops')

        // New round should work as if nothing happened
        await expect(Promise.all([barrier.arrive(), barrier.arrive()])).resolves.toBeDefined()
    })

    test('abort() resets waiting count so next round needs full count again', async () => {
        const barrier = new Rendezvous(2)

        // One participant arrives before abort
        const p1 = barrier.arrive()
        barrier.abort('reset')
        await expect(p1).rejects.toBe('reset')

        // Next round: only 1 arrives — should still be pending
        const resolved = { value: false }
        const p2 = barrier.arrive().then(() => { resolved.value = true })

        await Promise.resolve()
        expect(resolved.value).toBe(false)

        // Second arrival completes the round
        await Promise.all([p2, barrier.arrive()])
        expect(resolved.value).toBe(true)
    })

    test('uses a default AbortError reason when none is provided', async () => {
        const barrier = new Rendezvous(2)
        const p = barrier.arrive()

        barrier.abort()

        await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    test('can be used with AbortSignal', async () => {
        const barrier = new Rendezvous(3)
        const ac = new AbortController()

        const p1 = barrier.arrive()
        const p2 = barrier.arrive()

        ac.signal.addEventListener('abort', () => barrier.abort(ac.signal.reason))
        ac.abort('timed-out')

        await expect(p1).rejects.toBe('timed-out')
        await expect(p2).rejects.toBe('timed-out')
    })
})
