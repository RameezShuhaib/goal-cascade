import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../src/context/ThemeContext';
import ResetPasswordScreen from '../../src/components/auth/ResetPasswordScreen';

/**
 * `<button>` defaults to `type="submit"`.
 *
 * That default is the single nastiest footgun in an app made of sheets and forms: a control whose whole job
 * is "put me back where I was" — `Keep editing`, `Cancel`, a `✕` — silently becomes "submit the form" the
 * moment somebody wraps its sheet in a `<form>`, and Enter or a click then runs the submit handler instead
 * of its own `onClick`. Save, close, discard: whatever the form does happens, and the typed work is gone.
 * Nothing about the button changes, so nothing about the button looks wrong; the bug is conditional on an
 * ancestor several files away, which is exactly why it is not found by reading the button.
 *
 * The walkthrough's unreproduced one-off (docs/work/09-e2e-browser, re-verification item 2) is what sent us
 * looking. It was not this — the task detail sheet is not inside a form, and the audit below found every
 * `<button>` already explicit — but "not today" is not a guarantee, and the guarantee is cheap.
 *
 * Two tests, because neither catches what the other does:
 *
 *  - the source scan sees `type={maybeUndefined}` as present, but reads every file including screens no
 *    test renders;
 *  - the DOM scan renders the two real `<form>`s and asks the browser, so a prop that resolves to
 *    `undefined` (React then emits no attribute at all, and the default is back) fails.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The text of every `<button …>` opening tag in a file. Attribute values run across lines and hold `{}`,
 * quotes and nested JSX, so the end of the tag is found by scanning rather than by a regex for `>`.
 */
function buttonTags(src: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  const opens = /<button[\s>]/g;
  let m: RegExpExecArray | null;
  while ((m = opens.exec(src))) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + '<button'.length;
    for (; i < src.length; i += 1) {
      const c = src[i]!;
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    found.push({ tag: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return found;
}

describe('every <button> says what type it is', () => {
  it('no <button> in components/ or screens/ relies on the submit default', () => {
    const files = [join(WEB, 'src', 'components'), join(WEB, 'src', 'screens')].flatMap(sources);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    let counted = 0;
    for (const file of files) {
      for (const { tag, line } of buttonTags(readFileSync(file, 'utf8'))) {
        counted += 1;
        if (!/\stype\s*=/.test(tag)) offenders.push(`${relative(WEB, file)}:${line}`);
      }
    }

    // A sanity check on the scanner itself: if the parse silently stopped finding buttons, an empty
    // `offenders` would be a false pass rather than a result.
    expect(counted).toBeGreaterThan(80);
    expect(offenders, 'these buttons default to type="submit" — say type="button" (or type="submit") explicitly').toEqual([]);
  });

  it('and no button that is actually inside a <form> reaches the DOM without a type attribute', async () => {
    // The app's only two `<form>` elements are the auth screens. `PrimaryButton` forwards a `type` prop, so
    // this is where a `type={undefined}` would land — and React drops an undefined attribute entirely.
    render(
      <ThemeProvider theme="light">
        <ResetPasswordScreen token="tok" linkError={null} onDone={() => {}} />
      </ThemeProvider>,
    );
    const form = await screen.findByRole('form', { name: 'Choose a new password' });

    const buttons = Array.from(form.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(1);
    expect(
      buttons.filter((b) => !b.hasAttribute('type')).map((b) => b.textContent),
      'a button inside a form with no type attribute IS a submit button',
    ).toEqual([]);
    // The submit is the one that means it, and the way back out is not.
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Save password');
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toHaveAttribute('type', 'button');
  });
});
