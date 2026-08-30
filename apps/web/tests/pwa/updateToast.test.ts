import { describe, expect, it, vi } from 'vitest';
import { showUpdateToast } from '../../src/pwa/updateToast';

describe('showUpdateToast', () => {
  /**
   * The default this guards: `registerType: 'autoUpdate'` reloads the page the moment a new service worker
   * takes control. `pwa/boot.ts` intercepts that with `onNeedReload` and shows this instead, because a reload
   * during a weekly-planning session throws away whatever focus sentence was half-typed. The toast must
   * therefore never reload on its own — only on the tap.
   */
  it('does not reload until the button is tapped', () => {
    const reload = vi.fn();
    showUpdateToast(reload);
    expect(reload).not.toHaveBeenCalled();

    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reload');
    expect(button).toBeTruthy();
    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('goal-cascade-update-toast')).toBeNull();
  });

  it('can be dismissed without reloading, and leaves nothing behind', () => {
    const reload = vi.fn();
    showUpdateToast(reload);
    const dismiss = document.querySelector<HTMLButtonElement>('button[aria-label="Later"]');
    dismiss?.click();
    expect(reload).not.toHaveBeenCalled();
    expect(document.getElementById('goal-cascade-update-toast')).toBeNull();
  });

  it('replaces itself rather than stacking when a second update lands', () => {
    const remove = showUpdateToast(vi.fn());
    showUpdateToast(vi.fn());
    expect(document.querySelectorAll('#goal-cascade-update-toast')).toHaveLength(1);
    remove();
  });

  it('announces itself politely rather than interrupting', () => {
    showUpdateToast(vi.fn());
    expect(document.getElementById('goal-cascade-update-toast')?.getAttribute('role')).toBe('status');
  });
});
