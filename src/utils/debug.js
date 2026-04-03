/**
 * Dev-mode runtime guardrails — budget warnings and invariant checks.
 *
 * All checks are behind the `?debug` query parameter and have zero
 * production cost. The {@link DEBUG} flag is evaluated once at module
 * load from the current URL.
 *
 * ## Usage
 *
 * ### Runtime invariants (`?debug`)
 *
 * ```js
 * import { DEBUG, registerInvariant } from "../utils/debug.js";
 *
 * registerInvariant("MySystem", () => {
 *   if (someConditionBroken) return "description of what went wrong";
 *   return true;
 * });
 * ```
 *
 * `registerInvariant` is a no-op when `DEBUG` is false, so the check
 * function is never stored and never called in production.
 *
 * ### Hot-path checks (`import.meta.env.DEV`)
 *
 * For checks on very hot paths (called thousands of times per frame),
 * use `import.meta.env.DEV` instead of `DEBUG`. Vite statically
 * replaces `import.meta.env.DEV` with `false` in production builds
 * and tree-shakes the guarded code entirely — no runtime branch at all.
 *
 * ```js
 * if (import.meta.env.DEV) {
 *   // This code is eliminated from production builds entirely.
 *   console.assert(value >= 0, "value must be non-negative");
 * }
 * ```
 */

/**
 * `true` when the page URL contains `?debug` (or `&debug`).
 * Evaluated once at module load — never changes at runtime.
 * @type {boolean}
 */
export const DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug");

/** @type {Array<{ systemName: string, checkFn: () => true | string }>} */
const invariantChecks = [];

/**
 * Register an invariant check that runs once per frame when `?debug`
 * is active.
 *
 * When `DEBUG` is false this is a no-op — the check function is never
 * stored and never called.
 *
 * @param {string} systemName  Human-readable system name for warnings.
 * @param {() => true | string} checkFn  Return `true` if the invariant
 *   holds, or a string describing the violation.
 */
export function registerInvariant(systemName, checkFn) {
  if (DEBUG) invariantChecks.push({ systemName, checkFn });
}

/**
 * Execute all registered invariant checks.  Should be called once per
 * frame inside `_animate()`, guarded by `if (DEBUG)`.
 */
export function runInvariants() {
  for (const { systemName, checkFn } of invariantChecks) {
    const result = checkFn();
    if (result !== true) {
      console.warn(`[debug] Invariant violation in ${systemName}: ${result}`);
    }
  }
}
