import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analytics,
  ANALYTICS_NETWORKS,
  appVersion,
  buildBasePayload,
  CLAIM_ENTRY_CHANNELS,
  CLAIM_FAILED_ERROR_TYPES,
  clearPendingEvents,
  conditional,
  createDeduplicationStore,
  DASHBOARD_FILTERS,
  type DashboardFilter,

  currentNetwork,
  daysRemainingUntil,
  DEDUP_MAX_ENTRIES,
  DEDUP_TTL_MS,
  DEDUPLICATED_EVENTS,
  detectDeviceType,
  detectNetwork,
  ERROR_TYPES,
  ErrorType,
  expiryDaysFromHours,
  getAnonymousId,
  getSessionId,
  isAnalyticsOptedOut,
  isDoNotTrackEnabled,
  senderErrorType,
  SEND_FORM_FIELDS,

  isVerificationEnabled,
  JOURNEYS,
  normalizeJourney,
  normalizeAssetType,
  PENDING_QUEUE_MAX_EVENTS,
  pendingEventCount,
  PLATFORM,
  PLATFORMS,
  setAnalyticsOptedOut,
  toAmountUsdEquiv,
  track,
  type ClaimFailedErrorType,
  type ExplorerJourney,
  type ExplorerSourceScreen,
  isReturningClaimVisitor,
  type PaymentCreationFailedProps,
  type SendFormFieldName,
  VALID_EXPIRY_WINDOWS,
  WALLET_PROVIDERS,

  validatePayload,
  type ValidationError,
} from '@/lib/analytics';
import { explorerName, explorerTxUrl } from '@/lib/stellar-explorer';

function plausibleMock() {
  return vi.fn();
}

/**
 * Replaces the global navigator with a stub carrying the given Do Not Track
 * properties. A real `userAgent` is always supplied so `buildBasePayload()`
 * keeps degrading exactly as it does in a browser.
 */
function stubNavigatorWith(dntProperties: Record<string, unknown>): void {
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    ...dntProperties,
  });
}

describe('appVersion', () => {
  it('reads the build-time NEXT_PUBLIC_APP_VERSION when set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.4.2');
    expect(appVersion()).toBe('1.4.2');
  });

  it('falls back to "unknown" without a configured version', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '');
    expect(appVersion()).toBe('unknown');
  });
});

describe('detectDeviceType', () => {
  it('classifies mobile user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('mobile');
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('mobile');
  });

  it('classifies tablet user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 13) Tablet')).toBe('tablet');
  });

  it('classifies desktop user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe('desktop');
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
  });

  it('defaults to desktop when the user agent is empty or absent', () => {
    expect(detectDeviceType('')).toBe('desktop');
    expect(detectDeviceType(undefined)).toBe('desktop');
  });
});

describe('buildBasePayload', () => {
  it('carries the Â§3.1 base fields', () => {
    const payload = buildBasePayload();
    expect(payload).toEqual(
      expect.objectContaining({
        app_version: expect.any(String),
        user_agent: expect.any(String),
        device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
      }),
    );
    expect('referrer' in payload).toBe(true);
  });

  it('degrades to empty strings and null when browser APIs are absent', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', undefined);

    const payload = buildBasePayload();
    expect(payload.user_agent).toBe('');
    expect(payload.device_type).toBe('desktop');
    expect(payload.referrer).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('error taxonomy (Â§6)', () => {
  it('lists exactly the eight standard error_type values from the spec', () => {
    expect(Object.keys(ERROR_TYPES)).toEqual([
      'invalid_token',
      'expired_token',
      'already_claimed',
      'invalid_wallet_address',
      'transaction_failed',
      'network_unavailable',
      'wallet_connection_failed',
      'unknown',
    ]);
  });
});

describe('conditional payload property helpers (Â§3.2)', () => {
  it('builds the claim_id property', () => {
    expect(conditional.claimId('tok_abc')).toEqual({ claim_id: 'tok_abc' });
  });

  it('builds the asset_type property', () => {
    expect(conditional.assetType('XLM')).toEqual({ asset_type: 'XLM' });
    expect(conditional.assetType('USDC')).toEqual({ asset_type: 'USDC' });
  });

  it('builds the amount_usd_equiv property from a numeric value', () => {
    expect(conditional.amountUsdEquiv(25.5)).toEqual({ amount_usd_equiv: 25.5 });
    expect(conditional.amountUsdEquiv(0)).toEqual({ amount_usd_equiv: 0 });
  });

  it('builds the expiry_days property for each valid window', () => {
    expect(conditional.expiryDays(1)).toEqual({ expiry_days: 1 });
    expect(conditional.expiryDays(3)).toEqual({ expiry_days: 3 });
    expect(conditional.expiryDays(7)).toEqual({ expiry_days: 7 });
    expect(conditional.expiryDays(30)).toEqual({ expiry_days: 30 });
    expect(conditional.expiryDays(90)).toEqual({ expiry_days: 90 });
  });

  it('builds the expiry_days property as null for a non-expiring payment', () => {
    expect(conditional.expiryDays(null)).toEqual({ expiry_days: null });
  });

  it('exposes the enumerated expiry windows, including the 3-day send-form option', () => {
    expect(VALID_EXPIRY_WINDOWS).toEqual([1, 3, 7, 30, 90]);
  });

  it('builds the error_type property', () => {
    expect(conditional.errorType('expired_token')).toEqual({ error_type: 'expired_token' });
    expect(conditional.errorType('invalid_token')).toEqual({ error_type: 'invalid_token' });
  });

  it('builds the error_code property', () => {
    expect(conditional.errorCode('TOKEN_EXPIRED')).toEqual({ error_code: 'TOKEN_EXPIRED' });
    expect(conditional.errorCode('unknown')).toEqual({ error_code: 'unknown' });
  });
});

describe('conditional props wired into emitted events', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('Claim Verified carries claim_id and asset_type via the helpers', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimVerified({
      claimId: 'tok_abc',
      assetType: 'XLM',
      expiryDaysRemaining: 7,
      verificationTimeMs: 42,
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({ claim_id: 'tok_abc', asset_type: 'XLM' }),
    );
  });

  it('Claim Verified omits asset_type when no asset is available', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimVerified({ claimId: 'tok_abc', verificationTimeMs: 42 });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(expect.objectContaining({ claim_id: 'tok_abc' }));
    expect('asset_type' in call[1].props).toBe(false);
  });

  it('Claim CTA Clicked carries claim_id and asset_type via the helpers', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimCtaClicked({ claimId: 'tok_abc', assetType: 'XLM' });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({ journey: 'recipient', claim_id: 'tok_abc', asset_type: 'XLM' }),
    );
  });
});

describe('analytics.sendFormFieldChanged (§4.2 / #774)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it.each(['amount', 'recipient_name', 'message'] as SendFormFieldName[])(
    'emits Send Form Field Changed with field_name=%s and journey=sender',
    (fieldName) => {
      mockPlausible();
      analytics.sendFormFieldChanged({ fieldName });

      const call = latest();
      expect(call[0]).toBe('Send Form Field Changed');
      expect(call[1].props).toEqual(
        expect.objectContaining({ journey: 'sender', field_name: fieldName }),
      );
    },
  );

  it('attaches asset_type when field is "asset" and assetType is provided', () => {
    mockPlausible();
    analytics.sendFormFieldChanged({ fieldName: 'asset', assetType: 'USDC' });
    expect(latest()[1].props).toEqual(
      expect.objectContaining({ field_name: 'asset', asset_type: 'USDC' }),
    );
  });

  it('omits asset_type when field is "asset" but no assetType is given', () => {
    mockPlausible();
    analytics.sendFormFieldChanged({ fieldName: 'asset' });
    const props = latest()[1].props as Record<string, unknown>;
    expect(props.field_name).toBe('asset');
    expect('asset_type' in props).toBe(false);
  });

  it('attaches expiry_days when field is "expiration"', () => {
    mockPlausible();
    analytics.sendFormFieldChanged({ fieldName: 'expiration', expiryDays: 7 });
    expect(latest()[1].props).toEqual(
      expect.objectContaining({ field_name: 'expiration', expiry_days: 7 }),
    );
  });

  it('attaches expiry_days: null when field is "expiration" and expiryDays is null', () => {
    mockPlausible();
    analytics.sendFormFieldChanged({ fieldName: 'expiration', expiryDays: null });
    const props = latest()[1].props as Record<string, unknown>;
    expect(props.field_name).toBe('expiration');
    expect(props).toHaveProperty('expiry_days', null);
  });

  it('omits expiry_days when field is not "expiration"', () => {
    mockPlausible();
    analytics.sendFormFieldChanged({ fieldName: 'amount' });
    const props = latest()[1].props as Record<string, unknown>;
    expect('expiry_days' in props).toBe(false);
  });
});

describe('expiry_days null serialisation (§3.2 / #818)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const propsOf = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]![1].props as Record<string, unknown>;

  it('sendFormCompleted serialises expiry_days: null correctly', () => {
    mockPlausible();
    analytics.sendFormCompleted({ expiryDays: null, hasRecipientName: true, hasMessage: false });
    expect(propsOf()).toHaveProperty('expiry_days', null);
  });

  it('paymentConfirmationViewed serialises expiry_days: null correctly', () => {
    mockPlausible();
    analytics.paymentConfirmationViewed({ expiryDays: null });
    expect(propsOf()).toHaveProperty('expiry_days', null);
  });

  it('paymentConfirmed serialises expiry_days: null correctly', () => {
    mockPlausible();
    analytics.paymentConfirmed({ walletType: 'Freighter', expiryDays: null });
    expect(propsOf()).toHaveProperty('expiry_days', null);
  });

  it('paymentCreated serialises expiry_days: null correctly', () => {
    mockPlausible();
    analytics.paymentCreated({ claimId: 'tok_null_expiry', confirmationTimeMs: 100, expiryDays: null });
    expect(propsOf()).toHaveProperty('expiry_days', null);
  });

  it('sendFormCompleted omits expiry_days when the param is not provided', () => {
    mockPlausible();
    analytics.sendFormCompleted({ hasRecipientName: false, hasMessage: false });
    expect('expiry_days' in propsOf()).toBe(false);
  });
});

describe('analytics.walletConnectionFailed (§4.3 / #819)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('emits Wallet Connection Failed with error_code and journey=sender', () => {
    mockPlausible();
    analytics.walletConnectionFailed({ errorCode: 'USER_REJECTED' });
    const call = latest();
    expect(call[0]).toBe('Wallet Connection Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({ journey: 'sender', error_code: 'USER_REJECTED' }),
    );
  });

  it('defaults error_code to "unknown" when not provided', () => {
    mockPlausible();
    analytics.walletConnectionFailed();
    expect(latest()[1].props).toEqual(expect.objectContaining({ error_code: 'unknown' }));
  });
});

