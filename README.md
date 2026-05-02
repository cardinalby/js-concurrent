[![test](https://github.com/cardinalby/js-concurrent/actions/workflows/test.yml/badge.svg)](https://github.com/cardinalby/js-concurrent/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/js-concurrent.svg)](https://www.npmjs.com/package/js-concurrent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**Abort-aware concurrency primitives for JavaScript/TypeScript**, inspired by Go's 
[errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup) pattern.

This library provides enhanced versions of `Promise.all()`, `Promise.race()`, `Promise.any()`, 
and `Promise.allSettled()` that support:

- 🚫 **Abort signals** - Cancel operations gracefully with `AbortSignal`
- 🎯 **Concurrency limiting** - Control how many tasks run simultaneously
- ⚡ **Smart cancellation** - Auto-abort remaining tasks when one fails or succeeds

## Installation

```bash
npm install js-concurrent
```

### Why Tasks Instead of Promises?

Native `Promise.all()` accepts **promises** that have already started executing:

```typescript
// ❌ Promises start immediately, can't be cancelled
await Promise.all([
    fetch('/api/1').then(res => res.json()), // starts immediately
    fetch('/api/2').then(res => res.json()), // starts immediately
])
```

The library uses **`Task` functions** instead:
- 🚀 Task receives an `AbortSignal` and returns a `Promise<T>` when executed
- 🛑 Execution may be deferred (concurrency limiting) until needed, and can be canceled via the signal

```typescript
// ✅ Tasks start when needed and can be cancelled
await Task.all([
    signal => fetch('/api/1', { signal }).then(res => res.json()),  // if `api/1` fails,
    signal => fetch('/api/2', { signal }).then(res => res.json()),  // `api/2` will be automatically aborted
])
```

## API Reference

### ◆ `Task<T>`

A `Task` is a lazy, cancellable async operation — like a Promise that hasn't started yet. Similar to `Promise`, it
can be used as an interface and as a constructor and has static helper methods.

```typescript
const t1: Task<string> = signal => 
    (fetch('https://api.example.com', { signal })).then(res => res.json())

const t2: Task<string> = new Task((resolve, reject, signal) => {
    // ... start signal-aware async operation - will be called only once the task is executed
    resolve('result'); // or reject(error)
})
```

### ◆ `RunOptions`

Options accepted by all `Task` static methods:

```typescript
interface RunOptions {
     // Maximum number of tasks to run concurrently.
     // If not specified or <= 0, all tasks run concurrently.
    concurrency?: number
    
    // AbortSignal to cancel the entire group of tasks
    signal?: AbortSignal
}
```

### ◆ `Task.all`

Similar to `Promise.all()`: runs all tasks and returns all results in order. If any task fails, all other tasks 
are automatically aborted.

```typescript
Task.all<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T[]>
```

#### Behavior

- ✅ All tasks must succeed for the promise to resolve
- ❌ If any task fails, remaining tasks are aborted and the promise rejects with the first error
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started, 
  the resulting Promise is rejected with the abort reason
- ⚙️ Respects `concurrency` option - tasks wait their turn to start
- 📊 Results maintain input order regardless of completion order

#### Example

```typescript
const results = await Task.all([
    signal => fetch('/api/1', { signal }).then(res => res.json()),
    signal => fetch('/api/2', { signal }).then(res => res.json()),
])

// [result1, result2] or throws if any task fails (with others aborted)
console.log(results); 
```

### ◆ `Task.race`

Similar to `Promise.race()`: returns the first task to complete (resolve or reject) and aborts all others.

```typescript
Task.race<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T>
```

#### Behavior

- 🏁 Returns the first task that completes (whether it succeeds or fails)
- 🛑 When a task completes, all other tasks are aborted with `GotRaceWinnerError`
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started
- ⚙️ Respects `concurrency` option - tasks wait their turn to start

#### Example

```typescript
import { Task } from 'js-concurrent';

// Race between multiple API endpoints
const result = await Task.race([
    signal => fetch('/api/1', { signal }).then(res => res.json()),
    signal => fetch('/api/2', { signal }).then(res => res.json()),
])

// All other fetches are aborted with GotRaceWinnerError once the first completes
console.log('First response:', result)
```

### ◆ `Task.any`

Similar to `Promise.any()`: returns the first task to **successfully resolve** and aborts all others.

```typescript
Task.any<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<T>
```

#### Behavior

- ✅ Returns the first task that **succeeds**
- ❌ Task rejections are collected; if all tasks fail, returns `AggregateError`
- 🛑 When a task succeeds, all other tasks are aborted with `GotRaceWinnerError`
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started
- ⚙️ Respects `concurrency` option - tasks wait their turn to start

#### Example

```typescript
// Try multiple fallback sources
try {
    const data = await Task.any([
        async (signal) => fetchPrimarySource(signal),
        async (signal) => fetchBackupSource(signal),
        async (signal) => fetchFromCache(signal)
    ])
    console.log('Got data:', data)
} catch (error) {
  // All sources failed
  console.error('All sources failed:', error)
}
```

### ◆ `Task.allSettled`

Similar to `Promise.allSettled()`: runs all tasks and returns their settled results. Unlike `Task.all`, 
task failures do **not** abort other tasks.

```typescript
Task.allSettled<T>(tasks: Iterable<Task<T>>, options?: RunOptions): Promise<PromiseSettledResult<T>[]>
```

#### Behavior

- 📊 All tasks run to completion unless `options.signal` is aborted
- ✅ Returns array of `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }` objects
- 🛑 If `options.signal` is aborted, all running tasks are aborted and un-started tasks are marked as rejected
- ⚙️ Respects `concurrency` option - tasks wait their turn to start

---

### ◆ `newLimiter`

Creates a reusable concurrency limiter that restricts how many operations can run simultaneously.

```typescript
type ConcurrencyLimiter = <T>(
    fn: () => Promise<T>,
    signal?: AbortSignal
) => Promise<T>;

function newLimiter(maxConcurrency: number): ConcurrencyLimiter;
```

#### Example

```typescript
import { newLimiter } from 'js-concurrent';

// Create a limiter that allows max 3 concurrent operations
const limiter = newLimiter(3)

const urls = [/* many URLs */]

await Promise.all(
  urls.map(url => 
      limiter(async () => {
          const response = await fetch(url)
          return await response.json()
      })
)
);
```

---

### ◆ Semaphore

A counting semaphore for fine-grained concurrency control.

```typescript
class Semaphore {
    constructor(limit: number)
    
     // Acquire a slot, waiting if necessary.
     // Must call release() after done.
    acquire(signal?: AbortSignal): Promise<void>
    
    
    // Try to acquire without waiting.
    // Returns true if acquired, false otherwise.
    tryAcquire(): boolean
    
    // Release a previously acquired slot
    release(): void
  
    // Current number of acquired slots 
    readonly count: number
}
```

---

### ◆ Rendezvous

A reusable synchronization barrier: blocks all participants until every one of the
required `count` has arrived, then releases them all simultaneously and resets for
the next round.

```typescript
class Rendezvous {
    constructor(count: number)
  
    // Counts this caller as arrived and waits until all `count` participants
    // have called arrive(). The last arrival releases everyone at once.
    arrive(): Promise<void>
  
    
    // Waits for the current round to complete without counting as a participant.
    // Useful for coordinators, timeouts, or any observer that must not be one
    // of the N required arrivals.
    wait(): Promise<void>
  
    
    // Cancels the current round: all pending arrive() and wait() promises reject
    // with `reason` (or standard `DOMException` with `name === 'AbortError'` if not provided) 
    // and the barrier resets for the next round.   
    abort(reason?: unknown): void
}
```

#### Example

```typescript
import { Rendezvous } from 'js-concurrent'

const barrier = new Rendezvous(3)

async function worker(id: number) {
    await doPhase1(id)
    await barrier.arrive()   // wait for all 3 workers before continuing
    await doPhase2(id)
}

// Coordinator: observe completion without being a required participant
barrier.wait().then(() => console.log('all workers reached the checkpoint'))

await Promise.all([worker(1), worker(2), worker(3)])
```

## TypeScript Support

This library is written in TypeScript and provides declaration with full type safety similar to native Promise methods.

## Error Types

### ❌ `ConcurrentTaskFailedError`

Thrown as the abort reason when a sibling task fails in `Task.all()`

### ❌ `GotRaceWinnerError`

Thrown as the abort reason when another task wins in `Task.race()` or `Task.any()`.

## Related Libraries

- [js-aborts](https://github.com/cardinalby/js-aborts)
