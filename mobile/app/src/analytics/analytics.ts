import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDev } from '../config/env';
import { logger } from '../../../services/logger';

/**
 * Mobile analytics.
 *
 * Event names must match `docs/analytics-spec.md` `#### \`Event Name\`` headings
 * exactly. Events marked "(mobile only)" below are not in the web catalog and
 * are documented in the spec's mobile extension section; they exist because
 * the mobile app has interaction surfaces the web app does not (notifications,
 * translation, theme, render crashes) and those surfaces were previously
 * invisible to product.
 *
 * ## Debugging a missing event
 *
 * `mobile/services/logger` gates verbosity on `isProd ? 'warn' : 'debug'`, so a
 * non-production build prints every tracked event while a production build
 * prints only warnings and errors. That gate is the reason a QA pass through
 * Expo Go against a release branch can look like the app "lost" an event:
 * see `bridgelet-product-audit/runbooks/investigate-analytics-event-gap.md`
 * before filing a gap. Step 3 of that runbook applies here.
 *
 * ## Environment detection
 *
 * Development builds are identified by `EXPO_PUBLIC_ENV`, the same signal
 * `services/logger` uses — deliberately *not* `Constants.appOwnership`, which
 * is true for every Expo Go session including QA runs against release branches,
 * and would silently downgrade a real build to console-only output.
 */

// ─── Journeys ────────────────────────────────────────────────────────────────

/**
 * The `journey` dimension from `docs/analytics-spec.md` §3.1.
 *
 * Exported with the same three values the web app uses so events from both
 * platforms land in one funnel rather than two incompatible ones.
 */
export const JOURNEYS = {
  sender: 'sender',
  recipient: 'recipient',
  shared: 'shared',
} as const;

export type Journey = (typeof JOURNEYS)[keyof typeof JOURNEYS];

/** §3.1 `platform` values for the mobile app. */
export type MobilePlatform = 'ios' | 'android';

export function currentPlatform(): MobilePlatform {
  return Constants.platform === 'ios' ? 'ios' : 'android';
}

