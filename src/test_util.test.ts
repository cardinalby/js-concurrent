import {Task} from "./common";

export function delay(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms))
}

export class CancellableTasksTracker {
    readonly abortedTasks = new Map<number, any>()
    readonly executionOrder: number[] = []
    readonly resolvedTasks: number[] = []
    readonly selfRejectedTasks: number[] = []
    readonly currentlySleepingTasks = new Set<number>()
    firstReceivedSignal: AbortSignal | null | undefined = null
    maxSeenConcurrentTasks = 0

    constructor(private readonly maxConcurrentTasks: number) {
    }

    public createTask(
        id: number,
        delayMs: number,
        result: any|Error,
        options?: {
            onStart?: (signal?: AbortSignal) => void
            ignoreSignal?: boolean
        },
    ) : Task<any> {
        return async (signal?: AbortSignal) => {
            return new Promise<any>((resolve, reject) => {
                let signalSub: (() => void) | undefined = undefined
                this.beforeDelay(id, signal)
                const timeoutId = setTimeout(() => {
                    if (signal && signalSub) {
                        signal.removeEventListener('abort', signalSub)
                    }
                    if (result instanceof Error) {
                        this.onRejectWithResult(id)
                        reject(result)
                    } else {
                        this.onResolveWithResult(id)
                        resolve(result)
                    }
                }, delayMs)

                if (signal) {
                    signalSub = () => {
                        this.onAbort(id, signal.reason, !!options?.ignoreSignal)
                        if (!options?.ignoreSignal) {
                            reject(signal.reason)
                            clearTimeout(timeoutId)
                        }
                    }
                    signal.addEventListener('abort', signalSub, { once: true })
                }
            })
        }
    }

    private onAbort(id: number, reason: any, isIgnored: boolean) {
        this.abortedTasks.set(id, reason)
        if (!isIgnored) {
            this.currentlySleepingTasks.delete(id)
        }
    }

    private onResolveWithResult(id: number) {
        this.resolvedTasks.push(id)
        this.currentlySleepingTasks.delete(id)
    }

    private onRejectWithResult(id: number) {
        this.selfRejectedTasks.push(id)
        this.currentlySleepingTasks.delete(id)
    }

    private beforeDelay(id: number, signal?: AbortSignal) {
        if (this.firstReceivedSignal === null) {
            this.firstReceivedSignal = signal
        } else {
            expect(signal).toBe(this.firstReceivedSignal)
        }
        this.currentlySleepingTasks.add(id)
        this.maxSeenConcurrentTasks = Math.max(
            this.maxSeenConcurrentTasks,
            this.currentlySleepingTasks.size
        )
        expect(this.currentlySleepingTasks.size).toBeLessThanOrEqual(this.maxConcurrentTasks)
        this.executionOrder.push(id)
    }
}

describe('CancellableTasksTracker', () => {
    it('tracks task execution correctly', async () => {
        const tracker = new CancellableTasksTracker(2)
        const task1 = tracker.createTask(1, 100, 'result1')
        const task2 = tracker.createTask(2, 200, new Error('error2'))

        await Promise.allSettled([
            task1(),
            task2()
        ])

        expect(tracker.executionOrder).toEqual([1, 2])
        expect(tracker.resolvedTasks).toEqual([1])
        expect(tracker.selfRejectedTasks).toEqual([2])
        expect(tracker.abortedTasks.size).toBe(0)
        expect(tracker.maxSeenConcurrentTasks).toBe(2)
    })
})