# js-concurrent

[![test](https://github.com/cardinalby/js-concurrent/actions/workflows/test.yml/badge.svg)](https://github.com/cardinalby/js-concurrent/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/js-concurrent.svg)](https://www.npmjs.com/package/js-concurrent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**Abort-aware concurrency primitives for JavaScript/TypeScript**, inspired by Go's 
[errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup) pattern.

This library provides enhanced versions of `Promise.all()`, `Promise.race()`, and `Promise.any()` that support:

- 🚫 **Abort signals** - Cancel operations gracefully with `AbortSignal`
- 🎯 **Concurrency limiting** - Control how many tasks run simultaneously
- ⚡ **Smart cancellation** - Auto-abort remaining tasks when one fails or succeeds
- 🔒 **Semaphore & Limiter** - Lower-level primitives for custom concurrency control

Unlike native Promise methods that work with promises, this library uses **tasks** 
(**functions that create promises**), enabling proper cancellation support and lazy execution.

## Installation

```bash
npm install js-concurrent
```

## Comparison with Native Promises

| Feature | Native Promises | js-concurrent |
|---------|----------------|----------------|
| Parallel execution | ✅ `Promise.all()` | ✅ `allWithAbort()` |
| Race condition | ✅ `Promise.race()` | ✅ `raceWithAbort()` |
| First success | ✅ `Promise.any()` | ✅ `anyWithAbort()` |
| Abort support | ❌ | ✅ |
| Concurrency limiting | ❌ | ✅ |
| Auto-cancel on error | ❌ | ✅ |
| Lazy execution | ❌ | ✅ |
| Task coordination | ❌ | ✅ |

### Why Tasks Instead of Promises?

Native `Promise.all()` accepts **promises** that have already started executing:

```typescript
// ❌ Promises start immediately, can't be cancelled
Promise.all([
  fetch('/api/1'), // Already running
  fetch('/api/2'), // Already running
  fetch('/api/3')  // Already running
]);
```

This library uses **task functions** that return promises enabling better control:
- 🚀 Tasks start only when needed
- 🛑 Tasks can be cancelled via `AbortSignal` (and will never start or aborted)
- 🎯 Tasks can be limited in concurrency
- ⚡ Tasks can be auto-aborted when one fails or succeeds

```typescript
type Task<T> = (abortSignal?: AbortSignal) => Promise<T>
````

```typescript
// ✅ Tasks start when needed and can be cancelled
allWithAbort([
  (signal) => fetch('/api/1', { signal }), // Starts on demand
  (signal) => fetch('/api/2', { signal }), // Can be cancelled
  (signal) => fetch('/api/3', { signal })  // Can be cancelled
]);
```

## Quick Start

### Basic parallel execution with automatic cancellation

```typescript
import {allWithAbort} from 'js-concurrent';

// Tasks receive an AbortSignal and can react to cancellation
const tasks = [
    async (signal) => {
        const response = await fetch('https://api.example.com/data1', {signal});
        return response.json();
    },
    async (signal) => {
        const response = await fetch('https://api.example.com/data2', {signal});
        return response.json();
    },
    async (signal) => {
        // This task might fail
        throw new Error('Oops!');
    }
];

try {
    const results = await allWithAbort(tasks);
    console.log(results);
} catch (error) {
    // If any task fails, all other tasks are automatically aborted
    console.error('Failed:', error);
}
```

### Limit concurrent operations

If you don't want the server or API to be overwhelmed or ban you:
```typescript
import {allWithAbort} from 'js-concurrent';

const urls = [/* 100 URLs */];

// Process URLs with max 5 concurrent requests
const results = await allWithAbort(
    urls.map(url => async (signal) => {
        const response = await fetch(url, {signal});
        return response.json();
    }),
    {concurrencyLimit: 5}
);
```

### Manual cancellation with AbortController/AbortSignal

```typescript
import { allWithAbort } from 'js-concurrent';

try {
  await allWithAbort(
      tasks,
      {
          // Cancel all tasks after 5 seconds
          signal: AbortSignal.timeout(5000),
          // Allow max 3 tasks to run concurrently
          concurrencyLimit: 3,
      },
  );
} catch (error) {
    console.error('Aborted:', error);
}
```

## API Reference

### ◆ Common Types

Instead of Promises, the lib focuses on **tasks** - functions that return Promises and accept an optional `AbortSignal`.

```typescript
type Task<T> = (abortSignal?: AbortSignal) => Promise<T>
````

You can pass them to functions like `allWithAbort()`, `raceWithAbort()`, and `anyWithAbort()` to
run them with concurrency control (**limiting** the number of running tasks) and **abort** support.

Each of concurrency methods (`allWithAbort()`, `raceWithAbort()`, `anyWithAbort()`) accepts an optional `RunOptions` object:
```typescript
type ErrGroupTask<T> = (signal?: AbortSignal) => Promise<T>;

interface RunOptions {
  /**
   * Maximum number of tasks to run concurrently.
   * If not specified or <= 0, all tasks run concurrently.
   */
  concurrencyLimit?: number;
  
  /**
   * AbortSignal to cancel the entire group of tasks
   */
  signal?: AbortSignal;
}
```

---

### 🔻 `allWithAbort`

Similar to `Promise.all()`, but with abort support and concurrency control. Runs all tasks and returns all results in order. If any task fails, all other tasks are automatically aborted.

```typescript
function allWithAbort<T>(
  tasks: Iterable<ErrGroupTask<T>>,
  options?: RunOptions
): Promise<T[]>;
```

#### Parameters

- **tasks**: Array of task functions
- **options**: Optional configuration
  - `concurrencyLimit`: Max concurrent tasks (default: unlimited)
  - `signal`: parent AbortSignal to cancel all tasks

#### Returns

Promise that resolves with an array of results in the same order as input tasks.

#### Behavior

- ✅ All tasks must succeed for the promise to resolve
- ❌ If any task fails, remaining tasks are aborted and the promise rejects with the first error
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started, 
  the resulting Promise is rejected with the abort reason
- 📊 Results maintain input order regardless of completion order

#### Example

```typescript
import { allWithAbort } from 'js-concurrent';

const results = await allWithAbort([
    async (signal) => {
        // Task 1
        return fetch('https://api.example.com/data1', {signal});
    },
    async (signal) => {
        return fetch('https://api.example.com/data2', {signal});
    }
], {concurrencyLimit: 2});

// ['result1', 'result2'] or throws if any task fails (with others aborted)
console.log(results); 
```

---

### 🔻 `raceWithAbort`

Similar to `Promise.race()`, but with abort support. 
Returns the first task to complete (resolve or reject) and aborts all others.

```typescript
function raceWithAbort<T>(
  tasks: Iterable<ErrGroupTask<T>>,
  options?: RunOptions
): Promise<T>;
```

#### Parameters

- **tasks**: Array of task functions
- **options**: Optional configuration
    - `concurrencyLimit`: Max concurrent tasks (default: unlimited)
    - `signal`: parent AbortSignal to cancel all tasks

#### Returns

Promise that settles (resolves or rejects) with the result of the first task to complete.

#### Behavior

- 🏁 Returns the first task that completes (whether it succeeds or fails)
- 🛑 When a task completes, all other tasks are aborted with `GotRaceWinnerError`
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started, 
  the resulting Promise is fulfilled as if all tasks failed (compatible with `Promise.race()`)
- ⚙️ Respects `concurrencyLimit` - tasks wait their turn to start

#### Example

```typescript
import { raceWithAbort } from 'js-concurrent';

// Race between multiple API endpoints
const result = await raceWithAbort([
  async (signal) => fetch('https://api1.example.com/data', { signal }),
  async (signal) => fetch('https://api2.example.com/data', { signal }),
  async (signal) => fetch('https://api3.example.com/data', { signal })
]);

// All other fetches are aborted once the first completes
console.log('First response:', result);
```

---

### 🔻 `anyWithAbort`

Similar to `Promise.any()`, but with abort support. Returns the first task to **successfully resolve** and aborts all others.

```typescript
function anyWithAbort<T>(
  tasks: Iterable<ErrGroupTask<T>>,
  options?: RunOptions
): Promise<T>;
```

#### Parameters

- **tasks**: Array of task functions
- **options**: Optional configuration
    - `concurrencyLimit`: Max concurrent tasks (default: unlimited)
    - `signal`: parent AbortSignal to cancel all tasks

#### Returns

Promise that resolves with the result of the first successfully completed task.

#### Behavior

- ✅ Returns the first task that **succeeds**
- ❌ Task rejections are collected; if all tasks fail, returns `AggregateError`
- 🛑 When a task succeeds, all other tasks are aborted with `GotRaceWinnerError`
- 🛑 If `options.signal` is aborted, all tasks are aborted and new tasks are not started, 
  the resulting Promise is rejected with the abort reason

#### Example

```typescript
import { anyWithAbort } from 'js-concurrent';

// Try multiple fallback sources
try {
  const data = await anyWithAbort([
    async (signal) => {
      // Try primary source (might fail)
      return await fetchPrimarySource(signal);
    },
    async (signal) => {
      // Try backup source
      return await fetchBackupSource(signal);
    },
    async (signal) => {
      // Try cache as last resort
      return await fetchFromCache(signal);
    }
  ]);
  
  console.log('Got data:', data);
} catch (error) {
  // All sources failed
  console.error('All sources failed:', error);
}
```

---

### 🔻 `newLimiter`

Creates a reusable concurrency limiter that restricts how many operations can run simultaneously.

```typescript
type ConcurrencyLimiter = <T>(
  fn: () => Promise<T>,
  signal?: AbortSignal
) => Promise<T>;

function newLimiter(maxConcurrency: number): ConcurrencyLimiter;
```

#### Parameters

- **maxConcurrency**: Maximum number of concurrent executions

#### Returns

A limiter function that accepts an async function and an optional `AbortSignal`.

#### Example

```typescript
import { newLimiter } from 'js-concurrent';

// Create a limiter that allows max 3 concurrent operations
const limiter = newLimiter(3);

const urls = [/* many URLs */];

await Promise.all(
  urls.map(url => 
    limiter(async () => {
      const response = await fetch(url);
      return response.json();
    })
  )
);
```

---

### 🔻 Semaphore

A counting semaphore for fine-grained concurrency control.

```typescript
class Semaphore {
  constructor(limit: number);
  
  /**
   * Acquire a slot, waiting if necessary.
   * Must call release() after done.
   */
  acquire(signal?: AbortSignal): Promise<void>;
  
  /**
   * Try to acquire without waiting.
   * Returns true if acquired, false otherwise.
   */
  tryAcquire(): boolean;
  
  /**
   * Release a previously acquired slot.
   */
  release(): void;
  
  /**
   * Current number of acquired slots
   */
  readonly count: number;
}
```

## TypeScript Support

This library is written in TypeScript and provides declaration with full type safety similar to native Promise methods.

## Error Types

### ❌ `ConcurrentTaskFailedError`

Thrown as the abort reason when a sibling task fails in `allWithAbort()`

### ❌ `GotRaceWinnerError`

Thrown as the abort reason when another task wins in `raceWithAbort()` or `anyWithAbort()`.

## Related Libraries

- [js-aborts](https://github.com/cardinalby/js-aborts)