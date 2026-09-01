/**
 * DI tokens. Port tokens are the Symbols exported next to each port interface — **import them from
 * `../../application/ports`**, which is what every consumer including `container.ts` already does.
 *
 * ⚠ **The 15-symbol re-export block that used to sit here is deleted, and so is `ENV`.**
 *
 * The re-export was a second name for every port token and nothing imported it, which is the failure
 * mode a convenience barrel has: it had already fallen out of sync, missing `IApiTokenRepo`. A token is
 * an identity, so a barrel that can go stale is a barrel that can hand out a *different* identity from
 * the one a port was registered under — the kind of DI bug that reads as "the container has no
 * provider" for a provider that is plainly registered.
 *
 * `ENV` was registered in the container and never resolved: `AppEnv` is threaded explicitly through
 * `createRequestContainer`'s own parameter, which is how a value that every layer needs and no layer
 * should look up should travel.
 *
 * `DB` stays because it is a real token with real consumers (`better-auth.ts`, every D1 repo) and it
 * lives on a service module rather than beside a port, so this is the one place it can be named.
 */
export { DB } from '../../application/services/guarded-batch';
