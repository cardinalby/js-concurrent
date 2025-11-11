export function raceWithAbortSignal<T>(
    promise: Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    if (!signal) {
        return promise
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason)
    }
    return new Promise<T>((resolve, reject) => {
        const abortListener = () => {
            reject(signal.reason)
        }
        signal.addEventListener('abort', abortListener, {once: true})
        promise.finally(() => {
            signal.removeEventListener('abort', abortListener)
        }).then(resolve, reject)
    })
}