describe('analytics.paymentCreationFailed (§4.4 / #819)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('emits Payment Creation Failed with error_code and journey=sender', () => {
    mockPlausible();
    analytics.paymentCreationFailed({ errorCode: 'TX_FAILED' });
    const call = latest();
    expect(call[0]).toBe('Payment Creation Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({ journey: 'sender', error_code: 'TX_FAILED' }),
    );
  });

  it('attaches asset_type when provided', () => {
    mockPlausible();
    analytics.paymentCreationFailed({ errorCode: 'TX_FAILED', assetType: 'USDC' });
    expect(latest()[1].props).toEqual(expect.objectContaining({ asset_type: 'USDC' }));
  });

  it('defaults error_code to "unknown" when not provided', () => {
    mockPlausible();
    analytics.paymentCreationFailed();
    expect(latest()[1].props).toEqual(expect.objectContaining({ error_code: 'unknown' }));
  });
});

describe('analytics.errorDisplayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('emits Error Displayed with error_type and error_code', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'recipient',
      claimId: 'tok_123',
      errorType: 'expired_token',
      errorCode: 'TOKEN_EXPIRED',
      sourceScreen: 'claim_landing',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[0]).toBe('Error Displayed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'tok_123',
        error_type: 'expired_token',
        error_code: 'TOKEN_EXPIRED',
        source_screen: 'claim_landing',
      }),
    );
  });

  it('defaults error_code to "unknown" and omits claim_id when not provided', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'sender',
      errorType: 'invalid_token',
      sourceScreen: 'claim_landing',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        error_type: 'invalid_token',
        error_code: 'unknown',
        source_screen: 'claim_landing',
      }),
    );
    expect('claim_id' in call[1].props).toBe(false);
  });
});

describe('track base payload merge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('attaches the base payload to every tracking call', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimPageViewed({ claimId: 'tok_123', entryChannel: 'direct' });
    analytics.claimInitiated({ claimId: 'tok_123' });
    analytics.claimSuccess({ claimId: 'tok_123' });
    analytics.claimError({
      claimId: 'tok_123',
      errorType: 'transaction_failed',
      attemptNumber: 1,
    });
    analytics.claimVerified({
      claimId: 'tok_123',
      verificationTimeMs: 42,
      expiryDaysRemaining: 7,
    });
    analytics.claimCtaClicked({ claimId: 'tok_123' });

    const plausible = (window as unknown as { plausible: ReturnType<typeof plausibleMock> })
      .plausible;
    expect(plausible).toHaveBeenCalledTimes(6);

    for (const call of plausible.mock.calls) {
      expect(call[1]).toEqual({
        props: expect.objectContaining({
          app_version: expect.any(String),
          user_agent: expect.any(String),
          device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
        }),
      });
      expect('referrer' in call[1].props).toBe(true);
    }
  });

  it('merges event-specific props next to the base payload', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimVerified({
      claimId: 'tok_123',
      assetType: 'XLM',
      expiryDaysRemaining: 7,
      verificationTimeMs: 42,
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[0]).toBe('Claim Verified');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'tok_123',
        asset_type: 'XLM',
        expiry_days_remaining: 7,
        verification_time_ms: 42,
      }),
    );
  });

  it('lets event props override the base payload', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimError({
      claimId: 'tok_123',
      errorType: 'network_error',
      attemptNumber: 1,
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        app_version: expect.any(String),
        user_agent: expect.any(String),
        device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
        error_type: 'network_error',
      }),
    );
    expect(typeof call[1].props.referrer === 'string' || call[1].props.referrer === null).toBe(
      true,
    );
  });

  it('no-ops when the window object is unavailable', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;
    vi.stubGlobal('window', undefined);

    expect(() => analytics.claimPageViewed({ claimId: 'tok_123', entryChannel: 'direct' })).not.toThrow();
    expect(plausible).not.toHaveBeenCalled();
  });
});

describe('analytics.errorDisplayed (cluster-owned error types)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const clusterTypes: ErrorType[] = [
    'already_claimed',
    'invalid_wallet_address',
    'transaction_failed',
    'network_unavailable',
  ];

  it.each(clusterTypes)('emits Error Displayed with error_type %s', (errorType) => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'recipient',
      claimId: 'tok_123',
      errorType,
      errorCode: 'TEST_CODE',
      sourceScreen: 'claim_landing',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[0]).toBe('Error Displayed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'tok_123',
        error_type: errorType,
        error_code: 'TEST_CODE',
        source_screen: 'claim_landing',
      }),
    );
  });

  it('defaults error_code to "unknown" when no machine-readable code is available', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'recipient',
      errorType: 'network_unavailable',
      sourceScreen: 'claim_landing',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        error_type: 'network_unavailable',
        error_code: 'unknown',
        source_screen: 'claim_landing',
      }),
    );
  });
});

describe('analytics.errorDisplayed (wallet connection & catch-all)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('emits Error Displayed with wallet_connection_failed on the sender journey', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'sender',
      errorType: 'wallet_connection_failed',
      errorCode: 'CONNECTION_DENIED',
      sourceScreen: 'send_form_connect',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        error_type: 'wallet_connection_failed',
        error_code: 'CONNECTION_DENIED',
        source_screen: 'send_form_connect',
      }),
    );
  });

  it('emits Error Displayed with the catch-all unknown type on the recipient journey', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.errorDisplayed({
      journey: 'recipient',
      claimId: 'tok_abc',
      errorType: 'unknown',
      errorCode: 'CLAIM_LOAD_FAILED',
      sourceScreen: 'claim_landing',
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'tok_abc',
        error_type: 'unknown',
        error_code: 'CLAIM_LOAD_FAILED',
        source_screen: 'claim_landing',
      }),
    );
  });
});

describe('ValidationError type taxonomy', () => {
  it('accepts all three Â§5.2 validation_error values at compile time', () => {
    const values: ValidationError[] = ['invalid_prefix', 'invalid_length', 'invalid_checksum'];
    expect(values).toHaveLength(3);
  });
});

describe('daysRemainingUntil', () => {
  it('returns approximately 1 for a timestamp 24 h in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(daysRemainingUntil(future)).toBe(1);
  });

  it('returns 0 for a timestamp in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(daysRemainingUntil(past)).toBe(0);
  });

  it('returns undefined for an invalid ISO string', () => {
    expect(daysRemainingUntil('not-a-date')).toBeUndefined();
  });
});

describe('recipient claim pipeline events (Â§5.2â€“Â§5.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  describe('analytics.walletAddressValidationFailed (Â§5.2)', () => {
    it('emits Wallet Address Validation Failed with required fields', () => {
      mockPlausible();
      analytics.walletAddressValidationFailed({
        claimId: 'claim-abc',
        validationError: 'invalid_prefix',
        attemptNumber: 1,
      });

      const call = latest();
      expect(call[0]).toBe('Wallet Address Validation Failed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-abc',
          validation_error: 'invalid_prefix',
          attempt_number: 1,
        }),
      );
    });

    it('omits claim_id when not provided', () => {
      mockPlausible();
      analytics.walletAddressValidationFailed({
        validationError: 'invalid_length',
        attemptNumber: 2,
      });

      const props = latest()[1].props as {
        claim_id?: string;
        validation_error: string;
        attempt_number: number;
      };
      expect(props).not.toHaveProperty('claim_id');
      expect(props.validation_error).toBe('invalid_length');
      expect(props.attempt_number).toBe(2);
    });

    it('passes invalid_checksum variant', () => {
      mockPlausible();
      analytics.walletAddressValidationFailed({
        claimId: 'claim-xyz',
        validationError: 'invalid_checksum',
        attemptNumber: 3,
      });

      const props = latest()[1].props as { validation_error: string };
      expect(props.validation_error).toBe('invalid_checksum');
    });

    it('increments attempt_number on successive failures', () => {
      mockPlausible();
      for (let i = 1; i <= 3; i++) {
        analytics.walletAddressValidationFailed({
          claimId: 'claim-seq',
          validationError: 'invalid_prefix',
          attemptNumber: i,
        });
      }
      const attempts = (
        window as unknown as { plausible: ReturnType<typeof plausibleMock> }
      ).plausible.mock.calls.map((c) => c[1].props.attempt_number);
      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  describe('analytics.claimConfirmationViewed (Â§5.3)', () => {
    it('emits Claim Confirmation Viewed with claim_id and asset_type', () => {
      mockPlausible();
      analytics.claimConfirmationViewed({ claimId: 'claim-def', assetType: 'XLM' });

      const call = latest();
      expect(call[0]).toBe('Claim Confirmation Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-def',
          asset_type: 'XLM',
        }),
      );
    });

    it('omits asset_type when not provided', () => {
      mockPlausible();
      analytics.claimConfirmationViewed({ claimId: 'claim-def' });

      const props = latest()[1].props as { asset_type?: string };
      expect(props).not.toHaveProperty('asset_type');
    });
  });

  describe('analytics.claimSubmitted (Â§5.3)', () => {
    it('emits Claim Submitted with claim_id and asset_type', () => {
      mockPlausible();
      analytics.claimSubmitted({ claimId: 'claim-ghi', assetType: 'USDC' });

      const call = latest();
      expect(call[0]).toBe('Claim Submitted');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-ghi',
          asset_type: 'USDC',
        }),
      );
    });

    it('omits asset_type when not provided', () => {
      mockPlausible();
      analytics.claimSubmitted({ claimId: 'claim-ghi' });

      const props = latest()[1].props as { asset_type?: string };
      expect(props).not.toHaveProperty('asset_type');
    });
  });

  describe('analytics.claimSucceeded (Â§5.3)', () => {
    it('emits Claim Succeeded with all optional fields present', () => {
      mockPlausible();
      analytics.claimSucceeded({
        claimId: 'claim-jkl',
        assetType: 'XLM',
        timeToClaimHours: 3,
        sweepDurationMs: 4200,
        entryChannel: 'whatsapp',
      });

      const call = latest();
      expect(call[0]).toBe('Claim Succeeded');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-jkl',
          asset_type: 'XLM',
          time_to_claim_hours: 3,
          sweep_duration_ms: 4200,
          entry_channel: 'whatsapp',
        }),
      );
    });

    it('defaults entry_channel to "unknown" when omitted', () => {
      mockPlausible();
      analytics.claimSucceeded({ claimId: 'claim-mno' });

      const props = latest()[1].props as { entry_channel: string };
      expect(props.entry_channel).toBe('unknown');
    });

    it('omits time_to_claim_hours and sweep_duration_ms when undefined', () => {
      mockPlausible();
      analytics.claimSucceeded({ claimId: 'claim-pqr' });

      const props = latest()[1].props as {
        time_to_claim_hours?: number;
        sweep_duration_ms?: number;
      };
      expect(props).not.toHaveProperty('time_to_claim_hours');
      expect(props).not.toHaveProperty('sweep_duration_ms');
    });

    it('omits asset_type when not provided', () => {
      mockPlausible();
      analytics.claimSucceeded({ claimId: 'claim-stu' });

      const props = latest()[1].props as { asset_type?: string };
      expect(props).not.toHaveProperty('asset_type');
    });
  });

  it('no-ops when the window object is unavailable', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;
    vi.stubGlobal('window', undefined);

    expect(() =>
      analytics.walletAddressValidationFailed({
        claimId: 'ssr-test',
        validationError: 'invalid_prefix',
        attemptNumber: 1,
      }),
    ).not.toThrow();
    expect(plausible).not.toHaveBeenCalled();
  });
});

