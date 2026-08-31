# UX — the static API token for agent access

How the owner gets a token, copies it into an external AI agent, and takes it away again.

This is a design document. It contains no implementation, but the copy is final and the component structure is
meant to be built from directly. It assumes the existing `Sheet`, `Empty`, `FieldError`, `LoadError`, `UIToast`
and the `styles()` token set, and it introduces no new visual idiom, no new colour token, and no new modal
pattern.

Scope note: the token format, the MCP protocol, the server URL and the storage schema belong to other agents.
Where this design needs one of those, it names the field it wants and stops. See §7.

---

## 1. Recommendation

**Show it once, store only a hash, keep exactly one token, and make replacing it a one-tap action.**

In the ordinary case show-once is expensive because a lost credential means hunting down every consumer that
holds it; here there is one person, one account, and realistically one or two agent configs, so "lost it"
costs a single button press and a single paste, which is cheap enough that the security property is worth
buying. The property being bought is narrow but real: this app's D1 database *will* leave Cloudflare — a
`wrangler d1 export`, a local restore, a backup sitting in a Downloads folder — and a hash means none of those
copies is a live credential, whereas a retrievable token means every stale dump is a permanent, silent key to
the account long after the leak that produced it was noticed and patched. Retrievable storage would add almost
nothing to the *immediate* blast radius of a D1 leak, because a D1 leak already exposes the entire goal tree
the token would grant access to — the difference is not confidentiality, it is **persistence**, and persistence
is exactly what an owner who backs up their own database cannot audit. What the owner trades away is the
literal thing they asked for: the header can never show them the token again, so "copy it whenever I like"
becomes "copy the whole config block at the moment of creation, or replace the token and copy the new one".
That trade is only wrong if the owner runs three or more agents at once and needs to add a fourth without
interrupting the others — see §8, which is the one call I am leaving to them.

Two related decisions fall out of this and are argued where they land:

- **Exactly one token, not a list** (§3, S6). A named token list with created/last-used columns is an audit
  surface, and this product has deliberately removed every audit surface it ever had (R-nav-14).
- **Re-authentication guards creation, not reveal** (§3, S1/S7). The middle path of "reveal behind a password"
  requires storing the plaintext, so it protects against a borrowed laptop and nothing else. Moved to the
  *creation* step, the same password prompt buys the same protection and costs the same, while the storage
  stays hashed. `me.routes.ts` already makes this argument for `change-password` — *"a live session on a
  borrowed laptop must not be enough to re-key the account"* — and minting a permanent, session-independent
  credential is at least as serious as re-keying. Revoking needs no password: revocation is never the
  dangerous direction.

Also rejected: a masked field with a copy button that copies without displaying. It reads as show-once but
requires retrievable storage, so it pays the full storage cost for shoulder-surfing protection only. It is the
worst of both.

---

## 2. Placement

**Inside the existing Account sheet, as its own section — not as a new icon in the top-right cluster.**

The owner's words were *"in the header (probably beside signout)"*. The Account sheet **is** beside sign-out;
it is what the account icon opens. So this honours the request literally while leaving R-nav-11 alone.

`R-nav-11` says the cluster is a theme toggle plus at most one primary action. `TopActions.tsx` already records
one deliberate exception — the account icon — with the reasoning written into the file: *"an app you cannot
sign out of is not shippable… both live behind one 40px icon that matches the toggle, so the cluster still
reads as two quiet circles and a pill."* That argument does not extend to a third icon, and the reason is not
only rhythm:

1. **A third circle breaks the read.** Two circles and a pill is a shape. Three circles and a pill is a
   toolbar, on every page, forever, to serve an action taken perhaps twice a year.
2. **Ambient chrome is the wrong weight for this control.** The one button in this app that can hand away full
   account access should not sit at the same visual weight as the light/dark toggle, on the Learnings screen, at
   all times. One tap of separation is the correct amount of ceremony: enough that it is never hit by accident,
   little enough that it is never hunted for.
3. **It is already the right room.** The Account sheet holds identity: the email address, email verification,
   sign-out. A token is identity — it is the account, delegated. It belongs with the things it is equivalent to.

Rejected alternatives:

- **A Settings tab.** R-nav-1 fixes the tab bar at five and the `+` is one of them. Not available, and not
  worth spending if it were.
