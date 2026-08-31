import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTheme, type Tokens } from '../../context/ThemeContext';

/**
 * The auth screens' own small kit.
 *
 * It lives here rather than in `src/ui.ts` for two reasons. `src/ui.ts` is a static light-only palette owned
 * by the screens agent, and these three screens are the only part of the app that renders BEFORE `/me` has
 * answered — so they cannot depend on anything the signed-in tree provides. Everything here reads its
 * colours from `ThemeContext` tokens, so the sign-in screen honours the cached dark choice on a cold start.
 *
 * The look is Goal Cascade's, not the reference app's: the `#f6f6f3` paper, the 640px column, Manrope at
 * 800, the Newsreader italic for the one line of voice, the oklch green accent, 12–16px radii.
 */

const CARD_MAX = 420;

export function AuthFrame({ children }: { children: ReactNode }) {
  const T = useTheme();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: T.paper,
        color: T.ink,
        fontFamily: "'Manrope', sans-serif",
        fontSize: 15,
        lineHeight: 1.45,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px calc(32px + var(--safe-bottom, 0px))',
      }}
    >
      <div style={{ width: '100%', maxWidth: CARD_MAX, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

/**
 * The wordmark. "Goal" in Manrope 800, "Cascade" in the Newsreader italic that the rest of the app uses for
 * a goal's `why` and a weekly focus sentence — the one place the product speaks rather than labels.
 */
export function Wordmark() {
  const T = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 21, letterSpacing: '-0.01em' }}>
      <span style={{ fontWeight: 800 }}>Goal</span>
      <span style={{ fontFamily: "'Newsreader', serif", fontStyle: 'italic', fontWeight: 500, color: T.accent }}>Cascade</span>
    </div>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.2 }}>{children}</h1>;
}

export function Lede({ children }: { children: ReactNode }) {
  const T = useTheme();
  return <p style={{ margin: 0, fontSize: 13.5, color: T.mut, lineHeight: 1.55 }}>{children}</p>;
}

/** A quiet confirmation strip ("Password saved — sign in to continue"). `role="status"` so it is announced. */
export function Notice({ children, tone = 'good' }: { children: ReactNode; tone?: 'good' | 'plain' }) {
  const T = useTheme();
  return (
    <div
      role="status"
      style={{
        background: tone === 'good' ? T.accentSoft : T.cardSoft,
        color: tone === 'good' ? T.accent : T.mut,
        border: tone === 'good' ? 'none' : `1px solid ${T.line}`,
        borderRadius: 12,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/** A refusal. `role="alert"` so a screen reader hears it without hunting for it. */
export function ErrorText({ children }: { children: ReactNode }) {
  const T = useTheme();
  return (
    <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: T.redText, lineHeight: 1.5, padding: '0 2px' }}>
      {children}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  hint?: string;
  error?: string | null | undefined;
  maxLength?: number;
  placeholder?: string;
}

/**
 * The hint and the error sit OUTSIDE the `<label>` and are tied to the input with `aria-describedby`. If
 * they were inside it, the field's accessible name would become "PasswordAt least 8 characters" — which is
 * what a screen reader announces, and what `getByLabelText('Password')` then fails to find. The name is the
 * label; everything else is a description.
 */
export function TextField({ label, value, onChange, type = 'text', autoComplete, hint, error, maxLength, placeholder }: TextFieldProps) {
  const T = useTheme();
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 12, fontWeight: 700, color: T.mut }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={note ? noteId : undefined}
        aria-invalid={error ? true : undefined}
        {...(type === 'email' ? { inputMode: 'email' as const, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } : {})}
        maxLength={maxLength}
        placeholder={placeholder}
        style={{
          width: '100%',
          minHeight: 48,
          border: `1px solid ${error ? T.red : T.border}`,
          borderRadius: 12,
          padding: '0 14px',
          fontSize: 15,
          background: T.card,
          color: T.ink,
          fontFamily: 'inherit',
        }}
      />
      {note && (
        <span id={noteId} style={{ fontSize: 12, fontWeight: error ? 700 : 400, color: error ? T.redText : T.faint }}>
          {note}
        </span>
      )}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = 'submit',
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'submit' | 'button';
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const T = useTheme();
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        minHeight: 50,
        border: 'none',
        borderRadius: 14,
        fontSize: 15,
        fontWeight: 800,
        fontFamily: 'inherit',
        background: disabled ? T.disabled : T.ink,
        color: disabled ? T.paper : T.paper,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function TextButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  const T = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 44,
        alignSelf: 'flex-start',
        border: 'none',
        background: 'none',
        padding: '4px 0',
        fontSize: 13.5,
        fontWeight: 700,
        color: disabled ? T.disabled : T.accentLink,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

/** Sign in / Create account. Two options, so a segmented control rather than a link that hides one of them. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels: (v: T) => string;
}) {
  const T_ = useTheme();
  return (
    <div style={{ display: 'flex', gap: 4, background: segBg(T_), borderRadius: 14, padding: 4 }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{
              flex: 1,
              minHeight: 40,
              border: 'none',
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 800,
              fontFamily: 'inherit',
              cursor: 'pointer',
              background: on ? T_.card : 'transparent',
              color: on ? T_.ink : T_.mut,
              boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {labels(o)}
          </button>
        );
      })}
    </div>
  );
}

const segBg = (T: Tokens) => (T.night ? T.cardSoft : T.lineSoft);

/** The pre-`/me` splash, and the "couldn't reach the server" retry screen the gate falls back to. */
export function Splash({ children }: { children?: ReactNode }) {
  const T = useTheme();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: T.paper,
        color: T.ink,
        fontFamily: "'Manrope', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <Wordmark />
      {children}
    </div>
  );
}