describe('ClaimFailedErrorType taxonomy', () => {
  it('exposes the five §5.3 values', () => {
    const keys = Object.keys(CLAIM_FAILED_ERROR_TYPES);
    expect(keys).toContain('network_error');
    expect(keys).toContain('token_expired');
    expect(keys).toContain('already_claimed');
    expect(keys).toContain('transaction_failed');
    expect(keys).toContain('unknown');
  });

  it('each key maps to itself (const enum pattern)', () => {
    for (const [k, v] of Object.entries(CLAIM_FAILED_ERROR_TYPES)) {
      expect(k).toBe(v);
    }
  });
});

describe('post-claim events (§5.3–§5.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  describe('analytics.claimFailed (§5.3)', () => {
    it('emits Claim Failed with all required fields', () => {
      mockPlausible();
      analytics.claimFailed({
        claimId: 'claim-001',
        assetType: 'XLM',
        errorCode: 'SUBMISSION_FAILED_FINAL',
        errorType: 'transaction_failed',
        attemptNumber: 1,
      });

      const call = latest();
      expect(call[0]).toBe('Claim Failed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-001',
          asset_type: 'XLM',
          error_code: 'SUBMISSION_FAILED_FINAL',
          error_type: 'transaction_failed',
          attempt_number: 1,
        }),
      );
    });

    it('defaults error_code to "unknown" when omitted', () => {
      mockPlausible();
      analytics.claimFailed({
        claimId: 'claim-002',
        errorType: 'network_error',
        attemptNumber: 1,
      });

      const props = latest()[1].props as { error_code: string };
      expect(props.error_code).toBe('unknown');
    });

    it('omits asset_type when not provided', () => {
      mockPlausible();
      analytics.claimFailed({
        claimId: 'claim-003',
        errorType: 'unknown',
        attemptNumber: 1,
      });

      const props = latest()[1].props as { asset_type?: string };
      expect(props).not.toHaveProperty('asset_type');
    });

    it.each([
      'network_error',
      'token_expired',
      'already_claimed',
      'transaction_failed',
      'unknown',
    ] as ClaimFailedErrorType[])('emits correct error_type for %s', (errorType) => {
      mockPlausible();
      analytics.claimFailed({ claimId: 'claim-004', errorType, attemptNumber: 1 });

      const props = latest()[1].props as { error_type: ClaimFailedErrorType };
      expect(props.error_type).toBe(errorType);
    });

    it('increments attempt_number across successive failures', () => {
      mockPlausible();
      for (let i = 1; i <= 3; i++) {
        analytics.claimFailed({
          claimId: 'claim-seq',
          errorType: 'network_error',
          attemptNumber: i,
        });
      }
      const attempts = (
        window as unknown as { plausible: ReturnType<typeof plausibleMock> }
      ).plausible.mock.calls.map((c) => c[1].props.attempt_number);
      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  describe('analytics.claimSuccessViewed (§5.4)', () => {
    it('emits Claim Success Viewed with claim_id and asset_type', () => {
      mockPlausible();
      analytics.claimSuccessViewed({ claimId: 'claim-005', assetType: 'USDC' });

      const call = latest();
      expect(call[0]).toBe('Claim Success Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-005',
          asset_type: 'USDC',
        }),
      );
    });

    it('omits asset_type when not provided', () => {
      mockPlausible();
      analytics.claimSuccessViewed({ claimId: 'claim-006' });

      const props = latest()[1].props as { asset_type?: string };
      expect(props).not.toHaveProperty('asset_type');
    });
  });

  describe('analytics.senderSignupCtaClicked (§5.4)', () => {
    it('emits Sender Signup CTA Clicked with fixed source value', () => {
      mockPlausible();
      analytics.senderSignupCtaClicked({ claimId: 'claim-007' });

      const call = latest();
      expect(call[0]).toBe('Sender Signup CTA Clicked');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-007',
          source: 'claim_success_screen',
        }),
      );
    });
  });

  describe('analytics.explorerLinkClicked (§5.4/§6)', () => {
    it('emits Explorer Link Clicked with recipient journey and claim_success source', () => {
      mockPlausible();
      analytics.explorerLinkClicked({
        journey: 'recipient',
        claimId: 'claim-008',
        sourceScreen: 'claim_success',
      });

      const call = latest();
      expect(call[0]).toBe('Explorer Link Clicked');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim-008',
          source_screen: 'claim_success',
        }),
      );
    });

    it('emits Explorer Link Clicked with sender journey and payment_details source', () => {
      mockPlausible();
      analytics.explorerLinkClicked({
        journey: 'sender',
        claimId: 'claim-009',
        sourceScreen: 'payment_details',
      });

      const props = latest()[1].props as {
        journey: ExplorerJourney;
        source_screen: ExplorerSourceScreen;
      };
      expect(props.journey).toBe('sender');
      expect(props.source_screen).toBe('payment_details');
    });

    it.each([
      ['recipient', 'claim_success'],
      ['sender', 'payment_details'],
    ] as [ExplorerJourney, ExplorerSourceScreen][])(
      'accepts journey=%s, sourceScreen=%s',
      (journey, sourceScreen) => {
        mockPlausible();
        analytics.explorerLinkClicked({ journey, claimId: 'claim-010', sourceScreen });

        const props = latest()[1].props as {
          journey: ExplorerJourney;
          source_screen: ExplorerSourceScreen;
        };
        expect(props.journey).toBe(journey);
        expect(props.source_screen).toBe(sourceScreen);
      },
    );

    it('carries tx_hash, explorer, and network when provided (§5.4)', () => {
      mockPlausible();
      analytics.explorerLinkClicked({
        journey: 'recipient',
        claimId: 'claim-011',
        sourceScreen: 'claim_success',
        txHash: 'abc123',
        explorer: 'stellar_expert',
        network: 'testnet',
      });

      const props = latest()[1].props as Record<string, unknown>;
      expect(props.tx_hash).toBe('abc123');
      expect(props.explorer).toBe('stellar_expert');
      expect(props.network).toBe('testnet');
    });

    it('omits tx_hash, explorer, and network when not provided (§5.4)', () => {
      mockPlausible();
      analytics.explorerLinkClicked({
        journey: 'sender',
        claimId: 'claim-012',
        sourceScreen: 'payment_details',
      });

      const props = latest()[1].props as Record<string, unknown>;
      expect('tx_hash' in props).toBe(false);
      expect('explorer' in props).toBe(false);
      expect('network' in props).toBe(false);
    });
  });

  describe('analytics recovery information events (§4.5)', () => {
    it('emits Recovery Information Viewed with journey, claim_id, and recovery_method', () => {
      mockPlausible();
      analytics.recoveryInformationViewed({
        claimId: 'claim-013',
        recoveryMethod: 'reclaim_expired',
      });

      const call = latest();
      expect(call[0]).toBe('Recovery Information Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          claim_id: 'claim-013',
          recovery_method: 'reclaim_expired',
        }),
      );
    });

    it('emits Recovery Information Copied with recovery_method and copy_target', () => {
      mockPlausible();
      analytics.recoveryInformationCopied({
        claimId: 'claim-014',
        recoveryMethod: 'self_custody_backup',
        copyTarget: 'wallet_secret',
      });

      const call = latest();
      expect(call[0]).toBe('Recovery Information Copied');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          claim_id: 'claim-014',
          recovery_method: 'self_custody_backup',
          copy_target: 'wallet_secret',
        }),
      );
    });

    it('never carries the recovery material itself (§4.5 privacy boundary)', () => {
      mockPlausible();
      analytics.recoveryInformationCopied({
        claimId: 'claim-015',
        recoveryMethod: 'reclaim_expired',
        copyTarget: 'claim_link',
      });

      const props = latest()[1].props as Record<string, unknown>;
      expect(props).toMatchObject({
        journey: 'sender',
        claim_id: 'claim-015',
        recovery_method: 'reclaim_expired',
        copy_target: 'claim_link',
      });
      // Records the copy, not what was copied.
      expect(props).not.toHaveProperty('value');
      expect(props).not.toHaveProperty('secret');
    });
  });

  it('no-ops when the window object is unavailable', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;
    vi.stubGlobal('window', undefined);

    expect(() =>
      analytics.claimFailed({
        claimId: 'ssr-test',
        errorType: 'unknown',
        attemptNumber: 1,
      }),
    ).not.toThrow();
    expect(plausible).not.toHaveBeenCalled();
  });
});

describe('analytics.paymentCreationFailed (§4.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('emits Payment Creation Failed with default unknown error_code and sender journey', () => {
    mockPlausible();
    analytics.paymentCreationFailed();

    const call = latest();
    expect(call[0]).toBe('Payment Creation Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        error_code: 'unknown',
      }),
    );
  });

  it('emits Payment Creation Failed with asset_type and error_code', () => {
    mockPlausible();
    analytics.paymentCreationFailed({
      assetType: 'USDC',
      errorCode: 'SUBMIT_FAILED',
    });

    const call = latest();
    expect(call[0]).toBe('Payment Creation Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        asset_type: 'USDC',
        error_code: 'SUBMIT_FAILED',
      }),
    );
  });

  it('omits asset_type when not provided', () => {
    mockPlausible();
    analytics.paymentCreationFailed({
      errorCode: 'STELLAR_CREATION_FAILURE',
    });

    const call = latest();
    expect(call[0]).toBe('Payment Creation Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        error_code: 'STELLAR_CREATION_FAILURE',
      }),
    );
    expect(call[1].props).not.toHaveProperty('asset_type');
  });

  it('allows direct track() call for Payment Creation Failed', () => {
    mockPlausible();
    track('Payment Creation Failed', {
      journey: 'sender',
      asset_type: 'XLM',
      error_code: 'op_underfunded',
    });

    const call = latest();
    expect(call[0]).toBe('Payment Creation Failed');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'sender',
        asset_type: 'XLM',
        error_code: 'op_underfunded',
      }),
    );
  });
});