- **A row on the Goals screen or a page of its own.** A page needs a route and a way in, and the only sensible
  way in is the header — which puts us back at the cluster, having also added a screen.
- **The `+` drawer.** That drawer is for capturing backlog items. Nothing else goes in it.

The cost is one extra tap. That is the whole cost, and it is paid on a rare action.

---

## 3. The flow, state by state

Eleven states: two in the Account sheet, nine in the Agent access sheet. The Agent access sheet is one `Sheet`
with `label="Agent access"`, and its confirm steps are internal states of that same sheet — the two-step
pattern `DeleteGoalSheet` already uses (`counts === null ? … : …`), so no dialog ever stacks on another.

Mockups use the app's real language: `S.eyebrow` for the small-caps section labels, `S.serif` italic for the
empty-state headline, `S.T.mut` for explanation lines, `S.dashed` for the empty frame, `S.discardBar` for the
neutral notice strip.

### A1 — Account sheet, no token yet

```
┌──────────────────────────────────────────────────────────┐
│  Account                                              ✕  │
│  you@example.com                                         │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Connect an AI agent                            ›  │  │
│  │  No token yet                                      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    Sign out                        │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

The row is a full-width `S.btn(false)` variant with two stacked lines: the label in `S.body` at 13.5/700, the
sub-line in `S.T.mut` at 12.5/600, and a `›` at the right. It sits **above** sign-out, separated by the
existing 8px gap — the destructive-ish action stays last, as it already is.

`Verify this email address`, when present, keeps its current position directly under the email.

### A2 — Account sheet, token active

```
│  ┌────────────────────────────────────────────────────┐  │
│  │  Agent access                                   ›  │  │
│  │  One token, active since 12 Sep · ends in 4f2a     │  │
│  └────────────────────────────────────────────────────┘  │
```

Same row, different sub-line. The last four characters are the only part of the token that survives creation,
and they exist for exactly one purpose: so the owner can look at an agent's config file and tell whether it
holds the token that is currently live.

### S1 — Agent access, nothing connected

```
┌──────────────────────────────────────────────────────────┐
│  Agent access                                         ✕  │
│                                                          │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│                                                          │
│  │            Nothing connected yet.                  │  │
│       A token lets an outside AI agent read and          │
│  │    change everything in this account — the same    │  │
│         as signing in as you. Make one when you're        │
│  │         ready to connect something.                │  │
│                                                          │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                                          │
│  YOUR PASSWORD                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ••••••••••••                                       │  │
│  └────────────────────────────────────────────────────┘  │
│  Confirming it's you — the same check as changing your   │
│  password.                                               │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                 Create a token                     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Components: `<Empty title body />` with no `action` (the action is below the password field, because it is
gated by it), an `S.fieldLabel` + `S.input type="password"`, a `S.T.mut` helper line, `<FieldError>`, and
`S.saveBtn(disabled)` — disabled while the password is empty or the request is in flight.

Note what this state does **not** contain: no red, no warning glyph, no all-caps DANGER heading. The one
genuinely alarming fact — *this is the same as signing in as you* — is a plain sentence, stated once, at the
only moment it is actionable, in the same serif-and-muted frame as *"Nothing planted yet."* The password field
carries the weight instead. A field you have to fill in says "this matters" more quietly, and more honestly,
than a coloured banner does.

### S2 — Creating

The button becomes `Creating…` and disables. Nothing else moves; the sheet does not change height. There is no
spinner anywhere in this app and there is not one here.

### S3 — Created, shown once

```
┌──────────────────────────────────────────────────────────┐
│  Agent access                                         ✕  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ This is the only time the token is shown. Copy it  │  │
│  │ now — if you lose it, make a new one.              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  YOUR AGENT'S CONFIG                                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                              ⇕   │  │
│  │   "mcpServers": {                                  │  │
│  │     "goal-cascade": {                              │  │
│  │       "url": "https://…/mcp",                      │  │
│  │       "headers": {                                 │  │
│  │         "Authorization": "Bearer gc_…4f2a"         │  │
│  │       }                                            │  │
│  │     }                                              │  │
│  │   }                                                │  │
│  │ }                                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  Copy config                       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐                                │
│  │   Copy token only    │                                │
│  └──────────────────────┘                                │
│                                                          │
│  Paste this into your agent's MCP settings, then restart │
│  the agent.                                              │
└──────────────────────────────────────────────────────────┘
```

