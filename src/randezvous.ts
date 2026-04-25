/**
 * Rendezvous is a reusable synchronization barrier for a fixed number of async participants.
 *
 * It solves the problem of coordinating N concurrent tasks that must all reach a certain
 * point before any of them is allowed to continue. This is useful when you have multiple
 * independent async workers that need to synchronize at a checkpoint — e.g. all workers
 * must finish phase 1 before any of them starts phase 2.
 *
 * Unlike a one-shot Promise, Rendezvous is reusable: once all participants have arrived
 * and are released, the barrier automatically resets for the next round.
 *
 * @example
 * const barrier = new Rendezvous(3)
 *
 * async function worker(id: number) {
 *     console.log(`${id}: doing phase 1`)
 *     await barrier.arrive()           // wait for all 3 workers to reach this point
 *     console.log(`${id}: doing phase 2`)
 * }
 *
 * await Promise.all([worker(1), worker(2), worker(3)])
 */
export class Rendezvous {
    private waiting = 0
    private releaseAll: (err?: unknown) => void = () => {}
    private promise: Promise<void> = this.createPromise()

    constructor(
        private readonly count: number
    ) {}

    /**
     * Signals that the caller has reached the barrier and waits until all `count`
     * participants have arrived.
     *
     * The returned promise resolves only when every one of the `count` participants
     * has called `arrive()`. The last participant to arrive triggers the release of
     * all waiting callers simultaneously.
     *
     * After release the barrier resets automatically, so the same `Rendezvous` instance
     * can be reused for subsequent rounds with the same participants.
     *
     * @example
     * // Each of the `count` workers calls arrive() at the end of a phase:
     * await barrier.arrive()
     * // All workers continue past this line only after every worker has arrived.
     */
    async arrive(): Promise<void> {
        this.waiting++
        // Capture the current barrier promise before any reset so that the last
        // participant (which triggers the reset) still awaits the correct promise.
        const currentPromise = this.promise
        if (this.waiting >= this.count) {
            // reset BEFORE resolving (important for reuse)
            this.waiting = 0
            const releaseAll = this.releaseAll
            this.promise = this.createPromise()
            releaseAll()
        }
        return currentPromise
    }

    /**
     * Waits for the current round to complete without counting as a participant.
     *
     * Unlike `arrive()`, `wait()` does not increment the arrival count — the barrier
     * triggers based solely on `arrive()` calls. Use it to observe the barrier from
     * the outside: a coordinator waiting for all workers to sync, a timeout race, or
     * any logic that should unblock when the round completes but must not be one of
     * the N required arrivals.
     *
     * The returned promise resolves (or rejects, if `abort()` is called) at the same
     * time as the promises returned by the current round's `arrive()` calls.
     *
     * @example
     * // Coordinator waits for all workers without being counted:
     * await barrier.wait()
     *
     * // Passive wait with a timeout — does not affect the barrier if it times out:
     * await Promise.race([barrier.wait(), sleep(5000)])
     */
    async wait(): Promise<void> {
        return this.promise
    }

    /**
     * Cancels the current round: all promises currently returned by `arrive()` and
     * `wait()` reject with `reason`, and the barrier resets for the next round.
     *
     * If `reason` is omitted, a standard `DOMException` with `name === 'AbortError'`
     * is used — the same default produced by `AbortController.abort()`.
     *
     * Participants that call `arrive()` after `abort()` begin a fresh round normally.
     *
     * Use this when an external coordinator detects that the current round cannot
     * complete — for example, when wiring an `AbortSignal` to the barrier:
     *
     * @example
     * signal.addEventListener('abort', () => barrier.abort(signal.reason))
     */
    abort(reason?: unknown): void {
        const releaseAll = this.releaseAll
        this.waiting = 0
        this.promise = this.createPromise()
        if (reason === undefined) {
            // create abort error
            const ac = new AbortController()
            ac.abort()
            reason = ac.signal.reason
        }
        releaseAll(reason)
    }

    private createPromise() {
        return new Promise<void>((res, rej) => {
            this.releaseAll = (err?: unknown) => err !== undefined ? rej(err) : res()
        })
    }
}