describe('getAnonymousId (§3.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('generates a UUID v4 on first call', () => {
    const id = getAnonymousId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('persists the same id across multiple calls within the same session', () => {
    const first = getAnonymousId();
    const second = getAnonymousId();
    expect(first).toBe(second);
  });

  it('restores the id from localStorage on re-load', () => {
    const id = getAnonymousId();
    const restored = getAnonymousId();
    expect(restored).toBe(id);
  });

  it('stores the id in localStorage under the expected key', () => {
    getAnonymousId();
    expect(localStorage.getItem('bridgelet_anonymous_id')).not.toBeNull();
  });
});

describe('getSessionId (§3.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('generates a UUID v4 on first call', () => {
    const id = getSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns the same id within the same session', () => {
    const first = getSessionId();
    const second = getSessionId();
    expect(first).toBe(second);
  });

  it('produces a different id after sessionStorage is cleared (new session)', () => {
    const first = getSessionId();
    sessionStorage.clear();
    const second = getSessionId();
    expect(first).not.toBe(second);
  });

  it('stores the id in sessionStorage under the expected key', () => {
    const id = getSessionId();
    expect(sessionStorage.getItem('bridgelet_session_id')).toBe(id);
  });

  it('rotates the id after 30 minutes of inactivity (§9.3, via analytics-session)', () => {
    const first = getSessionId();
    const start = Date.now();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(start + 30 * 60 * 1000 + 1000);
      const second = getSessionId();
      expect(second).not.toBe(first);
      expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/i);
      expect(sessionStorage.getItem('bridgelet_session_id')).toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('track() base-payload identity merge', () => {

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('attaches anonymous_id and session_id to every emitted event', () => {
    mockPlausible();
    const anonId = getAnonymousId();
    const sessId = getSessionId();

    analytics.claimVerified({ claimId: 'claim-base', verificationTimeMs: 100 });

    const props = latest()[1].props as { anonymous_id: string; session_id: string };
    expect(props.anonymous_id).toBe(anonId);
    expect(props.session_id).toBe(sessId);
  });

  it('attaches identity fields to Claim CTA Clicked as well', () => {
    mockPlausible();
    analytics.claimCtaClicked({ claimId: 'claim-cta' });

    const props = latest()[1].props as { anonymous_id?: string; session_id?: string };
    expect(props).toHaveProperty('anonymous_id');
    expect(props).toHaveProperty('session_id');
  });

  it('event-specific props override base fields when keys collide', () => {
    mockPlausible();
    analytics.errorDisplayed({
      journey: 'recipient',
      errorType: 'unknown',
      sourceScreen: 'claim_page',
    });

    const props = latest()[1].props as { anonymous_id?: string; session_id?: string };
    expect(props).toHaveProperty('anonymous_id');
    expect(props).toHaveProperty('session_id');
  });
});

describe('analytics.errorDisplayed shared journey & taxonomy (§6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('emits Error Displayed with all required fields', () => {
    mockPlausible();
    analytics.errorDisplayed({
      journey: 'recipient',
      claimId: 'claim-err-001',
      errorType: 'network_unavailable',
      errorCode: 'API_UNREACHABLE',
      sourceScreen: 'claim_page',
    });

    const props = latest()[1].props as {
      journey: string;
      claim_id: string;
      error_type: string;
      error_code: string;
      source_screen: string;
    };
    expect(props.journey).toBe('recipient');
    expect(props.claim_id).toBe('claim-err-001');
    expect(props.error_type).toBe('network_unavailable');
    expect(props.error_code).toBe('API_UNREACHABLE');
    expect(props.source_screen).toBe('claim_page');
  });

  it('defaults error_code to "unknown" when omitted', () => {
    mockPlausible();
    analytics.errorDisplayed({
      journey: 'recipient',
      errorType: 'unknown',
      sourceScreen: 'claim_page',
    });

    const props = latest()[1].props as { error_code: string };
    expect(props.error_code).toBe('unknown');
  });

  it('omits claim_id when null', () => {
    mockPlausible();
    analytics.errorDisplayed({
      journey: 'recipient',
      claimId: null,
      errorType: 'unknown',
      sourceScreen: 'claim_page',
    });

    const props = latest()[1].props as { claim_id?: string };
    expect(props).not.toHaveProperty('claim_id');
  });

  it.each(Object.keys(ERROR_TYPES) as ErrorType[])(
    'accepts error_type=%s from the taxonomy',
    (errorType) => {
      mockPlausible();
      analytics.errorDisplayed({ journey: 'shared', errorType, sourceScreen: 'test' });

      const props = latest()[1].props as { error_type: ErrorType };
      expect(props.error_type).toBe(errorType);
    },
  );

  it('accepts sender journey', () => {
    mockPlausible();
    analytics.errorDisplayed({
      journey: 'sender',
      errorType: 'wallet_connection_failed',
      sourceScreen: 'send_form',
    });

    const props = latest()[1].props as { journey: string };
    expect(props.journey).toBe('sender');
  });
});

describe('analytics.retryClicked (§6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  it('emits Retry Clicked with all required fields', () => {
    mockPlausible();
    analytics.retryClicked({
      journey: 'recipient',
      claimId: 'claim-retry-001',
      errorType: 'network_unavailable',
      attemptNumber: 2,
    });

    const call = latest();
    expect(call[0]).toBe('Retry Clicked');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'claim-retry-001',
        error_type: 'network_unavailable',
        attempt_number: 2,
      }),
    );
  });

  it('omits claim_id when null', () => {
    mockPlausible();
    analytics.retryClicked({
      journey: 'recipient',
      claimId: null,
      errorType: 'unknown',
      attemptNumber: 1,
    });

    const props = latest()[1].props as { claim_id?: string };
    expect(props).not.toHaveProperty('claim_id');
  });

  it('increments attempt_number correctly across multiple retries', () => {
    mockPlausible();
    for (let i = 1; i <= 3; i++) {
      analytics.retryClicked({
        journey: 'recipient',
        claimId: 'claim-seq',
        errorType: 'network_unavailable',
        attemptNumber: i,
      });
    }
    const attempts = (
      window as unknown as { plausible: ReturnType<typeof plausibleMock> }
    ).plausible.mock.calls.map((c) => c[1].props.attempt_number);
    expect(attempts).toEqual([1, 2, 3]);
  });
});

describe('isDoNotTrackEnabled (§9.5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { doNotTrack?: unknown }).doNotTrack;
  });

  it('returns true for the canonical navigator.doNotTrack = "1"', () => {
    stubNavigatorWith({ doNotTrack: '1' });
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('returns true for a numeric navigator.doNotTrack = 1', () => {
    stubNavigatorWith({ doNotTrack: 1 });
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('tolerates surrounding whitespace on the signal value', () => {
    stubNavigatorWith({ doNotTrack: ' 1 ' });
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('returns true for the legacy IE navigator.msDoNotTrack = "1"', () => {
    stubNavigatorWith({ msDoNotTrack: '1' });
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('returns true for a window-level doNotTrack = "1" set by an extension', () => {
    stubNavigatorWith({});
    (window as unknown as { doNotTrack?: unknown }).doNotTrack = '1';
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it.each([
    ['the string "0"', '0'],
    ['the number 0', 0],
    ['the string "unspecified"', 'unspecified'],
    ['the string "yes"', 'yes'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an object', {}],
  ] as [string, unknown][])(
    'returns false for a value that is not an opt-in (%s)',
    (_label, value) => {
      stubNavigatorWith({ doNotTrack: value });
      expect(isDoNotTrackEnabled()).toBe(false);
    },
  );

  it('returns false when the navigator exposes no DNT property at all', () => {
    stubNavigatorWith({});
    expect(isDoNotTrackEnabled()).toBe(false);
  });

  it('returns false when the navigator object is missing entirely', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isDoNotTrackEnabled()).toBe(false);
  });

  it('returns false instead of throwing when the property access is hostile', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      get doNotTrack(): string {
        throw new Error('blocked by a privacy extension');
      },
    });
    expect(() => isDoNotTrackEnabled()).not.toThrow();
    expect(isDoNotTrackEnabled()).toBe(false);
  });

  it('is SSR-safe: returns false when there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => isDoNotTrackEnabled()).not.toThrow();
    expect(isDoNotTrackEnabled()).toBe(false);
  });
});

describe('track() honours Do Not Track (§9.5)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('suppresses the event entirely when the browser opts out', () => {
    stubNavigatorWith({ doNotTrack: '1' });
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimVerified({ claimId: 'dnt-001', verificationTimeMs: 12 });
    analytics.claimSubmitted({ claimId: 'dnt-001', assetType: 'XLM' });
    analytics.claimSucceeded({ claimId: 'dnt-001' });
    analytics.paymentCreated({ claimId: 'dnt-001', confirmationTimeMs: 30 });

    expect(plausible).not.toHaveBeenCalled();
  });

  it('delivers the event when the browser reports DNT: 0', () => {
    stubNavigatorWith({ doNotTrack: '0' });
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimVerified({ claimId: 'dnt-002', verificationTimeMs: 12 });

    expect(plausible).toHaveBeenCalledTimes(1);
    expect(plausible.mock.calls[0]![0]).toBe('Claim Verified');
  });

  it('delivers the event when the browser expresses no DNT preference', () => {
    stubNavigatorWith({ doNotTrack: null });
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimSubmitted({ claimId: 'dnt-003' });

    expect(plausible).toHaveBeenCalledTimes(1);
  });

  it('mints and persists no identifier for an opted-out visitor', () => {
    stubNavigatorWith({ doNotTrack: '1' });
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimVerified({ claimId: 'dnt-004', verificationTimeMs: 12 });

    expect(plausible).not.toHaveBeenCalled();
    // The gate must run before getAnonymousId()/getSessionId(), which write to
    // localStorage/sessionStorage as a side effect of being called.
    expect(localStorage.getItem('bridgelet_anonymous_id')).toBeNull();
    expect(sessionStorage.getItem('bridgelet_session_id')).toBeNull();
  });

  it('still mints identifiers when tracking is allowed', () => {
    stubNavigatorWith({ doNotTrack: '0' });
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimVerified({ claimId: 'dnt-005', verificationTimeMs: 12 });

    expect(localStorage.getItem('bridgelet_anonymous_id')).not.toBeNull();
    expect(sessionStorage.getItem('bridgelet_session_id')).not.toBeNull();
  });
});