**The block is a config, not a token.** A bare token connects nothing — the owner also needs the server URL and
the header shape, and asking them to assemble that from memory at the one moment the token is visible is the
single most likely way this flow fails. `Copy token only` stays, because someone pasting into an existing
config wants just the string.

**Structure of the block.** A read-only `<textarea>` (not a `<div>`), 10 rows, `overflow: auto`, on `S.T.paper`
inside the card with a `1px solid S.T.line` border and `borderRadius: 12` — the `S.textarea` shape with the
ground swapped, so it reads as quoted material rather than an input awaiting text. Font:
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` at 12.5px / `lineHeight: 1.55`. This is the one
typographic addition in the design and it is load-bearing: an opaque credential has to disambiguate `1/l`,
`0/O`, `rn/m`, and Manrope does not. It is a system stack — no font is downloaded, nothing new is self-hosted,
and it appears nowhere else in the app.

**Contents come from the server**, verbatim, as one string. The client never builds the JSON. See §7.

**Closing this sheet loses the token.** Recommended handling: pass `unsaved={!copiedOnce}` to `Sheet`, which
already turns the first Escape or ✕ into a strip instead of a close, and add one optional prop so the strip can
say something true here (copy in §4, `unsavedCopy`). If the builder would rather not touch `Sheet` at all, the
acceptable fallback is to leave `unsaved` unset — the loss is recoverable in two taps, and the notice strip
already says so. It is not worth a bespoke guard.

After the first successful copy, `Copy config` stays where it is and a `Done` button (`S.btn(true)`,
full-width) appears below the helper line.

### S4 — Copied

No toast. A copy is not a state change, and R-nav-13 reserves toasts for confirmations of changes the screen
also records. Instead, the helper line under the buttons is replaced in place, in `S.T.mut` at 13.5px, inside a
`role="status"`:

> Copied. Paste it into your agent's MCP settings, then restart the agent.

This is both the visible confirmation and the announced one, so nothing is said twice. `Copy token only`
produces the same line with `Token copied.` in front of it.

### S5 — Clipboard unavailable

The clipboard API fails on non-secure origins, without a user gesture, and under some iOS/permission
configurations, and it fails *silently* unless handled. On a rejected promise or a missing
`navigator.clipboard`:

- the textarea's contents are programmatically selected and focus moves to it;
- a `<FieldError>`-styled line (`role="alert"`, `S.T.redText`) appears directly under the buttons:

> Couldn't reach the clipboard. The text above is selected — copy it yourself with ⌘C or Ctrl+C.

- the `Done` button appears anyway, because the owner may well have succeeded manually and must not be trapped.

This is the only place `redText` appears in a non-destructive context, and it is correct there: it is the app's
existing inline-error colour doing its existing job.

### S6 — Active token, plaintext gone

```
┌──────────────────────────────────────────────────────────┐
│  Agent access                                         ✕  │
│                                                          │
│  One token, active since 12 Sep. It ends in 4f2a.        │
│                                                          │
│  The token itself isn't kept here — only a fingerprint   │
│  of it — so it can't be shown again. If you've lost it,  │
│  replace it.                                             │
│                                                          │
│  YOUR AGENT'S CONFIG                                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                              ⇕   │  │
│  │   "mcpServers": {                                  │  │
│  │     "goal-cascade": {                              │  │
│  │       "url": "https://…/mcp",                      │  │
│  │       "headers": {                                 │  │
│  │         "Authorization": "Bearer ••••••••4f2a"     │  │
│  │       }                                            │  │
│  │     }                                              │  │
│  │   }                                                │  │
│  │ }                                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────┐                                │
│  │  Copy server URL     │                                │
│  └──────────────────────┘                                │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────┐      │
│  │  Replace this token  │  │      Revoke it       │      │
│  └──────────────────────┘  └──────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

The masked config is deliberate and does real work. Half of what the owner needs to connect an agent — the
server URL and the header shape — is **not** secret, is easy to forget, and is unavailable anywhere else in the
product. Showing the shape with a hole where the token goes lets them fix a broken config without replacing a
working token. `Copy server URL` is `S.menuBtn`; `Replace this token` is `S.menuBtn`; `Revoke it` is
`S.dangerBtn` — all three already exist, and the only red on the screen is the word "Revoke".

The first line is `S.body` at 13.5px; the explanation beneath it is `S.T.mut` at 13.5px.

