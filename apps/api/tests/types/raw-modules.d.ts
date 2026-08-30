/** Vite's `?raw` imports, used by the config-drift tests to read real files inside workerd. */
declare module '*?raw' {
  const content: string;
  export default content;
}

/**
 * Vite's `import.meta.glob`, used by `tests/security/no-real-email.test.ts` to scan the whole `src/`
 * tree for a mail adapter at build time. Declared here rather than pulling in `vite/client`, which
 * carries DOM types this Worker project deliberately does not have.
 */
interface ImportMeta {
  glob: (pattern: string, options?: { query?: string; import?: string; eager?: boolean }) => Record<string, unknown>;
}
