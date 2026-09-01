import type { MeResponse, PatchPreferencesRequest, PreferencesResponse, PreferencesView } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { Preferences } from '../../domain/entities';
import { DomainError } from '../../domain/errors';
import { isValidTimezone } from '@goal-cascade/shared';
import type { RequestContext } from '../context';
import { IClock, IPreferencesRepo } from '../ports';
import { GuardedBatch } from './guarded-batch';

/**
 * `/me` and `/me/preferences`. Implemented by the foundation rather than stubbed, because it is a read
 * of the one row the foundation itself provisions — and because the whole session + timezone chain is
 * only really tested once something answers 200 through it.
 */
@injectable()
export class MeService {
  constructor(
    @inject(IPreferencesRepo) private readonly preferences: IPreferencesRepo,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /** R-auth-1 — no tenant, no membership, no invites: a session and the owner's preferences. */
  async getMe(ctx: RequestContext): Promise<MeResponse> {
    return { user: ctx.user, preferences: toView(await this.load(ctx)), serverNow: ctx.now };
  }

  async getPreferences(ctx: RequestContext): Promise<PreferencesResponse> {
    return { preferences: toView(await this.load(ctx)), serverNow: ctx.now };
  }

  /**
   * R-nav-12 — the theme is a real, persisted per-user preference (D-25: the mockup's "dark mode" was a
   * CSS filter that inverted images and did not survive a reload).
   *
   * A timezone the runtime does not recognise is refused rather than stored: it decides every week
   * boundary in the product (R-auth-5), so a bad value would quietly corrupt `originWeekStart` on every
   * task created afterwards.
   */
  async patchPreferences(ctx: RequestContext, patch: PatchPreferencesRequest): Promise<PreferencesResponse> {
    const current = await this.load(ctx);
    if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
      throw new DomainError('VALIDATION_FAILED', 'unknown IANA timezone', { timezone: patch.timezone });
    }
    const next: Preferences = {
      ...current,
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      updatedAt: this.clock.nowIso(),
    };
    await this.batch.run([
      {
        label: 'preferences.update',
        stmt: this.preferences.updateStmt(ctx.userId, {
          theme: next.theme,
          timezone: next.timezone,
          updatedAt: next.updatedAt,
        }),
      },
    ]);
    return { preferences: toView(next), serverNow: ctx.now };
  }

  /**
   * The row is created by `ProvisionUserService` at sign-up, so a missing one means the provisioning
   * hook did not run — a bug, not a state to paper over with defaults that would then silently become
   * the owner's timezone.
   */
  private async load(ctx: RequestContext): Promise<Preferences> {
    const prefs = await this.preferences.get(ctx.userId);
    if (!prefs) throw new DomainError('INTERNAL', 'preferences row missing for this account');
    return prefs;
  }
}

function toView(p: Preferences): PreferencesView {
  return { theme: p.theme, timezone: p.timezone, updatedAt: p.updatedAt };
}