### S7 — Replace, confirming

Replaces the sheet's body in place (heading unchanged), the way `DeleteGoalSheet` swaps its body once it knows
the counts:

```
┌──────────────────────────────────────────────────────────┐
│  Agent access                                         ✕  │
│                                                          │
│  Replacing the token switches off the one you have now.   │
│  Any agent still using it stops working until you paste   │
│  the new one in. You'll see the new token once.           │
│                                                          │
│  YOUR PASSWORD                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ••••••••••••                                       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                   Replace it                       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Keep the one I have                   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

`Replace it` is `S.btn(true)` — dark, not red. Replacing is not destruction; it is the recovery path, and the
copy already says exactly what breaks. Success goes straight to **S3** with the new token, plus the toast
`Token replaced`.

### S8 — Revoke, confirming

```
┌──────────────────────────────────────────────────────────┐
│  Agent access                                         ✕  │
│                                                          │
│  Revoking switches the token off. Any agent using it     │
│  loses access straight away. Your own sign-in is         │
│  untouched, and you can make a new token whenever you    │
│  like.                                                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                     Revoke                         │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │                     Keep it                        │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

`Revoke` is `S.btn(true, true)` — the filled red the delete-goal sheet uses. `Keep it` is `S.btn(false)`, the
same words the delete-goal sheet uses, because it is the same question.

No password here. Revocation is the safe direction, it is fully reversible in two taps, and requiring a
password to make the account *less* accessible would be ceremony for its own sake.

Success returns to **S1**, plus the toast `Token revoked`. There is no separate "revoked" screen: the empty
state is already the truthful description of where you now are, and inventing a farewell panel would be the
kind of ceremony this product removes.

### S9 — Failures

| Where | Treatment | Component |
|---|---|---|
| Reading the token's status | Inline, replaces the body | `<LoadError what="agent access" onRetry />` |
| Wrong password on create/replace | Inline, under the field | `<FieldError>` |
| Create/replace failed otherwise | Inline, above the button | `<FieldError>` |
| Revoke failed | Inline, above the buttons; the sheet stays on S8 | `<FieldError>` |

Never a toast for any of these: a toast is transient and these are all "the thing you asked for did not
happen", which the screen has to keep saying.

---

## 4. All copy, verbatim

Every string. Curly apostrophes throughout, matching the rest of the app.

### Account sheet

| Element | Copy |
|---|---|
| Section row label, no token | `Connect an AI agent` |
| Section row sub-line, no token | `No token yet` |
| Section row label, token active | `Agent access` |
| Section row sub-line, token active | `One token, active since 12 Sep · ends in 4f2a` |
| Sub-line while loading | `…` |

Date format: `12 Sep` — day, short month, no year, matching `Added 25 Aug` and `Done Fri 28 Aug` elsewhere.

### Agent access sheet — chrome