describe('message_id payload field (§9.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const messageIds = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock.calls.map(
      (c) => c[1].props.message_id as string,
    );

  it('attaches a UUID v4 message_id to every emitted event', () => {
    mockPlausible();
    analytics.sendFormViewed();
    analytics.claimSubmitted({ claimId: 'msg-001' });

    for (const id of messageIds()) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it('mints a fresh message_id per event', () => {
    mockPlausible();
    analytics.sendFormViewed();
    analytics.sendFormViewed();

    const [first, second] = messageIds();
    expect(first).not.toBe(second);
  });

  it('does not reuse the anonymous_id or session_id as the message_id', () => {
    mockPlausible();
    analytics.claimSubmitted({ claimId: 'msg-002' });

    const props = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]![1].props as {
      message_id: string;
      anonymous_id: string;
      session_id: string;
    };
    expect(props.message_id).not.toBe(props.anonymous_id);
    expect(props.message_id).not.toBe(props.session_id);
  });
});

describe('event deduplication (§9.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const dispatched = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible;

  it('deduplicates exactly the two events the spec names', () => {
    expect(DEDUPLICATED_EVENTS).toEqual(['Payment Created', 'Claim Succeeded']);
  });

  it('suppresses a repeated Payment Created for the same claim_id', () => {
    mockPlausible();
    analytics.paymentCreated({ claimId: 'dedup-pc-1', confirmationTimeMs: 40 });
    analytics.paymentCreated({ claimId: 'dedup-pc-1', confirmationTimeMs: 40 });

    expect(dispatched()).toHaveBeenCalledTimes(1);
  });

  it('suppresses a repeated Claim Succeeded for the same claim_id', () => {
    mockPlausible();
    analytics.claimSucceeded({ claimId: 'dedup-cs-1', sweepDurationMs: 900 });
    analytics.claimSucceeded({ claimId: 'dedup-cs-1', sweepDurationMs: 900 });

    expect(dispatched()).toHaveBeenCalledTimes(1);
  });

  it('delivers both Payment Created events for distinct claim_ids', () => {
    mockPlausible();
    analytics.paymentCreated({ claimId: 'dedup-pc-a', confirmationTimeMs: 40 });
    analytics.paymentCreated({ claimId: 'dedup-pc-b', confirmationTimeMs: 40 });

    const calls = dispatched().mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c[1].props.claim_id)).toEqual(['dedup-pc-a', 'dedup-pc-b']);
  });

  it('delivers both Claim Succeeded events for distinct claim_ids', () => {
    mockPlausible();
    analytics.claimSucceeded({ claimId: 'dedup-cs-a' });
    analytics.claimSucceeded({ claimId: 'dedup-cs-b' });

    expect(dispatched()).toHaveBeenCalledTimes(2);
  });

  it('does not collapse Payment Created and Claim Succeeded for the same claim_id', () => {
    mockPlausible();
    analytics.paymentCreated({ claimId: 'dedup-both-1', confirmationTimeMs: 40 });
    analytics.claimSucceeded({ claimId: 'dedup-both-1' });

    const calls = dispatched().mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c[0])).toEqual(['Payment Created', 'Claim Succeeded']);
  });

  it('leaves events outside §9.4 un-deduplicated', () => {
    mockPlausible();
    analytics.claimSubmitted({ claimId: 'dedup-other-1' });
    analytics.claimSubmitted({ claimId: 'dedup-other-1' });
    analytics.claimFailed({
      claimId: 'dedup-other-1',
      errorType: 'network_error',
      attemptNumber: 1,
    });
    analytics.claimFailed({
      claimId: 'dedup-other-1',
      errorType: 'network_error',
      attemptNumber: 2,
    });
    analytics.paymentConfirmed({ walletType: 'Freighter' });
    analytics.paymentConfirmed({ walletType: 'Freighter' });

    expect(dispatched()).toHaveBeenCalledTimes(6);
  });

  it('never dedups a §9.4 event that carries no usable claim_id', () => {
    mockPlausible();
    analytics.claimSucceeded({ claimId: '' });
    analytics.claimSucceeded({ claimId: '' });
    analytics.paymentCreated({ claimId: '', confirmationTimeMs: 10 });
    analytics.paymentCreated({ claimId: '', confirmationTimeMs: 10 });

    expect(dispatched()).toHaveBeenCalledTimes(4);
  });

  it('stays suppressed across consecutive duplicates', () => {
    mockPlausible();
    analytics.claimSucceeded({ claimId: 'dedup-repeat-1' });
    analytics.claimSucceeded({ claimId: 'dedup-repeat-1' });
    analytics.claimSucceeded({ claimId: 'dedup-repeat-1' });

    expect(dispatched()).toHaveBeenCalledTimes(1);
  });
});

describe('createDeduplicationStore (§9.4)', () => {
  it('reports the first sighting of a key as new', () => {
    const store = createDeduplicationStore(10, 1_000);
    expect(store.isDuplicate('claim-1', 0)).toBe(false);
    expect(store.size()).toBe(1);
  });

  it('reports a repeat sighting of a key as a duplicate', () => {
    const store = createDeduplicationStore(10, 1_000);
    store.isDuplicate('claim-1', 0);
    expect(store.isDuplicate('claim-1', 500)).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('keeps a key alive for the whole TTL window and expires it afterwards', () => {
    const store = createDeduplicationStore(10, 1_000);
    store.isDuplicate('claim-1', 0);

    expect(store.isDuplicate('claim-1', 999)).toBe(true);
    expect(store.isDuplicate('claim-1', 1_000)).toBe(false);
  });

  it('never grows past maxEntries, evicting the least recently used key', () => {
    const store = createDeduplicationStore(2, 10_000);
    store.isDuplicate('a', 0);
    store.isDuplicate('b', 1);
    expect(store.size()).toBe(2);

    // Touching 'a' makes 'b' the least recently used entry.
    expect(store.isDuplicate('a', 2)).toBe(true);
    store.isDuplicate('c', 3);

    expect(store.size()).toBe(2);
    // 'b' was the least recently used, so 'b' is what got evicted.
    expect(store.isDuplicate('b', 4)).toBe(false);
    // 'c' survived the cap and is still deduplicated.
    expect(store.isDuplicate('c', 4)).toBe(true);
  });

  it('prunes expired entries as it goes, without a background timer', () => {
    const store = createDeduplicationStore(10, 1_000);
    store.isDuplicate('a', 0);
    store.isDuplicate('b', 5_000);
    expect(store.size()).toBe(1);
  });

  it('stays bounded under a flood of distinct keys', () => {
    const store = createDeduplicationStore();
    for (let i = 0; i < DEDUP_MAX_ENTRIES * 3; i++) {
      store.isDuplicate(`claim-${i}`, i);
    }
    expect(store.size()).toBe(DEDUP_MAX_ENTRIES);
  });

  it('exposes the documented bound and TTL defaults', () => {
    expect(DEDUP_MAX_ENTRIES).toBe(200);
    expect(DEDUP_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe('dispatch targets and PostHog fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    delete (window as unknown as { posthog?: unknown }).posthog;
  });

  it('falls back to posthog.capture when Plausible is not loaded', () => {
    const capture = vi.fn();
    (window as unknown as { posthog?: { capture: typeof capture } }).posthog = { capture };

    analytics.claimSucceeded({ claimId: 'claim-ph' });

    expect(capture).toHaveBeenCalledTimes(1);
    const [name, props] = capture.mock.calls[0]!;
    expect(name).toBe('Claim Succeeded');
    expect(props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'claim-ph',
        app_version: expect.any(String),
        device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
      }),
    );
  });

  it('prefers Plausible over PostHog when both are loaded', () => {
    const plausible = plausibleMock();
    const capture = vi.fn();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausible;
    (window as unknown as { posthog?: { capture: typeof capture } }).posthog = { capture };

    analytics.claimPageViewed({ claimId: 'tok_123', entryChannel: 'direct' });

    expect(plausible).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });
})
// ─── #818 expiry_days from the send form's hour-based choice ──────────────────

describe('expiryDaysFromHours', () => {
  it('converts each window the expiry step offers', () => {
    expect(expiryDaysFromHours(24)).toBe(1);
    expect(expiryDaysFromHours(72)).toBe(3);
    expect(expiryDaysFromHours(168)).toBe(7);
  });

  it('rounds a partial day to the nearest whole day', () => {
    expect(expiryDaysFromHours(36)).toBe(2);
    expect(expiryDaysFromHours(12)).toBe(1);
  });

  it('snaps an off-list window to the nearest value the spec admits', () => {
    // The send form only offers 24/72/168h, but a restored or migrated form
    // state could carry anything; the emitted value must stay in-vocabulary.
    expect(VALID_EXPIRY_WINDOWS).toContain(expiryDaysFromHours(100));
    expect(VALID_EXPIRY_WINDOWS).toContain(expiryDaysFromHours(400));
  });

  it('treats a zero or negative window as "never expires"', () => {
    expect(expiryDaysFromHours(0)).toBeNull();
    expect(expiryDaysFromHours(-24)).toBeNull();
  });

  it('treats an absent window as null rather than a guess', () => {
    expect(expiryDaysFromHours(undefined)).toBeNull();
    expect(expiryDaysFromHours(null)).toBeNull();
  });

  it('never emits a zero-day window', () => {
    expect(expiryDaysFromHours(1)).toBe(1);
  });
});

// ─── #909 wallet_provider ────────────────────────────────────────────────────

describe('WALLET_PROVIDERS', () => {
  it('is a closed set dashboards can group by without normalising', () => {
    expect(Object.values(WALLET_PROVIDERS)).toEqual([
      'freighter',
      'lobstr',
      'generated',
      'unknown',
    ]);
  });

  it('is emitted on Wallet Connection Failed', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.walletConnectionFailed({
      walletProvider: WALLET_PROVIDERS.freighter,
      errorCode: 'FREIGHTER_NOT_INSTALLED',
    });

    expect(plausible).toHaveBeenCalledTimes(1);
    expect(plausible.mock.calls[0]![0]).toBe('Wallet Connection Failed');
    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          journey: 'sender',
          wallet_provider: 'freighter',
          error_code: 'FREIGHTER_NOT_INSTALLED',
        }),
      }),
    );
  });

  it('defaults to "unknown" provider and error code when the caller knows neither', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.walletConnectionFailed({});

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({ wallet_provider: 'unknown', error_code: 'unknown' }),
      }),
    );
  });

  it('is emitted alongside the legacy wallet_type on Payment Confirmed', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.paymentConfirmed({
      walletType: 'Freighter',
      walletProvider: WALLET_PROVIDERS.freighter,
    });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({ wallet_type: 'Freighter', wallet_provider: 'freighter' }),
      }),
    );
  });
});

// ─── #773 Send Form Started ──────────────────────────────────────────────────