/** Base-payload fields shared by every event (`docs/analytics-spec.md` §3.1). */
export interface BasePayload {
  journey: Journey;
  timestamp: string;
  platform: MobilePlatform;
  app_version: string;
  device_type: 'mobile';
  anonymous_id: string;
  session_id: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

interface EventBase {
  journey: Journey;
}

export type AnalyticsEvent =
  // ── Recipient journey (shared names with docs/analytics-spec.md §5) ────────
  | { name: 'Claim Page Opened'; params: EventBase & { claim_id: string; entry_channel: string } }
  | {
      name: 'Claim Verified';
      params: EventBase & {
        claim_id: string;
        asset_type?: string;
        expiry_days_remaining?: number;
        verification_time_ms: number;
      };
    }
  | { name: 'Claim CTA Clicked'; params: EventBase & { claim_id: string; asset_type?: string } }
  | {
      name: 'Wallet Address Screen Viewed';
      params: EventBase & { claim_id: string; has_previous_address: boolean };
    }
  | {
      name: 'Wallet Address Entered';
      params: EventBase & { claim_id: string; used_previous_address: boolean };
    }
  | {
      name: 'Wallet Address Validation Failed';
      params: EventBase & {
        claim_id?: string;
        validation_error: string;
        attempt_number: number;
      };
    }
  | { name: 'Claim Confirmation Viewed'; params: EventBase & { claim_id: string; asset_type?: string } }
  | { name: 'Claim Submitted'; params: EventBase & { claim_id: string; asset_type?: string } }
  | {
      name: 'Claim Succeeded';
      params: EventBase & {
        claim_id: string;
        asset_type?: string;
        time_to_claim_hours?: number;
        sweep_duration_ms?: number;
        entry_channel?: string;
      };
    }
  | {
      name: 'Claim Failed';
      params: EventBase & {
        claim_id: string;
        asset_type?: string;
        error_code?: string;
        error_type: string;
        attempt_number: number;
      };
    }
  | { name: 'Claim Success Viewed'; params: EventBase & { claim_id: string; asset_type?: string } }
  | { name: 'Sender Signup CTA Clicked'; params: EventBase & { claim_id: string } }
  | {
      name: 'Explorer Link Clicked';
      params: EventBase & { claim_id: string; source_screen: string; tx_hash?: string };
    }
  | {
      name: 'Error Displayed';
      params: EventBase & {
        claim_id?: string | null;
        error_type: string;
        error_code?: string;
        source_screen: string;
      };
    }
  | {
      name: 'Retry Clicked';
      params: EventBase & { claim_id?: string | null; error_type: string; attempt_number: number };
    }
  // ── Mobile-only (documented in docs/analytics-spec.md, mobile section) ────
  /** Every navigation to a top-level screen. Replaces the previous `screen_view`. */
  | { name: 'Screen Viewed'; params: EventBase & { screen: string } }
  /** A render-time crash caught by the root ErrorBoundary. */
  | {
      name: 'Crash Reported';
      params: EventBase & {
        error_name: string;
        error_code: string;
        component: string;
        recoverable: boolean;
      };
    }
  /** The recipient opened one notification. */
  | { name: 'Notification Opened'; params: EventBase & { notification_type: string } }
  /** Unread count reached zero (read-all, or the last notification was read). */
  | {
      name: 'Notifications Cleared';
      params: EventBase & { source: 'read_all' | 'last_read'; unread_before: number };
    }
  /** Language detection ran; `detection_source` distinguishes auto from override. */
  | {
      name: 'Language Detected';
      params: EventBase & {
        language: string;
        detection_source: 'auto' | 'manual_override';
        confidence: number;
      };
    }
  /** The user changed the theme preference. */
  | {
      name: 'Theme Changed';
      params: EventBase & { from: string; to: string };
    }
  /**
   * The first-run onboarding finished. `method` distinguishes reaching the
   * last slide from skipping out early, which are different activation
   * signals and would otherwise be averaged together.
   */
  | { name: 'Signup Completed'; params: EventBase & { method: 'completed' | 'skipped' } }
  /** The user signed out; sensitive data was cleared from secure storage. */
  | { name: 'Logout Completed'; params: EventBase }
  /**
   * A generic button press, for CTAs that have no more specific event yet.
   * `button` names the control and `screen` the surface it lives on, so the
   * pair is stable enough to group on without inventing an event per button.
   */
  | { name: 'Button Pressed'; params: EventBase & { button: string; screen: string } };

/** Every event name, for tests and for the spec-drift check. */
export type AnalyticsEventName = AnalyticsEvent['name'];

// ─── Identity (§3.1 anonymous_id / session_id) ────────────────────────────────

const ANONYMOUS_ID_KEY = 'bridgelet_anonymous_id';

let cachedAnonymousId: string | null = null;
let cachedSessionId: string | null = null;
let anonymousIdLoad: Promise<string> | null = null;
let sessionIdLoad: Promise<string> | null = null;

/**
 * RFC-4122 v4 identifier.
 *
 * `expo-crypto` is not a dependency of this app, and adding one purely to mint
 * an analytics id would be a heavier change than the id justifies — so this
 * uses `Math.random`, which is adequate for a non-secret, client-generated,
 * analytics-only identifier. It is **not** suitable for anything security
 * relevant, and must not be reused for session tokens or claim ids.
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Stable per-install identifier, persisted in AsyncStorage.
 *
 * AsyncStorage is app-scoped sandboxed storage — the mobile equivalent of the
 * web app's `localStorage`. It is deliberately *not* `expo-secure-store`: that
 * is for credentials, and this is not one. No claim token, wallet address or
 * payment amount is ever written here; see
 * `bridgelet-product-audit/checklists/localstorage-data-exposure-checklist.md`.
 */
async function getAnonymousId(): Promise<string> {
  if (cachedAnonymousId) return cachedAnonymousId;
  if (!anonymousIdLoad) {
    anonymousIdLoad = (async () => {
      try {
        const stored = await AsyncStorage.getItem(ANONYMOUS_ID_KEY);
        if (stored) return stored;
        const created = generateId();
        await AsyncStorage.setItem(ANONYMOUS_ID_KEY, created);
        return created;
      } catch (error) {
        logger.warn('analytics', 'anonymous_id unavailable, events will lack identity', error);
        return '';
      }
    })();
  }
  cachedAnonymousId = await anonymousIdLoad;
  return cachedAnonymousId;
}

/**
 * Identifier for this app run.
 *
 * Held in memory only and regenerated on every cold start, which is what
 * "one session" means on mobile: an app that stays in the background for a day
 * and is resumed is the same process, so it keeps its session id, while a
 * relaunch starts a new one. Not persisting it means the value cannot outlive
 * the process. Cached behind a promise so that concurrent first events in the
 * same tick share one generated value instead of racing.
 */
async function getSessionId(): Promise<string> {
  if (!sessionIdLoad) {
    sessionIdLoad = Promise.resolve(generateId());
  }
  cachedSessionId = await sessionIdLoad;
  return cachedSessionId;
}

/** Test seam: forgets cached identifiers and re-reads them from storage. */
export function resetIdentityCache(): void {
  cachedAnonymousId = null;
  cachedSessionId = null;
  anonymousIdLoad = null;
  sessionIdLoad = null;
}

/** Builds the §3.1 base payload shared by every event. */
export async function buildBasePayload(journey: Journey): Promise<BasePayload> {
  return {
    journey,
    timestamp: new Date().toISOString(),
    platform: currentPlatform(),
    app_version: Constants.expoConfig?.version ?? 'unknown',
    device_type: 'mobile',
    anonymous_id: await getAnonymousId(),
    session_id: await getSessionId(),
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const ANALYTICS_ENDPOINT = process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT ?? null;
const TAG = 'analytics';

/**
 * Whether events are sent anywhere.
 *
 * Requires both a non-development environment and a configured endpoint. A
 * development build therefore logs instead of sending, and a production build
 * with no endpoint configured says so once rather than silently discarding
 * every event.
 */
export function isAnalyticsEnabled(): boolean {
  return !isDev && ANALYTICS_ENDPOINT !== null;
}

let warnedDisabled = false;

/**
 * Sends one event.
 *
 * Never throws and never blocks the caller: analytics is not on the critical
 * path of a payment, and an analytics failure must not break a claim. The
 * promise is intentionally not awaited anywhere — callers fire and forget.
 */
async function dispatch(name: AnalyticsEventName, payload: Record<string, unknown>): Promise<void> {
  if (!ANALYTICS_ENDPOINT) return;
  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...payload }),
    });
  } catch (error) {
    // One event lost is preferable to a broken claim flow.
    logger.warn(TAG, `failed to send "${name}"`, error);
  }
}

