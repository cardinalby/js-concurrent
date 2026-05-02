import {RunOptions, TaskFn} from "./common";
import {allWithAbort} from "./all_with_abort";
import {raceWithAbort} from "./race_with_abort";
import {anyWithAbort} from "./any_with_abort";
import {allSettledWithAbort} from "./all_settled_with_abort";

// ─── Type space ──────────────────────────────────────────────────────────────

/**
 * A Task<T> is a lazy, cancellable async operation: a function that accepts an
 * AbortSignal and returns a Promise<T>.
 *
 * Plain arrow/async functions satisfy this interface directly:
 *
 *   const t: Task<string> = signal => fetch('/api', { signal }).then(r => r.text())
 *
 * You can also construct one explicitly with `new Task(...)`.
 */
export interface Task<T> {
    (signal: AbortSignal): Promise<T>
}

/**
 * Describes the Task constructor and its static methods.
 * Mirrors the pattern used by the built-in Promise type.
 */
export interface TaskConstructor {
    /**
     * Create a Task with a Promise-style executor.
     * The executor receives resolve, reject, and an AbortSignal.
     *
     * @example
     * const t = new Task<string>((resolve, reject, signal) => {
     *     fetch('/api', { signal }).then(r => r.text()).then(resolve, reject)
     * })
     */
    new <T>(executor: (
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: any) => void,
        signal: AbortSignal
    ) => void): Task<T>

    /**
     * Run all tasks concurrently and return all results in order.
     * If any task fails, all remaining tasks are aborted.
     * Similar to Promise.all().
     */
    all<T extends readonly Task<unknown>[] | []>(
        tasks: T,
        options?: RunOptions
    ): Promise<{ -readonly [P in keyof T]: Awaited<ReturnType<T[P]>> }>
    all<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T[]>

    /**
     * Return the result of the first task to complete (resolve or reject).
     * All other tasks are aborted with GotRaceWinnerError.
     * Similar to Promise.race().
     */
    race<T extends readonly Task<unknown>[] | []>(
        tasks: T,
        options?: RunOptions
    ): Promise<Awaited<ReturnType<T[number]>>>
    race<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T>

    /**
     * Return the result of the first task to successfully resolve.
     * All other tasks are aborted with GotRaceWinnerError.
     * If all tasks reject, rejects with AggregateError.
     * Similar to Promise.any().
     */
    any<T extends readonly Task<unknown>[] | []>(
        tasks: T,
        options?: RunOptions
    ): Promise<Awaited<ReturnType<T[number]>>>
    any<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T>

    /**
     * Run all tasks and return their settled results.
     * Task failures do NOT abort other tasks.
     * Similar to Promise.allSettled().
     */
    allSettled<T extends readonly Task<unknown>[] | []>(
        tasks: T,
        options?: RunOptions
    ): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[P]>>> }>
    allSettled<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<PromiseSettledResult<T>[]>

    readonly prototype: object
}

// ─── Value space (runtime) ───────────────────────────────────────────────────

/**
 * Constructor function whose instances are themselves callable functions.
 *
 * Returning `fn` (a function object) from the constructor causes `new Task(...)`
 * to return that function instead of `this` — JavaScript allows constructors to
 * return any object. Setting its prototype to TaskImpl.prototype makes
 * `instanceof Task` work correctly.
 */
function TaskImpl(
    this: unknown,
    executor: (
        resolve: (value: any) => void,
        reject: (reason?: any) => void,
        signal: AbortSignal
    ) => void
) {
    const fn: TaskFn<any> = (signal: AbortSignal) =>
        new Promise((resolve, reject) => executor(resolve, reject, signal))
    Object.setPrototypeOf(fn, TaskImpl.prototype)
    return fn
}

// Instances are functions, so prototype must sit on Function.prototype's chain
// so that the returned fn has the right [[Prototype]].
TaskImpl.prototype = Object.create(Function.prototype)
TaskImpl.prototype.constructor = TaskImpl

TaskImpl.all = function <T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T[]> {
    return allWithAbort(tasks as Iterable<TaskFn<any>>, options) as Promise<T[]>
}

TaskImpl.race = function <T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T> {
    return raceWithAbort(tasks as Iterable<TaskFn<any>>, options) as Promise<T>
}

TaskImpl.any = function <T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T> {
    return anyWithAbort(tasks as Iterable<TaskFn<any>>, options) as Promise<T>
}

TaskImpl.allSettled = function <T>(
    tasks: Iterable<Task<T>>,
    options?: RunOptions
): Promise<PromiseSettledResult<T>[]> {
    return allSettledWithAbort(tasks as Iterable<TaskFn<any>>, options) as Promise<PromiseSettledResult<T>[]>
}

/**
 * Task — bind the implementation to the declared types.
 * The `as unknown as TaskConstructor` cast is required because TypeScript cannot
 * verify that a plain function satisfies the full generic TaskConstructor
 * interface without it.
 */
export const Task = TaskImpl as unknown as TaskConstructor
