export * from './errors';
/**
 * ⚠ **R-lens-30** — `calendar/` is exported BEFORE `common`, and it is the package's first substantial
 * body of behaviour: `packages/shared` is no longer "schemas and constants". About 470 lines of pure
 * date arithmetic now ship to both the Worker and the browser bundle, which is the honest cost of the
 * two sides being unable to disagree about what `2026-09` means.
 *
 * `weeks → nothing`, `common → weeks`, `periods → common`, `period-view → periods`: a DAG.
 */
export * from './calendar/weeks';
export * from './common';
export * from './calendar/periods';
export * from './calendar/period-view';
export * from './commands';
export * from './read-models';
export * from './endpoints';
