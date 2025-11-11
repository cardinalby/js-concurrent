# js-aborts

[AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) constructors inspired 
by Go's [context](https://pkg.go.dev/context) package:

✅ Creating [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)s that 
inherit abortion from a parent [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) 
and can be aborted manually or after a timeout.

✅ Created AbortControllers are `Disposable` and can be used with 
[using](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management) statement.

✅ Supports long timeouts (no [wraps around](https://github.com/nodejs/node-v0.x-archive/issues/3605)).

✅ Zero dependencies

## Install

```shell
npm install js-aborts
```

## API

```typescript
import { aborts } from 'js-aborts';
```

### 🔻`aborts.create`

```typescript
function create(parentSignal?: AbortSignal): AbortController;
```

Creates an `AbortController` that:
- is already aborted if the `parentSignal` is aborted,
- will be aborted when the `parentSignal` is aborted
- is a regular `AbortController` if the `parentSignal` is not provided.
- is Disposable and can be used with `using` statement.

Aborting the returned controller does not affect the `parentSignal`.

### 🔻 `aborts.timeout`

```typescript
function timeout(timeoutMs: number, parentSignal?: AbortSignal): AbortController;
```

Creates an `AbortController` that:
- is already aborted if the `parentSignal` is aborted,
- will be aborted when the `parentSignal` is aborted or after `timeoutMs` milliseconds,
- is a regular `AbortController` if the `parentSignal` is not provided.
- is Disposable and can be used with `using` statement.

Aborting the returned controller does not affect the `parentSignal`.

## Usage notes

### Example

```typescript
import { aborts } from 'js-aborts';

async function doSome(arg: string, signal?: AbortSignal) {
    // ...
}

async function doSomeComplex(signal?: AbortSignal) {
    // Create a controller that will be aborted after 5 seconds or when the parent 
    // signal is aborted. Thanks to `using` statement, the created controller will 
    // be disposed (clearing the internal timeout) automatically at the end of the scope.
    using ac = aborts.timeout(5000, signal)
    
    await doSome('first call', ac.signal)
    await doSome('second call', ac.signal)
}

```

### Always dispose the created controllers to avoid resource leaks

Unlike [`AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static), 
the lib's functions return `AbortController` rather than `AbortSignal`. 

This is done to allow manual abortion of not needed controllers to avoid leaks of internal timers/listeners.

You should always dispose the created controllers when they are not needed anymore:

```typescript
// In typescript < 5.2:
function myFunc(signal?: AbortSignal) {
    const ac = aborts.timeout(5000, signal)
    try {
        // use ac.signal
    } finally {
        ac.abort()
    }
}
```

```typescript
// In typescript >= 5.2:
function myFunc(signal?: AbortSignal) {
    // Unlike standard AbortControllers, the created controller is Disposable
    using ac = aborts.timeout(5000, signal)
    // use ac.signal
}
```