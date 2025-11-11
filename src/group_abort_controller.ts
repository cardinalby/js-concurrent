export function createGroupAc(parentSignal?: AbortSignal): AbortController {
    if (parentSignal?.aborted) {
        const ac = new AbortController()
        ac.abort(parentSignal.reason)
        return ac
    }
    const ac = new AbortController()

    parentSignal?.addEventListener(
        'abort',
        () => ac.abort(parentSignal.reason),
        {
            signal: ac.signal,
            once: true,
        },
    )

    return ac
}