describe('sendFormStarted', () => {
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('records the first field the sender touched', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.sendFormStarted({ firstField: SEND_FORM_FIELDS.amount });

    expect(plausible.mock.calls[0]![0]).toBe('Send Form Started');
    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({ journey: 'sender', first_field: 'amount' }),
      }),
    );
  });

  it('exposes the spec vocabulary for first_field', () => {
    expect(Object.values(SEND_FORM_FIELDS)).toEqual([
      'amount',
      'asset',
      'recipient_name',
      'message',
      'expiration',
    ]);
  });
});

// ─── #782 Payment Success Viewed ─────────────────────────────────────────────

describe('paymentSuccessViewed', () => {
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('carries the claim id, asset and USD equivalent', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.paymentSuccessViewed({ claimId: 'claim_1', assetType: 'XLM', amountUsdEquiv: 12.5 });

    expect(plausible.mock.calls[0]![0]).toBe('Payment Success Viewed');
    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          journey: 'sender',
          claim_id: 'claim_1',
          asset_type: 'XLM',
          amount_usd_equiv: 12.5,
        }),
      }),
    );
  });

  it('omits amount_usd_equiv rather than reporting zero when the rate is unknown', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.paymentSuccessViewed({ claimId: 'claim_1', assetType: 'XLM' });

    const props = (plausible.mock.calls[0]![1] as { props: Record<string, unknown> }).props;
    expect('amount_usd_equiv' in props).toBe(false);
  });
});

// ─── #816 / #817 conditional properties on sender events ─────────────────────

describe('sender events carry their conditional properties', () => {
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  function propsOf(call: any[]): Record<string, unknown> {
    return call[1].props;
  }

  it('sends asset_type, expiry_days and amount_usd_equiv on Payment Created', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.paymentCreated({
      claimId: 'claim_1',
      assetType: 'USDC',
      expiryDays: expiryDaysFromHours(72),
      amountUsdEquiv: 49.99,
      confirmationTimeMs: 1234,
    });

    expect(propsOf(plausible.mock.calls[0]!)).toEqual(
      expect.objectContaining({
        asset_type: 'USDC',
        expiry_days: 3,
        amount_usd_equiv: 49.99,
        confirmation_time_ms: 1234,
      }),
    );
  });

  it('sends amount_usd_equiv on Send Form Completed and Payment Confirmation Viewed', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.sendFormCompleted({
      assetType: 'XLM',
      expiryDays: 1,
      amountUsdEquiv: 3.2,
      hasRecipientName: true,
      hasMessage: false,
    });
    analytics.paymentConfirmationViewed({ assetType: 'XLM', expiryDays: 1, amountUsdEquiv: 3.2 });

    expect(propsOf(plausible.mock.calls[0]!)).toEqual(
      expect.objectContaining({ amount_usd_equiv: 3.2 }),
    );
    expect(propsOf(plausible.mock.calls[1]!)).toEqual(
      expect.objectContaining({ amount_usd_equiv: 3.2 }),
    );
  });
});

// ─── #825-#828 sender error taxonomy ─────────────────────────────────────────

describe('senderErrorType', () => {
  it('maps account-creation network failures to network_unavailable', () => {
    expect(senderErrorType('NETWORK_FAILURE')).toBe('network_unavailable');
    expect(senderErrorType('SERVER_ERROR')).toBe('network_unavailable');
    expect(senderErrorType('RATE_LIMITED')).toBe('network_unavailable');
  });

  it('maps rejected Stellar submissions to transaction_failed', () => {
    expect(senderErrorType('STELLAR_CREATION_FAILURE')).toBe('transaction_failed');
    expect(senderErrorType('INSUFFICIENT_FUNDS')).toBe('transaction_failed');
    expect(senderErrorType('INSUFFICIENT_BALANCE')).toBe('transaction_failed');
    expect(senderErrorType('MISSING_TRUSTLINE')).toBe('transaction_failed');
    expect(senderErrorType('SUBMIT_FAILED')).toBe('transaction_failed');
  });

  it('maps a wallet that refused to wallet_connection_failed', () => {
    expect(senderErrorType('USER_REJECTED')).toBe('wallet_connection_failed');
    expect(senderErrorType('SIGNER_MISMATCH')).toBe('wallet_connection_failed');
    expect(senderErrorType('UNAUTHORIZED')).toBe('wallet_connection_failed');
  });

  it('falls back to unknown for codes outside the taxonomy', () => {
    expect(senderErrorType('SOMETHING_NEW')).toBe('unknown');
    expect(senderErrorType(undefined)).toBe('unknown');
    expect(senderErrorType('')).toBe('unknown');
  });

  it('only ever produces §6 taxonomy values', () => {
    const codes = [
      'NETWORK_FAILURE',
      'SERVER_ERROR',
      'RATE_LIMITED',
      'STELLAR_CREATION_FAILURE',
      'INSUFFICIENT_FUNDS',
      'UNAUTHORIZED',
      'INVALID_REQUEST',
      'UNKNOWN_ERROR',
      'UNSUPPORTED_ASSET',
      'MISSING_TRUSTLINE',
      'INSUFFICIENT_BALANCE',
      'SUBMIT_FAILED',
      'USER_REJECTED',
      'SIGNER_MISMATCH',
      'SIGNING_FAILED',
    ];
    for (const code of codes) {
      expect(Object.values(ERROR_TYPES)).toContain(senderErrorType(code));
    }
  });
});

// ─── #886 platform constant ───────────────────────────────────────────────────


describe('detectNetwork (§3.1 network)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps the configured Stellar network to testnet | mainnet', () => {
    expect(detectNetwork('stellar-testnet')).toBe('testnet');
    expect(detectNetwork('stellar-mainnet')).toBe('mainnet');
    expect(detectNetwork(' STELLAR-MAINNET ')).toBe('mainnet');
  });

  it('reads NEXT_PUBLIC_CRYPTO_NETWORK by default', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-mainnet');
    expect(detectNetwork()).toBe('mainnet');
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-testnet');
    expect(detectNetwork()).toBe('testnet');
  });

  it('falls back to testnet when unset or unrecognised so test traffic is never counted as production', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', '');
    expect(detectNetwork()).toBe('testnet');
    expect(detectNetwork('stellar-futurenet')).toBe('testnet');
    expect(detectNetwork('mainnet-typo')).toBe('testnet');
  });
});

describe('base payload network & user_agent (§3.1)', () => {
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('buildBasePayload carries the raw user agent and the configured network', () => {
    vi.stubGlobal('navigator', { userAgent: UA });
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-mainnet');

    const payload = buildBasePayload();
    expect(payload.user_agent).toBe(UA);
    expect(payload.network).toBe('mainnet');
  });

  it('attaches user_agent and network to every dispatched event', () => {
    vi.stubGlobal('navigator', { userAgent: UA });
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-testnet');
    const plausible = plausibleMock();
    (window as unknown as { plausible?: typeof plausible }).plausible = plausible;

    analytics.sendFormViewed();
    analytics.pageViewed({ page: '/' });
    analytics.claimPageOpened({ claimId: 'tok_net', entryChannel: 'direct' });

    expect(plausible).toHaveBeenCalledTimes(3);
    for (const call of plausible.mock.calls) {
      expect(call[1].props).toEqual(
        expect.objectContaining({ user_agent: UA, network: 'testnet' }),
      );
    }
  });
});

describe('normalizeAssetType (§3.2 asset_type)', () => {
  it('maps backend identifiers and bare codes to a canonical code', () => {
    expect(normalizeAssetType('native')).toBe('XLM');
    expect(normalizeAssetType('XLM')).toBe('XLM');
    expect(normalizeAssetType('xlm')).toBe('XLM');
    expect(normalizeAssetType('USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')).toBe(
      'USDC',
    );
    expect(normalizeAssetType(' usdc ')).toBe('USDC');
  });

  it('returns undefined when there is no asset to report', () => {
    expect(normalizeAssetType(undefined)).toBeUndefined();
    expect(normalizeAssetType(null)).toBeUndefined();
    expect(normalizeAssetType('')).toBeUndefined();
    expect(normalizeAssetType(':GABC')).toBeUndefined();
  });
});

describe('toAmountUsdEquiv (§3.2 amount_usd_equiv)', () => {
  it('converts USDC 1:1 without needing a rate', () => {
    expect(toAmountUsdEquiv(25, 'USDC')).toBe(25);
    expect(toAmountUsdEquiv('10.5', 'USDC:GABC')).toBe(10.5);
  });

  it('converts XLM at the supplied rate, rounded to cents', () => {
    expect(toAmountUsdEquiv(100, 'XLM', 0.1234)).toBe(12.34);
    expect(toAmountUsdEquiv('3', 'native', 0.115)).toBe(0.35);
    expect(toAmountUsdEquiv(0, 'XLM', 0.1)).toBe(0);
  });

  it('is unavailable without a usable rate, amount or known asset', () => {
    expect(toAmountUsdEquiv(100, 'XLM')).toBeUndefined();
    expect(toAmountUsdEquiv(100, 'XLM', 0)).toBeUndefined();
    expect(toAmountUsdEquiv(100, 'EURC', 1.1)).toBeUndefined();
    expect(toAmountUsdEquiv(undefined, 'USDC')).toBeUndefined();
    expect(toAmountUsdEquiv('', 'USDC')).toBeUndefined();
    expect(toAmountUsdEquiv('abc', 'USDC')).toBeUndefined();
    expect(toAmountUsdEquiv(-5, 'USDC')).toBeUndefined();
    expect(toAmountUsdEquiv(5, undefined, 0.1)).toBeUndefined();
  });
});

