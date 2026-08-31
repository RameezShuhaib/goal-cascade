import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDeepLink, consumePendingDeepLink, onDeepLink, parseDeepLink, peekPendingDeepLink, resetDeepLinks, setPendingDeepLink } from '../../src/pwa/deepLink';

afterEach(() => resetDeepLinks());

describe('parseDeepLink', () => {
  it('reads the tab and goal shapes from a query, with or without the leading ?', () => {
    expect(parseDeepLink('?tab=goals')).toEqual({ kind: 'tab', tab: 'goals' });
    expect(parseDeepLink('tab=backlog')).toEqual({ kind: 'tab', tab: 'backlog' });
    expect(parseDeepLink('/?tab=plan')).toEqual({ kind: 'tab', tab: 'plan' });
    expect(parseDeepLink('https://cascade.example/?tab=learnings')).toEqual({ kind: 'tab', tab: 'learnings' });
    expect(parseDeepLink('?tab=goals&goal=g12')).toEqual({ kind: 'goal', goalId: 'g12' });
  });

  it('returns null for anything it does not recognise', () => {
    expect(parseDeepLink(null)).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('/goals')).toBeNull();
    expect(parseDeepLink('https://cascade.example/goals')).toBeNull();
    expect(parseDeepLink('?tab=settings')).toBeNull(); // not one of the tabs + backlog/plan
    expect(parseDeepLink('?other=1')).toBeNull();
  });

  /**
   * Ids arrive from the URL, so they are attacker-supplied. Nothing downstream should have to remember to
   * escape them: a link that does not name a plausible entity id is not a link at all.
   */
  it('refuses a goal id that is not a plausible entity id', () => {
    expect(parseDeepLink('?goal=')).toBeNull();
    expect(parseDeepLink('?goal=' + encodeURIComponent('<script>'))).toBeNull();
    expect(parseDeepLink('?goal=' + encodeURIComponent('a/../b'))).toBeNull();
    expect(parseDeepLink('?goal=' + 'x'.repeat(65))).toBeNull();
    expect(parseDeepLink('?goal=' + 'x'.repeat(64))).toEqual({ kind: 'goal', goalId: 'x'.repeat(64) });
  });
});

describe('the pending link store', () => {
  it('holds a link from the page URL until something consumes it', () => {
    expect(captureDeepLink({ search: '?tab=goals' })).toEqual({ kind: 'tab', tab: 'goals' });
    expect(peekPendingDeepLink()).toEqual({ kind: 'tab', tab: 'goals' });
    expect(consumePendingDeepLink()).toEqual({ kind: 'tab', tab: 'goals' });
    // Consuming is a take, not a peek — a link must never be applied twice.
    expect(consumePendingDeepLink()).toBeNull();
  });

  it('delivers a link held from before the consumer mounted, then clears it', () => {
    captureDeepLink({ search: '?goal=g3' });
    const seen = vi.fn();
    const off = onDeepLink(seen);
    expect(seen).toHaveBeenCalledWith({ kind: 'goal', goalId: 'g3' });
    expect(peekPendingDeepLink()).toBeNull();
    off();
  });

  it('delivers a later link straight to a listening consumer without parking it', () => {
    const seen = vi.fn();
    const off = onDeepLink(seen);
    setPendingDeepLink({ kind: 'tab', tab: 'plan' });
    expect(seen).toHaveBeenCalledWith({ kind: 'tab', tab: 'plan' });
    expect(peekPendingDeepLink()).toBeNull();
    off();
  });

  it('survives sessionStorage being unavailable (private mode)', () => {
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => setPendingDeepLink({ kind: 'tab', tab: 'tasks' })).not.toThrow();
      // It still works in memory for this page load; it just does not survive a reload.
      expect(peekPendingDeepLink()).toEqual({ kind: 'tab', tab: 'tasks' });
    } finally {
      setItem.mockRestore();
    }
  });
});
