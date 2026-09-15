// Run with: node frontend/checks/autosave.check.ts
// Exercises only the injected-dependency core (startAutosave), never store.ts/api.ts/wailsjs.
import assert from "node:assert/strict";
import { startAutosave } from "../src/autosave.ts";

function fakeClock() {
  let fn: (() => void) | null = null;
  return {
    clock: {
      setInterval: (f: () => void) => {
        fn = f;
        return 1;
      },
      clearInterval: () => {
        fn = null;
      },
    },
    tick: () => fn?.(),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Lets pending .then/.catch/.finally microtasks from a tick settle before asserting.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// --- dirty files are saved after a tick, when enabled ---
{
  const { clock, tick } = fakeClock();
  const saved: string[] = [];
  const stop = startAutosave({
    listDirty: () => [{ file: "a.json", save: async () => void saved.push("a.json") }],
    getSettings: () => ({ enabled: true, seconds: 5 }),
    toast: () => assert.fail("should not toast on success"),
    clock,
  });
  tick();
  await flush();
  assert.deepEqual(saved, ["a.json"]);
  stop();
}

// --- nothing is saved when disabled ---
{
  const { clock, tick } = fakeClock();
  let calls = 0;
  const stop = startAutosave({
    listDirty: () => [{ file: "a.json", save: async () => void calls++ }],
    getSettings: () => ({ enabled: false, seconds: 5 }),
    toast: () => assert.fail("should not toast"),
    clock,
  });
  tick();
  await flush();
  assert.equal(calls, 0);
  stop();
}

// --- a failure toasts once, not again until the file saves successfully ---
{
  const { clock, tick } = fakeClock();
  let shouldFail = true;
  let toasts = 0;
  const stop = startAutosave({
    listDirty: () => [
      { file: "b.json", save: () => (shouldFail ? Promise.reject(new Error("disk full")) : Promise.resolve()) },
    ],
    getSettings: () => ({ enabled: true, seconds: 5 }),
    toast: () => void toasts++,
    clock,
  });
  tick();
  await flush();
  assert.equal(toasts, 1, "first failure toasts");
  tick(); // still failing: must not toast again
  await flush();
  assert.equal(toasts, 1, "repeated failure does not re-toast");
  shouldFail = false;
  tick(); // succeeds: clears the failed flag
  await flush();
  assert.equal(toasts, 1);
  shouldFail = true;
  tick(); // fails again after an intervening success: toasts again
  await flush();
  assert.equal(toasts, 2, "failure after a success toasts again");
  stop();
}

// --- no concurrent save of the same file ---
{
  const { clock, tick } = fakeClock();
  let saveCalls = 0;
  const first = deferred<void>();
  const stop = startAutosave({
    listDirty: () => [
      {
        file: "c.json",
        save: () => {
          saveCalls++;
          return saveCalls === 1 ? first.promise : Promise.resolve();
        },
      },
    ],
    getSettings: () => ({ enabled: true, seconds: 5 }),
    toast: () => assert.fail("should not toast"),
    clock,
  });
  tick(); // starts the slow first save
  tick(); // must not start a second save while the first is in flight
  await flush();
  assert.equal(saveCalls, 1, "concurrent tick does not start a second save");
  first.resolve();
  await first.promise;
  await flush();
  tick(); // the first save resolved, a new one may start
  await flush();
  assert.equal(saveCalls, 2);
  stop();
}

console.log("autosave ok");
