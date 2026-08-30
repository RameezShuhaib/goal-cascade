import { inject, injectable } from 'tsyringe';
import type { AuthUser, Preferences } from '../../domain/entities';
import { PREFERENCE_DEFAULTS } from '../../domain/enums';
import { IClock, IPreferencesRepo } from '../ports';
import type { GuardedWrite } from '../ports/statement';
import { GuardedBatch } from './guarded-batch';

/**
 * Runs from Better Auth's `databaseHooks.user.create.after`.
 *
 * It seeds ONE row: the owner's preferences (theme + timezone). Nothing else.
 *
 * R-auth-6 — a new account starts with an EMPTY goal tree. There is no default cascade, no sample goals,
 * and above all none of the mockup's fixture ids (`g1`…`g15`, `t1`…`t7`, `b1`…`b5`): those are seed data
 * for a demo, and against a real account they belong to nothing. The first screen a new owner sees is
 * the empty state, which the design already specifies.
 *
 * The reference codebase provisioned a tenant, an owner membership, household preferences and a baby
 * state here; Goal Cascade is single-user (R-auth-1), so all of that is gone with it.
 *
 * `timezone` comes from the `X-Timezone` header of the sign-up request — the ONLY thing that header ever
 * does. From then on `preferences.timezone` is authoritative for every week boundary (R-auth-5, Q-9),
 * and a travelling owner's phone cannot shift what "this week" means.
 */
@injectable()
export class ProvisionUserService {
  constructor(
    @inject(IPreferencesRepo) private readonly preferences: IPreferencesRepo,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  async onUserCreated(user: AuthUser, opts: { timezone?: string } = {}): Promise<{ preferences: Preferences }> {
    const now = this.clock.nowIso();
    const prefs: Preferences = {
      userId: user.id,
      ...PREFERENCE_DEFAULTS,
      timezone: opts.timezone ?? PREFERENCE_DEFAULTS.timezone,
      updatedAt: now,
    };
    const writes: GuardedWrite[] = [{ label: 'preferences.insert', stmt: this.preferences.insertStmt(prefs) }];
    await this.batch.run(writes);
    return { preferences: prefs };
  }
}