/**
 * Tracks an event.
 *
 * The base payload is fetched asynchronously because the identifiers come from
 * AsyncStorage. The call is fire-and-forget: `track()` returns before the event
 * is dispatched, exactly as the previous implementation did, so no call site
 * has to await telemetry.
 */
export function track(event: AnalyticsEvent): void {
  const { name, params } = event;

  if (isDev) {
    logger.debug(TAG, `${name} ${JSON.stringify(params)}`);
    return;
  }

  void (async () => {
    const base = await buildBasePayload(params.journey);
    const payload = { ...base, ...params };

    if (!isAnalyticsEnabled()) {
      if (!warnedDisabled) {
        warnedDisabled = true;
        logger.warn(
          TAG,
          'EXPO_PUBLIC_ANALYTICS_ENDPOINT is not set, so events are discarded in this build',
        );
      }
      return;
    }

    await dispatch(name, payload as Record<string, unknown>);
  })();
}

/**
 * Records a screen view.
 *
 * Extracted from `useScreenTracking` so the hook stays a one-line wrapper and
 * the behaviour is testable without a renderer.
 */
export function trackScreenView(screen: string): void {
  track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen } });
}

/**
 * Records a generic button press.
 *
 * A one-line seam for CTAs that do not yet warrant their own product event:
 * call sites name the button and the screen, and the shared base payload is
 * attached by `track()` as usual.
 */
export function trackButtonPress(button: string, screen: string): void {
  track({ name: 'Button Pressed', params: { journey: JOURNEYS.shared, button, screen } });
}