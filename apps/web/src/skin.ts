import { useTheme } from './context/ThemeContext';
import { styles, type Styles } from './ui';

/**
 * The one line every screen starts with: `const S = useSkin();`.
 *
 * `S.T` is the raw token set and everything else is a ready-made style. The mockup imported `colors` and
 * a dozen frozen style constants from `src/ui.ts` — a light-only palette — which is why its dark mode had
 * to be a document-wide CSS filter (D-25). Resolving the styles from the live tokens instead is the whole
 * of the fix: `styles()` memoises per token set, so this costs one WeakMap lookup per render.
 */
export function useSkin(): Styles {
  return styles(useTheme());
}
