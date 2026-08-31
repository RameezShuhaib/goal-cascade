/**
 * Copy to clipboard, and the answer to "what if it doesn't work?".
 *
 * `navigator.clipboard.writeText` is the good path and it fails more often than it looks: it needs a secure
 * context (a phone opening the PWA over plain http on the LAN has none), it needs the document to be
 * focused, and in Safari it needs the call to be inside the gesture that started it. Firefox can refuse it
 * outright by policy. A copy button that silently does nothing on those devices is worse than no button,
 * because the person walks away believing they hold a token they never copied — and this one is shown once.
 *
 * So there are three rungs, and the last one always works:
 *
 *  1. the async Clipboard API;
 *  2. `document.execCommand('copy')` over the field the value is already in — deprecated, still shipping
 *     everywhere, and the only path some of the above allow;
 *  3. leave the text **selected and focused** and report `'unavailable'`, so the caller can say which two
 *     keys to press. Nothing is lost; the copy just becomes manual.
 *
 * Rung 2 selects the field whether or not it then succeeds, which is what makes rung 3 free.
 */

export type CopyResult = 'copied' | 'unavailable';

/** Legacy `execCommand`, which TypeScript's lib marks deprecated and jsdom does not implement at all. */
type LegacyCopy = Document & { execCommand?: (commandId: string) => boolean };

export async function copyFrom(text: string, field: HTMLInputElement | null): Promise<CopyResult> {
  try {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* denied, insecure origin, or the document was not focused — fall through */
  }

  try {
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(0, field.value.length);
      const doc = document as LegacyCopy;
      if (typeof doc.execCommand === 'function' && doc.execCommand('copy')) return 'copied';
    }
  } catch {
    /* execCommand throws in some sandboxes rather than returning false */
  }

  return 'unavailable';
}
