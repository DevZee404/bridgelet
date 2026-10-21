# Issues #809 / #812 / #813 / #814 — §3.1 base-payload fields already implemented (verification + regression tests)

> **Status: resolved / stale.** The work requested by these four issues is
> already present on `main`. This note records the evidence so the issues can be
> closed without another implementation PR. The addition made alongside this
> document is a set of dispatch-level regression tests locking the four fields
> onto emitted events (see §3).
>
> Reviewed against `main` at commit `805c9cc` (*Merge pull request #928 from
> isasadiq/fix/issue-785-dashboard-viewed*), remote
> `https://github.com/bridgelet-org/bridgelet.git`.

---

## 1. What the issues ask for

All four issues share one body with one differing field:

> `docs/analytics-spec.md` §3.1 defines `<field>` as part of the **base payload**
> every event must carry… The current `track()` implementation in
> `frontend/lib/analytics.ts` only forwards an optional free-form `props` object
> to `window.plausible(event, {{ props }})` — it does not construct or attach
> any base-payload fields, so `<field>` is absent from every event that does
> fire. Implement base-payload construction (likely a shared `buildBasePayload()`
> helper) and merge it into every `track()` call.

| Issue | §3.1 field     | Spec definition                                      |
| ----- | -------------- | ---------------------------------------------------- |
| #809  | `platform`     | Fixed value `"web"` for the frontend                 |
| #812  | `device_type`  | `mobile \| tablet \| desktop`, from UA or viewport    |
| #813  | `referrer`     | URL of the referring page or `null`                  |
| #814  | `app_version`  | Frontend build/release version, for deploy correlation |

The described code — `track()` handing a free-form `props` object straight to
`window.plausible(event, { props })` with no base-payload construction — exists
in history, but current `main` is well past it. This is the same stale-issue
pattern as #771, #772, #775 and #784
([`issue-771-page-viewed-already-implemented.md`](issue-771-page-viewed-already-implemented.md),
[`issue-772-send-form-viewed-already-implemented.md`](issue-772-send-form-viewed-already-implemented.md),
[`issue-775-send-form-completed-already-implemented.md`](issue-775-send-form-completed-already-implemented.md),
[`issue-784-claim-link-shared-already-implemented.md`](issue-784-claim-link-shared-already-implemented.md)).

---

## 2. Evidence that the issues are already resolved

### 2.1 The shared `buildBasePayload()` helper exists and carries all four fields

`frontend/lib/analytics.ts:173-184`:

```ts
export function buildBasePayload(journey: Journey = JOURNEYS.shared): EventProps {
  return {
    journey,
    timestamp: new Date().toISOString(),
    network: currentNetwork(),
    app_version: appVersion(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    device_type: detectDeviceType(),
    referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : null,
    platform: PLATFORM,
  };
}
```

That is exactly the helper each issue asks for, and it resolves each field:

- **#809 `platform`** — `platform: PLATFORM`, where `PLATFORM` is the exported
  constant `'web'` (`analytics.ts:55-62`), defined once so a casing typo cannot
  split the dimension in two.
- **#812 `device_type`** — `detectDeviceType()` (`analytics.ts:136-141`)
  classifies `mobile | tablet | desktop` from the user agent, defaulting to
  `desktop` when no signal matches (SSR, unit tests without a DOM).
- **#813 `referrer`** — `document.referrer` when present, `null` otherwise.
  `null` is the spec's own value for "no referring page", not an omission:
  `validatePayload()` treats it as valid (`analytics.ts:679-681`).
- **#814 `app_version`** — `appVersion()` (`analytics.ts:125-128`) reads the
  build-time `NEXT_PUBLIC_APP_VERSION`, falling back to `"unknown"` rather than
  an empty string. `.env.example:58` documents the variable.

### 2.2 `track()` merges it into every event, centrally

`frontend/lib/analytics.ts:751-790` — the single dispatch function:

```ts
const journey = normalizeJourney(eventProps.journey);

const payload: EventProps = {
  ...buildBasePayload(journey),
  anonymous_id: getAnonymousId(),
  session_id: getSessionId(),
  ...eventProps,
  journey,
  message_id: generateUUID(),
};
```

`track()` is the only function through which an event reaches a provider — it
dispatches to `window.plausible` (`analytics.ts:808`), falls back to
`window.posthog.capture` (`analytics.ts:816`), or queues the fully-built payload
for replay (`analytics.ts:823`). All three paths carry the same merged payload,
so no per-call plumbing exists to forget, and no emitter can opt out. The
doc-comment at `analytics.ts:724-728` states this contract explicitly.

### 2.3 Tests already exercised three of the four fields

`frontend/lib/analytics.test.ts` already asserted, before this change:

- `app_version: expect.any(String)`, `device_type: expect.stringMatching(...)`,
  and `'referrer' in props` across six dispatched events
  (`analytics.test.ts:512-521`, same shape at `:561-571` and `:1996-1997`);