| Element | Copy |
|---|---|
| Sheet heading (`label`) | `Agent access` |
| Close button `aria-label` | `Close` (Sheet's own) |

### S1 — nothing connected

| Element | Copy |
|---|---|
| Empty headline (serif) | `Nothing connected yet.` |
| Empty body | `A token lets an outside AI agent read and change everything in this account — the same as signing in as you. Make one when you're ready to connect something.` |
| Password field label | `YOUR PASSWORD` |
| Password field placeholder | *(none)* |
| Password helper line | `Confirming it's you — the same check as changing your password.` |
| Primary button | `Create a token` |
| Primary button, pending | `Creating…` |

### S3 — created, shown once

| Element | Copy |
|---|---|
| Notice strip | `This is the only time the token is shown. Copy it now — if you lose it, make a new one.` |
| Config section label | `YOUR AGENT'S CONFIG` |
| Config textarea `aria-label` | `Your agent's config, including the access token. Shown once.` |
| Primary button | `Copy config` |
| Secondary button | `Copy token only` |
| Helper line, before copying | `Paste this into your agent's MCP settings, then restart the agent.` |
| Button shown after a copy | `Done` |
| `Sheet` unsaved strip — prompt | `Close without copying the token?` |
| `Sheet` unsaved strip — leave | `Close anyway` |
| `Sheet` unsaved strip — stay | `Stay here` |

### S4 — copied

| Element | Copy |
|---|---|
| After `Copy config` | `Copied. Paste it into your agent's MCP settings, then restart the agent.` |
| After `Copy token only` | `Token copied. Paste it into your agent's MCP settings, then restart the agent.` |
| After `Copy server URL` (S6) | `Server URL copied.` |

### S5 — clipboard unavailable

| Element | Copy |
|---|---|
| Error line | `Couldn't reach the clipboard. The text above is selected — copy it yourself with ⌘C or Ctrl+C.` |

One string for both platforms. Branching on `navigator.platform` to say only ⌘C is a correctness risk on
desktop Linux and adds a platform check the app makes nowhere else; naming both shortcuts costs six characters
and is never wrong.

### S6 — active token

| Element | Copy |
|---|---|
| Status line | `One token, active since 12 Sep. It ends in 4f2a.` |
| Explanation | `The token itself isn't kept here — only a fingerprint of it — so it can't be shown again. If you've lost it, replace it.` |
| Config section label | `YOUR AGENT'S CONFIG` |
| Config textarea `aria-label` | `Your agent's config, with the token hidden.` |
| Copy URL button | `Copy server URL` |
| Replace button | `Replace this token` |
| Revoke button | `Revoke it` |

### S7 — replace confirm

| Element | Copy |
|---|---|
| Body | `Replacing the token switches off the one you have now. Any agent still using it stops working until you paste the new one in. You'll see the new token once.` |
| Password field label | `YOUR PASSWORD` |
| Confirm button | `Replace it` |
| Confirm button, pending | `Replacing…` |
| Cancel button | `Keep the one I have` |
| Toast on success | `Token replaced` |

### S8 — revoke confirm

| Element | Copy |
|---|---|
| Body | `Revoking switches the token off. Any agent using it loses access straight away. Your own sign-in is untouched, and you can make a new token whenever you like.` |
| Confirm button | `Revoke` |
| Confirm button, pending | `Revoking…` |
| Cancel button | `Keep it` |
| Toast on success | `Token revoked` |

### S9 — errors

| Element | Copy |
|---|---|
| Status read failed | `Couldn't load agent access.` + existing `Try again` button |
| Wrong password | `That password isn't right.` |
| Create failed, other | `Couldn't create the token. Nothing changed — try again.` |
| Replace failed, other | `Couldn't replace the token. The one you have is still working.` |
| Revoke failed | `Couldn't revoke the token. It's still active — try again.` |

Every failure line names what is still true, because "did my token just get half-replaced?" is the one question
this screen must never leave open.

### Words this document refuses to use

`Danger`, `Warning`, `Careful`, `⚠`, `Are you sure?`, `permanently`, `irreversible`, `secret key`, `credential`.
The app says `There is no trash and no undo` and `No mandatory fields. Fast and guilt-free.` — it states
consequences as facts and never as alarm. This screen holds the sharpest consequence in the product, which is
exactly why it must be the calmest about it.

---

## 5. Accessibility

### Focus order

`Sheet` already moves focus to the `<h2>` on open (`tabIndex={-1}`, so it is not a tab stop), traps `Tab`
inside, returns focus to the trigger on close, and closes on Escape. Nothing here changes that. Order within
the trap, in DOM order, which is the order the trap uses:

- **S1** — ✕ → password input → `Create a token`. (`FieldError` is `role="alert"`, not focusable.)
- **S3** — ✕ → config textarea → `Copy config` → `Copy token only` → `Done` (once present).
- **S6** — ✕ → config textarea → `Copy server URL` → `Replace this token` → `Revoke it`.
- **S7** — ✕ → password input → `Replace it` → `Keep the one I have`.
- **S8** — ✕ → `Revoke` → `Keep it`.

The heading takes focus on open, so the token is never auto-focused and never auto-read. That is the right
default here for the same reason `Sheet` chose it generally: no phone keyboard springs up, and nothing is typed
into by accident — but it matters more on this sheet, because the thing that would otherwise be read aloud on
open is a credential.

When S3 replaces S1 after a successful create, the sheet does not remount, so focus stays on the
`Create a token` button that has just been removed. Move focus explicitly to the **config textarea** — it is
the thing that just appeared, it is the thing to act on, and it is the only element a screen-reader user can
read the token from. (`Sheet` solves the same class of problem for its discard strip; this is the same fix, one
level up.)

### What a screen reader announces

**When the token appears.** The notice strip is wrapped in `role="status"`, so it announces:

> This is the only time the token is shown. Copy it now — if you lose it, make a new one.

The token is **not** in a live region. A 40-plus character opaque string read as one utterance is noise, and
worse, it is noise that can be overheard. It is announced only where focus lands — the textarea — where
`aria-label` gives it a name before its value:

> Your agent's config, including the access token. Shown once. Multi-line text, read only.

**Why a `<textarea readonly>` and not a `<pre>` or `<code>`.** A screen-reader user reading an opaque token has
to go character by character. A textarea is a text-editing context: arrow keys walk it a character at a time
and announce each one, `⌘/Ctrl+A` selects it, `⌘/Ctrl+C` copies it, and every screen reader supports that path
today. A `<code>` block supports none of it. The readonly textarea is the accessible affordance here, not a
styling shortcut, and it is why S5's manual fallback works at all.

**When it is copied.** The line under the buttons is `role="status"`:

> Copied. Paste it into your agent's MCP settings, then restart the agent.

Exactly one live region fires. This is why §3/S4 drops the toast: `UIToast` is itself `role="status"`, and a
toast plus an inline status would announce the same event twice.

**When copying fails.** `role="alert"` — assertive, because it interrupts a task the user believes succeeded:

> Couldn't reach the clipboard. The text above is selected — copy it yourself with ⌘C or Ctrl+C.

Focus moves to the textarea with its contents selected, so the announced instruction is immediately actionable.

**Other announcements.** `Token replaced` and `Token revoked` go through `UIToast` (`role="status"`) and are
also visible in the sheet's new state, satisfying R-nav-13's "never the only record". Pending buttons change
their accessible name with their label (`Creating…`, `Replacing…`, `Revoking…`) and carry `disabled`, which the
`Sheet` trap already skips (`button:not([disabled])`).

### Colour and contrast

**No new colour token is introduced.** Every colour used is an existing entry in `Tokens`, so
`tests/screens/contrast.test.ts` continues to cover the palette unchanged. Ratios below are recomputed from the
token values (WCAG relative luminance, oklch converted to sRGB), for the surface each is actually painted on:

| Text | Surface | Light | Dark | AA 4.5:1 |
|---|---|---|---|---|
| `ink` — the config text, status line | `paper` block inside a `card` | 15.77 : 1 | 13.62 : 1 | pass |
| `body` — row labels, button text | `card` | 8.92 : 1 | 9.35 : 1 | pass |
| `mut` — section labels, sub-lines, helper | `card` | 4.99 : 1 | 5.49 : 1 | pass |
| `mut` — notice strip text on the strip's ground | `paper` | 4.61 : 1 | 6.02 : 1 | pass |
| `redText` — `Revoke it`, clipboard error | `card` | 6.41 : 1 | 5.94 : 1 | pass |
| `onInk` (`paper`) — filled dark buttons | `ink` | 15.77 : 1 | 15.77 : 1 | pass |
| `paper` — text on the filled red `Revoke` | `red` | 4.78 : 1 | 5.60 : 1 | pass |

The masked token `••••••••4f2a` renders in `S.T.ink`, not `faint`. `faint` fails AA in both themes — the
a11y build recorded that deliberately for dormancy labels and timestamps — and a masked credential fingerprint
is not decorative: it is the thing the owner is squinting at to check whether their config matches.

The section labels are `S.eyebrow` / `S.sectionLabel`, both `mut` at 11.5–12px, so the large-text exemption
does not apply and the 4.5:1 figures above are the ones that count.

### Other

- Every button is `type="button"` inside a `<form onSubmit>` where one exists; the password field submits on
  Enter, which is the expected behaviour and reaches the same handler as the primary button.
- Touch targets: `S.btn` is `minHeight: 44`, `S.menuBtn` and `S.dangerBtn` are 40 with padding — the app's
  existing sizes, unchanged.
- The masked token uses `•` (U+2022), not `*`. It is announced as "bullet" rather than "star" and, more
  usefully, is not confusable with a real token character.

---

## 6. What I deliberately did not do

**A third icon in the top-right cluster.** §2. The owner asked for the header; the Account sheet is the header,
one tap in, and R-nav-11 survives intact.

**A token list.** Names, created dates, last-used timestamps, per-token revoke. That is an audit surface, and
R-nav-14 removed every audit surface this product had. One token means the status line is one sentence and
revocation is one question. If the owner ends up running three agents at once, this is the decision to revisit
first — see §8.

**Reveal-behind-re-authentication.** It requires retrievable storage, which is the expensive half of the
decision, in exchange for protection against a borrowed unlocked laptop only. The same password prompt moved to
*creation* buys that same protection at the same cost, with the storage still hashed. §1.

**Scopes — a read-only token.** Tempting, and wrong for now: a scope picker announces a permission model, and
R-auth-1 says this product has none. It also doubles every state in §3. If the MCP server later grows a
read-only mode, this sheet has room for one chip row and no other change.

**Expiry, rotation reminders, "last used 3 days ago".** Each is a small ongoing nag in an app whose entire
thesis is that it does not nag. The one escalation this product permits is a red carry chip at two weeks
(R-task-11); a token age badge would be the second, and it would be the wrong one.

**A "Test connection" button.** I want this — it is the difference between "I pasted something" and "it works",
and it would catch the most common failure (an agent that needs a restart). It needs an endpoint that another
agent owns, so it is listed in §7 as a want rather than designed here.

**A QR code, a deep link, a download-as-file.** A token is pasted into a config file on a computer. Every one
of these is a second path to the same string, and each is a second place it can be captured.

**Anything on the signed-out screen, and any change to `TabBar`, `TopActions`' cluster, or `Sheet`'s existing
behaviour.** The one proposed change to `Sheet` is a single optional prop for the discard strip's wording (§3,
S3), and it comes with an explicit "skip it if you'd rather not" fallback.

