/**
 * A counting semaphore implementation for controlling concurrent access to a resource.
 * Allows acquiring and releasing slots up to a specified limit.
 * Supports waiting for slots to become available and aborting waits via AbortSignal.
 */
export class Semaphore {
    private queue: Set<() => void> = new Set()
    public count: number = 0

    /**
     * Creates a semaphore with the given limit on concurrent acquisitions
     */
    constructor(
        private readonly limit: number
    ) {}

    /**
     * Acquires a semaphore slot, waiting if necessary.
     * If an AbortSignal is provided and is aborted before acquisition, the promise rejects with the abort reason
     * and the acquisition is cancelled (can be used to time out the wait).
     * After a successful acquisition, the caller must call `release()` to free the slot.
     */
    acquire(abortSignal?: AbortSignal): Promise<void> {
        if (abortSignal?.aborted) {
            return Promise.reject(abortSignal.reason)
        }
        if (this.count < this.limit) {
            this.count++
            return Promise.resolve()
        }

        return new Promise((resolve, reject) => {
            let entry: () => void
            let isSettled = false

            if (abortSignal) {
                const listenAbortController = new AbortController()
                abortSignal.addEventListener('abort', () => {
                    reject(abortSignal.reason)
                    if (!isSettled) {
                        isSettled = true
                        this.queue.delete(entry!)
                    }
                }, {
                    once: true,
                    signal: listenAbortController.signal
                })
                entry = () => {
                    if (!abortSignal.aborted) {
                        isSettled = true
                        resolve()
                        listenAbortController.abort('not_relevant')
                    }
                }
            } else {
                entry = resolve
            }
            if (!isSettled) {
                this.queue.add(entry)
            }
        })
    }

    /**
     * Attempts to acquire a semaphore slot without waiting.
     * Returns true if acquisition succeeded, false if the limit has been reached.
     * The caller must call `release()` to free the slot if acquisition succeeded.
     */
    tryAcquire(): boolean {
        if (this.count < this.limit) {
            this.count++
            return true
        }
        return false
    }

    /**
     * Releases a previously acquired semaphore slot, allowing the next waiter (if any) to proceed.
     */
    release(): void {
        const resolveFunc = this.queue.values().next().value
        if (resolveFunc) {
            this.queue.delete(resolveFunc)
            resolveFunc()
        } else {
            this.count--
            if (this.count < 0) {
                this.count = 0
                throw new Error('Semaphore released more times than acquired')
            }
        }
    }
}