/**
 * "Update available — Reload" toast.
 *
 * Plain DOM on purpose: `main.tsx` only imports `pwa/boot.ts` for side effects, so this has no mount point in
 * the React tree and must not need one. It also has to survive the case where React itself failed to mount.
 *
 * With `registerType: 'autoUpdate'` the new worker takes control immediately, but the *running page* is still
 * the old build. vite-plugin-pwa would reload for us; we take that over via `onNeedReload` and wait for a tap
 * instead — reloading under someone who is mid-sentence in a task's description or a goal's `why` loses
 * their text. (The example was "writing a weekly focus"; the focus sentence is deleted, R-rm-2. The
 * reasoning is unchanged — there are still unsaved textareas on screen.)
 *
 * Colours are `colors.ink` / `colors.paper` / `colors.line` from `src/ui.ts`, inlined because this file must
 * not import a React module. `bottom` clears the fixed tab bar (56px) plus the home indicator.
 */
const ID = 'goal-cascade-update-toast';

export function showUpdateToast(onReload: () => void, doc: Document = document): () => void {
  doc.getElementById(ID)?.remove();
  const wrap = doc.createElement('div');
  wrap.id = ID;
  // `role="status"` and not `alert`: it is worth announcing, not worth interrupting.
  wrap.setAttribute('role', 'status');
  wrap.style.cssText =
    'position:fixed;left:16px;right:16px;bottom:calc(72px + env(safe-area-inset-bottom, 0px));display:flex;justify-content:center;z-index:60;pointer-events:none;font-family:Manrope,system-ui,sans-serif';
  const pill = doc.createElement('div');
  pill.style.cssText =
    'display:flex;align-items:center;gap:12px;background:#1c1c19;color:#f6f6f3;font-size:13px;font-weight:700;border-radius:999px;padding:10px 18px;pointer-events:auto;box-shadow:0 6px 20px rgba(28,28,25,.22)';
  const text = doc.createElement('span');
  text.textContent = 'Update available';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Reload';
  btn.style.cssText =
    'background:#f6f6f3;color:#1c1c19;border:none;border-radius:999px;padding:5px 12px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit';
  const dismiss = doc.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Later');
  dismiss.textContent = '✕';
  dismiss.style.cssText = 'background:none;color:#f6f6f3;border:none;font-size:12px;cursor:pointer;padding:0 2px;font-family:inherit';
  const remove = () => wrap.remove();
  btn.addEventListener('click', () => {
    remove();
    onReload();
  });
  dismiss.addEventListener('click', remove);
  pill.append(text, btn, dismiss);
  wrap.append(pill);
  doc.body.append(wrap);
  return remove;
}