**A new colour, a new webfont, a new component.** The one addition is a system monospace stack on the config
block, justified in §3/S3 on character-disambiguation grounds. Everything else is `Sheet`, `Empty`,
`FieldError`, `LoadError`, `UIToast` and the existing `styles()` entries.

**The backend.** No token format, no hash choice, no server URL, no MCP protocol, no schema, no endpoint
shapes beyond the field names in §7.

---

## 7. What this design needs from the backend

Field names are suggestions; the shapes are not.

1. **Status, without the secret.** A read that answers "is there a token, since when, and what does it end
   in": `{ token: null }` or `{ createdAt, last4 }`. Never plaintext, in any response, ever again after
   creation.
2. **The server URL, readable in both states.** S6 renders the config with the token masked, so the URL must
   come back from the status read too — not only from the create response. This is the one hard requirement:
   without it the owner can never recover the non-secret half of their config.
3. **A server-composed, ready-to-paste config string.** The create response returns `snippet` — the complete
   block, token included, exactly as it should be pasted. The status read returns the same string with the
   token replaced by `••••••••` + `last4`. The client renders it verbatim and never assembles JSON, because
   the config's shape depends on the MCP protocol and the token format, both of which belong to other agents
   and will change without this document knowing.
4. **Create/replace is one operation.** Creating when a token exists replaces it. There is no state where two
   tokens are live, so there is no endpoint that could produce one.