describe('asset_type & amount_usd_equiv on emitted events (§3.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  function installPlausible() {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: typeof plausible }).plausible = plausible;
    return plausible;
  }

  it('normalises asset_type and attaches amount_usd_equiv when supplied', () => {
    const plausible = installPlausible();

    analytics.paymentCreated({
      claimId: 'acct_usd_1',
      assetType: 'usdc',
      amountUsdEquiv: 25,
      confirmationTimeMs: 10,
    });
    analytics.claimVerified({
      claimId: 'tok_usd',
      assetType: 'native',
      amountUsdEquiv: 1.23,
      verificationTimeMs: 5,
    });

    expect(plausible.mock.calls[0]![1].props).toEqual(
      expect.objectContaining({ asset_type: 'USDC', amount_usd_equiv: 25 }),
    );
    expect(plausible.mock.calls[1]![1].props).toEqual(
      expect.objectContaining({ asset_type: 'XLM', amount_usd_equiv: 1.23 }),
    );
  });

  it('omits both properties when they are unavailable', () => {
    const plausible = installPlausible();

    analytics.paymentConfirmed({ walletType: 'Freighter' });
    analytics.claimSubmitted({ claimId: 'tok_none', assetType: '', amountUsdEquiv: undefined });

    for (const call of plausible.mock.calls) {
      expect('asset_type' in call[1].props).toBe(false);
      expect('amount_usd_equiv' in call[1].props).toBe(false);
    }
  });

  it('carries asset props on every asset-bearing event helper', () => {
    const plausible = installPlausible();
    const asset = { assetType: 'USDC', amountUsdEquiv: 7 };

    analytics.sendFormCompleted({ ...asset, hasRecipientName: false, hasMessage: false });
    analytics.paymentConfirmationViewed(asset);
    analytics.paymentConfirmed(asset);
    analytics.paymentCreated({ ...asset, claimId: 'acct_all', confirmationTimeMs: 1 });
    analytics.claimVerified({ ...asset, claimId: 'tok_all', verificationTimeMs: 1 });
    analytics.claimCtaClicked({ ...asset, claimId: 'tok_all' });
    analytics.claimConfirmationViewed({ ...asset, claimId: 'tok_all' });
    analytics.claimSubmitted({ ...asset, claimId: 'tok_all' });
    analytics.claimSucceeded({ ...asset, claimId: 'tok_all_succeeded' });
    analytics.claimFailed({ ...asset, claimId: 'tok_all', errorType: 'unknown', attemptNumber: 1 });
    analytics.claimSuccessViewed({ ...asset, claimId: 'tok_all' });

    expect(plausible).toHaveBeenCalledTimes(11);
    for (const call of plausible.mock.calls) {
      expect(call[1].props).toEqual(
        expect.objectContaining({ asset_type: 'USDC', amount_usd_equiv: 7 }),
      );
    }
  });
});
describe('PLATFORM constant', () => {
  it('exposes "web" as the only web platform value', () => {
    expect(PLATFORM).toBe('web');
    expect(Object.values(PLATFORMS)).toEqual(['web']);
  });

  it('is the value buildBasePayload emits', () => {
    expect(buildBasePayload().platform).toBe(PLATFORM);
  });
});

// ─── #807 journey dimension ───────────────────────────────────────────────────

describe('journey dimension', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    clearPendingEvents();
  });

  it('defaults to "shared" when no journey is supplied', () => {
    expect(buildBasePayload().journey).toBe(JOURNEYS.shared);
  });

  it('accepts each spec journey value', () => {
    for (const journey of Object.values(JOURNEYS)) {
      expect(buildBasePayload(journey).journey).toBe(journey);
    }
  });

  it('normalizes unknown or malformed values to "shared"', () => {
    expect(normalizeJourney(undefined)).toBe('shared');
    expect(normalizeJourney('Sender')).toBe('shared');
    expect(normalizeJourney(null)).toBe('shared');
    expect(normalizeJourney('recipient')).toBe('recipient');
  });

  it('is populated on every event even when the emitter omits it', () => {
    const plausible = plausibleMock();
    window.plausible = plausible;

    analytics.sendFormViewed();

    expect(plausible).toHaveBeenCalledTimes(1);
    expect(plausible.mock.calls[0]![1]).toEqual(expect.objectContaining({ journey: 'sender' }));
  });
});

// ─── #808 timestamp dimension ─────────────────────────────────────────────────

describe('timestamp dimension', () => {
  it('emits an ISO 8601 send time', () => {
    const payload = buildBasePayload();
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(payload.timestamp as string))).toBe(false);
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

// ─── #810 / #881 network dimension ────────────────────────────────────────────

describe('network dimension', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps stellar-mainnet to mainnet', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-mainnet');
    expect(currentNetwork()).toBe(ANALYTICS_NETWORKS.mainnet);
  });

  it('maps stellar-testnet to testnet', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-testnet');
    expect(currentNetwork()).toBe(ANALYTICS_NETWORKS.testnet);
  });

  it('reports "unknown" rather than silently claiming testnet when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', '');
    expect(currentNetwork()).toBe(ANALYTICS_NETWORKS.unknown);
  });

  it('reports "unknown" for an unrecognised value', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-future-net');
    expect(currentNetwork()).toBe(ANALYTICS_NETWORKS.unknown);
  });

  it('is present on the base payload', () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_NETWORK', 'stellar-mainnet');
    expect(buildBasePayload().network).toBe('mainnet');
  });
});

// ─── #809 / #812 / #813 / #814 §3.1 fields on dispatched events ───────────────

describe('§3.1 base payload reaches the provider (#809, #812, #813, #814)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    clearPendingEvents();
    // Drop the own-property referrer stub installed below, so the prototype
    // getter is visible again for every subsequent test.
    Reflect.deleteProperty(document, 'referrer');
  });

  /** Fires one event and returns the props that reached the provider. */
  function emittedProps(): Record<string, unknown> {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.sendFormViewed();

    expect(plausible).toHaveBeenCalledTimes(1);
    return (plausible.mock.calls[0]![1] as { props: Record<string, unknown> }).props;
  }

  it('#809 carries platform "web" on a dispatched event', () => {
    expect(emittedProps().platform).toBe('web');
  });

  it('#814 carries the build-time app_version on a dispatched event', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.4.2');
    expect(emittedProps().app_version).toBe('1.4.2');
  });

  it('#814 reports "unknown" rather than an empty app_version when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '');
    expect(emittedProps().app_version).toBe('unknown');
  });

  it('#812 carries a device_type from the §3.1 closed set', () => {
    expect(emittedProps().device_type).toMatch(/^(mobile|tablet|desktop)$/);
  });

  it('#813 carries referrer as null when the document has no referrer', () => {
    const props = emittedProps();
    expect('referrer' in props).toBe(true);
    expect(props.referrer).toBeNull();
  });

  it('#813 carries the referring URL when one exists', () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'https://news.example.com/story',
    });

    expect(emittedProps().referrer).toBe('https://news.example.com/story');
  });

  it('keeps all four fields on events replayed from the pre-provider queue', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.4.2');
    analytics.pageViewed({ page: '/' });

    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;
    analytics.sendFormViewed();

    const replayed = (plausible.mock.calls[0]![1] as { props: Record<string, unknown> }).props;
    expect(replayed.platform).toBe('web');
    expect(replayed.app_version).toBe('1.4.2');
    expect(replayed.device_type).toMatch(/^(mobile|tablet|desktop)$/);
    expect(replayed.referrer).toBeNull();
  });
});

// ─── #882 consent gate ────────────────────────────────────────────────────────

describe('explicit analytics opt-out', () => {
  afterEach(() => {
    setAnalyticsOptedOut(false);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    clearPendingEvents();
  });

  it('defaults to allowing tracking when no decision is recorded', () => {
    expect(isAnalyticsOptedOut()).toBe(false);
  });

  it('persists the opt-out and clears it again', () => {
    setAnalyticsOptedOut(true);
    expect(isAnalyticsOptedOut()).toBe(true);
    setAnalyticsOptedOut(false);
    expect(isAnalyticsOptedOut()).toBe(false);
  });

  it('suppresses every event once opted out', () => {
    const plausible = plausibleMock();
    window.plausible = plausible;
    setAnalyticsOptedOut(true);

    analytics.claimPageViewed({ claimId: 'tok_optout', entryChannel: 'direct' });

    expect(plausible).not.toHaveBeenCalled();
    expect(pendingEventCount()).toBe(0);
  });

  it('does not mint an anonymous_id for a visitor who opted out', () => {
    window.plausible = plausibleMock();
    setAnalyticsOptedOut(true);
    localStorage.removeItem('bridgelet_anonymous_id');

    analytics.sendFormViewed();

    expect(localStorage.getItem('bridgelet_anonymous_id')).toBeNull();
  });
});

// ─── #851 pre-provider queue ──────────────────────────────────────────────────

describe('queueing events until a provider appears', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    delete (window as unknown as { posthog?: unknown }).posthog;
    clearPendingEvents();
  });

  it('buffers a page-load event when the provider has not loaded yet', () => {
    analytics.pageViewed({ page: '/' });

    expect(pendingEventCount()).toBe(1);
  });

  it('replays buffered events once Plausible appears, in order', () => {
    analytics.pageViewed({ page: '/' });
    analytics.sendFormViewed();

    const plausible = plausibleMock();
    window.plausible = plausible;
    analytics.paymentConfirmationViewed({});

    expect(plausible.mock.calls.map((call) => call[0])).toEqual([
      'Page Viewed',
      'Send Form Viewed',
      'Payment Confirmation Viewed',
    ]);
    expect(pendingEventCount()).toBe(0);
  });

  it('preserves the original payload of a buffered event', () => {
    analytics.claimPageOpened({ claimId: 'tok_queue', entryChannel: 'direct' });

    const plausible = plausibleMock();
    window.plausible = plausible;
    analytics.sendFormViewed();

    const replayed = plausible.mock.calls[0]![1] as { props: Record<string, unknown> };
    expect(replayed.props.claim_id).toBe('tok_queue');
    expect(replayed.props.journey).toBe('recipient');
  });

  it('bounds the queue, dropping the oldest events first', () => {
    for (let i = 0; i < PENDING_QUEUE_MAX_EVENTS + 5; i += 1) {
      analytics.paymentDetailsViewed({ claimId: 'claim_' + i, claimStatus: 'unclaimed' });
    }

    expect(pendingEventCount()).toBe(PENDING_QUEUE_MAX_EVENTS);

    const plausible = plausibleMock();
    window.plausible = plausible;
    analytics.sendFormViewed();

    const replayed = plausible.mock.calls.slice(0, PENDING_QUEUE_MAX_EVENTS);
    expect(replayed[0]![1]).toEqual(expect.objectContaining({ claim_id: 'claim_5' }));
  });

  it('sends straight through once a provider is available', () => {
    const plausible = plausibleMock();
    window.plausible = plausible;

    analytics.sendFormViewed();

    expect(pendingEventCount()).toBe(0);
    expect(plausible).toHaveBeenCalledTimes(1);
  });

  it('discards the queue when PostHog takes over instead', () => {
    analytics.sendFormViewed();
    const capture = vi.fn();
    window.posthog = { capture };

    analytics.sendFormViewed();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(pendingEventCount()).toBe(0);
  });
});

// ─── #853 payload verification ────────────────────────────────────────────────

