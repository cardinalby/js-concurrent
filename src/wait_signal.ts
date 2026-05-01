/**
 * Wait for an AbortSignal to be aborted, and resolve or reject accordingly.
 * @param signal The AbortSignal to wait for.
 * @param shouldResolve Whether to resolve or reject when the signal is aborted. Default is false (reject).
 * @returns A Promise that resolves or rejects when the signal is aborted.
 */
export function waitSignal(
    signal: AbortSignal,
    shouldResolve: boolean = false
): Promise<void> {
    return new Promise((resolve, reject) => {
        const fire = () => {
            if (shouldResolve) {
                resolve()
            } else {
                reject(signal.reason)
            }
        }
        if (signal.aborted) {
            fire()
        } else {
            signal.addEventListener('abort', fire, {once: true})
        }
    })
}