5. **Create/replace takes the current password**; revoke does not. A wrong password must come back as a
   distinct, non-oracular refusal — the same `VALIDATION_FAILED` shape `change-password` already returns is
   fine, and §4 gives the sentence.
6. **Revoke is idempotent.** Revoking when nothing is active succeeds silently and lands on S1.
7. **Wanted, not required:** a cheap "does this token currently authenticate" probe, so S6 can offer
   `Test connection`. Deferred until an endpoint exists.

---

## 8. For the owner to decide

**One token or several.** Everything above assumes one, because one person connecting one or two agents does
not need a revocation list, and a list is a management surface this product has otherwise removed. The cost is
concrete: with three agents connected, adding a fourth safely — or cutting off one that misbehaved — means
replacing the token and re-pasting it into all four. If the owner expects three or more simultaneous clients,
say so before this is built; a named list of tokens is a different design, not a later tweak.

**Whether the password guard on create is worth it.** It is one field, on an action taken perhaps twice a year,
and it is the only thing standing between an unlocked laptop and a permanent key to the account. I think it is
clearly worth it and it is consistent with the decision already recorded on `change-password`. It is still a
friction the owner is entitled to refuse.

**Which client the config block should be shaped for.** `snippet` has to be *some* client's format. Shaping it
for the agent the owner actually uses makes it genuinely paste-and-go; keeping it generic makes it a template
they edit. This design renders whatever the server sends and has no opinion — but somebody has to pick, and it
should be the person who knows what they are connecting.
