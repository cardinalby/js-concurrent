import {Semaphore} from "./semaphore";

/**
 * ConcurrencyLimiter is a function that limits the number of concurrent executions
 * of the provided async function to a specified maximum.
 * After aboutSignal is aborted, the limiter will not start new executions
 * and will reject with the abort reason.
 */
export type ConcurrencyLimiter = <T>(
    fn: () => Promise<T>,
    abortSignal?: AbortSignal
) => Promise<T>

/**
 * Creates a new ConcurrencyLimiter that allows up to maxConcurrency
 * concurrent executions of the provided async function.
 */
export function newLimiter(maxConcurrency: number): ConcurrencyLimiter {
    let semaphore = new Semaphore(maxConcurrency)

    return async function <T>(
        action: () => Promise<T>,
        abortSignal?: AbortSignal
    ): Promise<T> {
        await semaphore.acquire(abortSignal)
        try {
            return await action()
        } finally {
            semaphore.release()
        }
    }
}

