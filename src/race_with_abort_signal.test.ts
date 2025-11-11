import {raceWithAbortSignal} from "./race_with_abort_signal";

describe('raceWithAbortSignal', () => {
    it('resolves before abort', async () => {
        const ac = new AbortController()
        const result = await raceWithAbortSignal(
            new Promise<string>(resolve => {
                setTimeout(() => resolve('done'), 50)
            }),
            ac.signal
        )
        expect(result).toBe('done')
    })

    it('rejects on abort before resolution', async () => {
        const ac = new AbortController()
        const err = new Error('aborted')
        setTimeout(() => ac.abort(err), 20)
        await expect(raceWithAbortSignal(
            new Promise<string>(resolve => {
                setTimeout(() => resolve('done'), 50)
            }),
            ac.signal
        )).rejects.toEqual(err)
    })

    it('resolves immediately if signal already aborted', async () => {
        const err = new Error('already aborted')
        const ac = new AbortController()
        ac.abort(err)
        await expect(raceWithAbortSignal(
            new Promise<string>(resolve => {
                setTimeout(() => resolve('done'), 50)
            }),
            ac.signal
        )).rejects.toEqual(err)
    })

    it('handles promise rejection before abort', async () => {
        const ac = new AbortController()
        const err = new Error('promise failed')
        await expect(raceWithAbortSignal(
            new Promise<string>((_, reject) => {
                setTimeout(() => reject(err), 30)
            }),
            ac.signal
        )).rejects.toEqual(err)
    })

    it('handles abort before promise rejection', async () => {
        const ac = new AbortController()
        const abortErr = new Error('aborted first')
        const promiseErr = new Error('promise failed')
        setTimeout(() => ac.abort(abortErr), 20)
        await expect(raceWithAbortSignal(
            new Promise<string>((_, reject) => {
                setTimeout(() => reject(promiseErr), 50)
            }),
            ac.signal
        )).rejects.toEqual(abortErr)
    })
})