describe('payload verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
    clearPendingEvents();
    vi.restoreAllMocks();
  });

  it('accepts a payload built by the module', () => {
    expect(validatePayload(buildBasePayload('sender'))).toEqual([]);
  });

  it('reports every missing base-payload field', () => {
    expect(validatePayload({})).toEqual(
      expect.arrayContaining([
        'missing §3.1 field "journey"',
        'missing §3.1 field "timestamp"',
        'missing §3.1 field "network"',
      ]),
    );
  });

  it('rejects a non-ISO timestamp', () => {
    const payload = buildBasePayload('sender');
    payload.timestamp = 'yesterday';
    expect(validatePayload(payload)).toEqual(
      expect.arrayContaining(['field "timestamp" is not an ISO 8601 date string']),
    );
  });

  it('rejects a journey outside the spec vocabulary', () => {
    const payload = buildBasePayload('sender');
    payload.journey = 'Sender';
    expect(validatePayload(payload)).toEqual(
      expect.arrayContaining(['field "journey" is not one of sender | recipient | shared']),
    );
  });

  it('accepts a null referrer, which the spec documents as its own value', () => {
    const payload = buildBasePayload('sender');
    payload.referrer = null;
    expect(validatePayload(payload)).toEqual([]);
  });

  it('reports a wrongly-typed field', () => {
    const payload = buildBasePayload('sender');
    payload.device_type = 42;
    expect(validatePayload(payload)).toEqual(
      expect.arrayContaining(['field "device_type" should be string, got number']),
    );
  });

  it('is off unless NEXT_PUBLIC_ANALYTICS_VERIFY is enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_VERIFY', 'false');
    expect(isVerificationEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_VERIFY', 'true');
    expect(isVerificationEnabled()).toBe(true);
  });

  it('warns on the console about a malformed payload when enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_VERIFY', 'true');
    window.plausible = plausibleMock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    analytics.sendFormViewed();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('docs/analytics-spec.md'),
      expect.any(Array),
    );
  });

  it('stays silent about a well-formed payload', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_VERIFY', 'true');
    window.plausible = plausibleMock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    analytics.sendFormViewed();

    expect(warn).not.toHaveBeenCalled();
  });
});

// ── Claim Link Shared (#784) ─────────────────────────────────────────────────
//
// Issue #784 asked for a `track('Claim Link Shared', …)` call at the point the
// sender actively shares the claim link. The emitter and its WhatsApp call site
// were already delivered by PR #751 (see
// `bridgelet-product-audit/postmortems/issue-784-claim-link-shared-already-implemented.md`).
// This block locks in the §4.4 payload so it cannot silently regress.
describe('analytics.claimLinkShared (§4.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it.each(['sms', 'email', 'whatsapp', 'qr_code'] as const)(
    'emits Claim Link Shared with share_method "%s"',
    (shareMethod) => {
      (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
        plausibleMock();

      analytics.claimLinkShared({ claimId: 'acct_123', shareMethod });

      const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> })
        .plausible.mock.calls[0]!;
      expect(call[0]).toBe('Claim Link Shared');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          claim_id: 'acct_123',
          share_method: shareMethod,
        }),
      );
    },
  );
});


describe('CLAIM_ENTRY_CHANNELS', () => {
  it('keeps qr_scan and deep_link as distinct channels', () => {
    expect(CLAIM_ENTRY_CHANNELS).toEqual([
      'sms',
      'email',
      'whatsapp',
      'qr_scan',
      'deep_link',
      'direct',
      'unknown',
    ]);
  });
});

describe('isReturningClaimVisitor', () => {
  afterEach(() => {
    localStorage.removeItem('bridgelet_claim_opens');
  });

  it('reports a first visit when no claim link has been opened before', () => {
    expect(isReturningClaimVisitor()).toBe(false);
  });

  it('reports a returning visit on the second open', () => {
    isReturningClaimVisitor();
    expect(isReturningClaimVisitor()).toBe(true);
  });

  it('never writes a claim token to storage', () => {
    isReturningClaimVisitor();
    const stored = JSON.stringify(localStorage);
    expect(stored).not.toContain('tok_');
    expect(stored).not.toContain('GABC');
  });

  it('survives corrupt stored state', () => {
    localStorage.setItem('bridgelet_claim_opens', 'not-a-number');
    expect(isReturningClaimVisitor()).toBe(false);
  });

  it('is attached to Claim Page Opened', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimPageOpened({ claimId: 'tok_1', entryChannel: 'qr_scan' });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({ entry_channel: 'qr_scan', is_returning_visit: false }),
      }),
    );
  });

  it('accepts an explicit value for testability', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.claimPageOpened({
      claimId: 'tok_1',
      entryChannel: 'direct',
      isReturningVisit: true,
    });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ is_returning_visit: true }) }),
    );
  });
});

describe('wallet address events', () => {
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('reports the address screen with has_previous_address', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.walletAddressScreenViewed({ claimId: 'claim_1', hasPreviousAddress: false });

    expect(plausible.mock.calls[0]![0]).toBe('Wallet Address Screen Viewed');
    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          journey: 'recipient',
          claim_id: 'claim_1',
          has_previous_address: false,
        }),
      }),
    );
  });

  it('defaults has_previous_address to false when the caller does not know', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.walletAddressScreenViewed({ claimId: 'claim_1' });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ has_previous_address: false }) }),
    );
  });

  it('reports an entered address without ever including the address itself', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.walletAddressEntered({ claimId: 'claim_1', usedPreviousAddress: false });

    expect(plausible.mock.calls[0]![0]).toBe('Wallet Address Entered');
    const props = (plausible.mock.calls[0]![1] as { props: Record<string, unknown> }).props;
    expect(props).toEqual(
      expect.objectContaining({
        claim_id: 'claim_1',
        used_previous_address: false,
      }),
    );
    expect(JSON.stringify(props)).not.toMatch(/G[A-Z2-7]{55}/);
  });
});

describe('explorerTxUrl', () => {
  it('builds a mainnet transaction URL', () => {
    const hash = 'a'.repeat(64);
    expect(explorerTxUrl('mainnet', hash)).toBe(
      `https://stellar.expert/explorer/public/tx/${hash}`,
    );
  });

  it('builds a testnet transaction URL', () => {
    const hash = 'b'.repeat(64);
    expect(explorerTxUrl('testnet', hash)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${hash}`,
    );
  });

  it('refuses anything that is not a transaction hash', () => {
    expect(explorerTxUrl('testnet', 'tok_abc123')).toBeNull();
    expect(explorerTxUrl('testnet', 'G' + 'A'.repeat(55))).toBeNull();
    expect(explorerTxUrl('testnet', '')).toBeNull();
    expect(explorerTxUrl('testnet', null)).toBeNull();
    expect(explorerTxUrl('testnet', undefined)).toBeNull();
  });

  it('normalises case and surrounding whitespace', () => {
    const hash = 'F'.repeat(64);
    expect(explorerTxUrl('testnet', `  ${hash}  `)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${hash.toLowerCase()}`,
    );
  });

  it('names the explorer per network for the analytics property', () => {
    expect(explorerName('mainnet')).toBe('stellar_expert');
    expect(explorerName('testnet')).toBe('stellar_expert_testnet');
  });

  it('adds explorer and omits tx_hash when no hash is known', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.explorerLinkClicked({
      journey: 'recipient',
      claimId: 'claim_1',
      sourceScreen: 'claim_success',
    });

    const props = (plausible.mock.calls[0]![1] as { props: Record<string, unknown> }).props;
    expect(props.explorer).toBe('stellar_expert');
    expect('tx_hash' in props).toBe(false);
  });

  it('carries tx_hash when the emitter knows it', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;
    const hash = 'c'.repeat(64);

    analytics.explorerLinkClicked({
      journey: 'recipient',
      claimId: 'claim_1',
      sourceScreen: 'claim_success',
      txHash: hash,
    });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ tx_hash: hash }) }),
    );
  });
});

describe('retryClicked carries the originating error', () => {
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('reports error_type and error_code of the error being retried', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.retryClicked({
      journey: 'recipient',
      claimId: 'claim_1',
      errorType: 'network_unavailable',
      errorCode: 'SUBMISSION_FAILED_RETRYABLE',
      attemptNumber: 2,
    });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          error_type: 'network_unavailable',
          error_code: 'SUBMISSION_FAILED_RETRYABLE',
          attempt_number: 2,
        }),
      }),
    );
  });

  it('defaults error_code to unknown rather than omitting it', () => {
    const plausible = plausibleMock();
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible = plausible;

    analytics.retryClicked({ journey: 'recipient', errorType: 'unknown', attemptNumber: 1 });

    expect(plausible.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ error_code: 'unknown' }) }),
    );
  });
});


describe('sender dashboard events (§4.5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  const mockPlausible = () =>
    ((window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock());

  const latest = () =>
    (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible.mock
      .calls[0]!;

  describe('analytics.dashboardViewed (§4.5)', () => {
    it('emits Dashboard Viewed with required fields and default active_filter="all"', () => {
      mockPlausible();
      analytics.dashboardViewed({ totalPayments: 5 });

      const call = latest();
      expect(call[0]).toBe('Dashboard Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          total_payments: 5,
          active_filter: 'all',
        }),
      );
    });

    it('emits Dashboard Viewed with total_payments: 0 for empty state', () => {
      mockPlausible();
      analytics.dashboardViewed({ totalPayments: 0 });

      const call = latest();
      expect(call[0]).toBe('Dashboard Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          total_payments: 0,
          active_filter: 'all',
        }),
      );
    });

    it.each(DASHBOARD_FILTERS)(
      'emits Dashboard Viewed with explicit active_filter="%s"',
      (filter) => {
        mockPlausible();
        analytics.dashboardViewed({ totalPayments: 3, activeFilter: filter });

        const call = latest();
        expect(call[0]).toBe('Dashboard Viewed');
        expect(call[1].props).toEqual(
          expect.objectContaining({
            journey: 'sender',
            total_payments: 3,
            active_filter: filter,
          }),
        );
      },
    );

    it('allows direct track() call for Dashboard Viewed', () => {
      mockPlausible();
      track('Dashboard Viewed', {
        journey: 'sender',
        total_payments: 10,
        active_filter: 'unclaimed',
      });

      const call = latest();
      expect(call[0]).toBe('Dashboard Viewed');
      expect(call[1].props).toEqual(
        expect.objectContaining({
          journey: 'sender',
          total_payments: 10,
          active_filter: 'unclaimed',
        }),
      );
    });
  });

  describe('analytics.dashboardFilterApplied (§4.5)', () => {
    it.each(DASHBOARD_FILTERS)(
      'emits Dashboard Filter Applied with filter="%s"',
      (filter) => {
        mockPlausible();
        analytics.dashboardFilterApplied({ filter });

        const call = latest();
        expect(call[0]).toBe('Dashboard Filter Applied');
        expect(call[1].props).toEqual(
          expect.objectContaining({
            journey: 'sender',
            filter,
          }),
        );
      },
    );
  });

  describe('DASHBOARD_FILTERS (§4.5)', () => {
    it('defines exactly the four closed-set filter values from §4.5', () => {
      expect(DASHBOARD_FILTERS).toEqual(['all', 'unclaimed', 'claimed', 'expired']);
    });
  });
});