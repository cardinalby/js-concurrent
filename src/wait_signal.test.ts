import { waitSignal } from './wait_signal'

describe('waitSignal', () => {
    describe('signal already aborted', () => {
        test('rejects with signal reason by default (shouldResolve = false)', async () => {
            const reason = new Error('already aborted')
            const controller = new AbortController()
            controller.abort(reason)

            await expect(waitSignal(controller.signal)).rejects.toBe(reason)
        })

        test('resolves when shouldResolve = true', async () => {
            const controller = new AbortController()
            controller.abort()

            await expect(waitSignal(controller.signal, true)).resolves.toBeUndefined()
        })
    })

    describe('signal aborted after creation', () => {
        test('rejects with signal reason by default (shouldResolve = false)', async () => {
            const reason = new Error('aborted later')
            const controller = new AbortController()

            const promise = waitSignal(controller.signal)
            controller.abort(reason)

            await expect(promise).rejects.toBe(reason)
        })

        test('resolves when shouldResolve = true', async () => {
            const controller = new AbortController()

            const promise = waitSignal(controller.signal, true)
            controller.abort()

            await expect(promise).resolves.toBeUndefined()
        })

        test('rejects with default DOMException reason when no reason provided', async () => {
            const controller = new AbortController()

            const promise = waitSignal(controller.signal)
            controller.abort()

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
        })
    })

    test('does not resolve or reject before signal is aborted', async () => {
        const controller = new AbortController()
        let settled = false

        waitSignal(controller.signal).then(
            () => { settled = true },
            () => { settled = true }
        )

        // Allow microtasks to flush
        await Promise.resolve()
        expect(settled).toBe(false)

        controller.abort()
        await Promise.resolve()
        expect(settled).toBe(true)
    })
})