- the `buildBasePayload()` values themselves (`analytics.test.ts:107-127`);
- `buildBasePayload().platform === PLATFORM` (`analytics.test.ts:2479-2481`).

### 2.4 Git history — when and why it was "fixed"

- `git show 8dea79e^:frontend/lib/analytics.ts` contains **exactly** the code
  the issues describe:

  ```ts
  function track(event: ClaimEvent, props?: EventProps): void {
    if (typeof window === 'undefined') return;
    const plausible = (window as unknown as { plausible?: Function }).plausible;
    if (typeof plausible === 'function') {
      plausible(event, { props });
      return;
    }
    …
  }
  ```

  No `buildBasePayload()` anywhere in the file.
- Commit `8dea79e` — *Fix/analytics queue and verification (#751)* (2026-09-29)
  — introduced `buildBasePayload()` with `app_version`, `user_agent`,
  `device_type`, `referrer` and `platform`, and merged it in `track()`.
- Commit `96afc63` — *feat(analytics): complete the §3.1 base payload and
  harden the track() dispatch path (#933)* (2026-10-18) — completed the
  remaining §3.1 fields (`journey`, `timestamp`, `network`, exported `PLATFORM`)
  on the same helper.
- The issues were opened 2026-10-15, describing the pre-`8dea79e` state of the
  file — i.e. they were filed against a revision the repo had already left
  behind on 2026-09-29.

**Conclusion:** #809, #812, #813 and #814 were written against the pre-#751
revision and were resolved by PR #751, with PR #933 completing the payload.
On today's `main`, the requested helper exists, merges centrally in `track()`,
and every dispatched event carries all four fields. No implementation work
remains for the issues themselves.

---

## 3. What this PR adds: dispatch-level regression tests

Existing coverage asserted three of the four fields at the *emitter* level and
`platform` only on `buildBasePayload()` itself — nothing pinned all four to a
payload that actually reached the provider, and nothing covered the
pre-provider queue replay path for them. If someone reordered the spread in
`track()`, deleted `platform` from the helper, or rebuilt a queued payload
without it, most of the suite stayed green.

`frontend/lib/analytics.test.ts` gains a block (*§3.1 base payload reaches the
provider (#809, #812, #813, #814)*) asserting that a dispatched event:

- carries `platform: 'web'` (#809);
- carries the build-time `app_version`, and `"unknown"` rather than `''` when
  `NEXT_PUBLIC_APP_VERSION` is unset (#814);
- carries a `device_type` from the closed set `mobile | tablet | desktop` (#812);
- carries `referrer` — `null` with no document referrer, and the real URL when
  one exists (#813);

and that all four survive replay from the pre-provider queue (the `Page Viewed`
cold-load path), which is the one dispatch path that does not go through the
`window.plausible` branch at emit time.

---

## 4. Minor, non-blocking observations (follow-up candidates)

These are *not* what the four issues asked for; they are noted for visibility
only.

1. **`NEXT_PUBLIC_APP_VERSION` is never set by CI.** The variable is documented
   in `.env.example` but no workflow or `next.config.js` injects it, so real
   builds report `app_version: "unknown"` — populated, but not correlated to a
   deploy as §3.1 intends. Wiring it from `frontend/package.json`'s `version`
   (or the release tag) in the build step would make the field useful. Separate
   scope from #814, whose ask — construct and attach the field — is met.

2. **`analytics_spec_version` (§3.1) is not emitted at all.** The spec's JSON
   block lists it alongside `app_version`, but `REQUIRED_BASE_FIELDS` does not
   require it and no code produces it. There is no assigned issue for it yet.

3. **`frontend/package.json` still has no `test` script**, so `.github/workflows/frontend-ci.yml`
   gates `npm test` on script detection and skips the unit suites — the same gap
   PR #933 flagged. The tests added here (and the ~300 existing assertions in
   this file) therefore still do not run in CI.

---

## 5. Recommendation

Close #809, #812, #813 and #814 as **already implemented** (fixed by PR #751,
completed by PR #933), citing:

- `frontend/lib/analytics.ts:173-184` — `buildBasePayload()` with all four fields
- `frontend/lib/analytics.ts:55-62` — the exported `PLATFORM` constant (#809)
- `frontend/lib/analytics.ts:136-141` — `detectDeviceType()` (#812)
- `frontend/lib/analytics.ts:125-128` — `appVersion()` (#814)
- `frontend/lib/analytics.ts:751-790` — the `track()` merge into every payload
- `frontend/lib/analytics.ts:806-823` — plausible / posthog / queue, all carrying the merged payload
- `docs/analytics-spec.md` §3.1 — the field definitions the code matches
- commits `8dea79e` (PR #751) and `96afc63` (PR #933) — the fixes in history

and this PR's regression tests (§3) as the guard against re-introducing the gap.
