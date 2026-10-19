# Bridgelet Analytics & Product Event Tracking Specification

**Version:** 1.0.0
**Status:** Draft
**Created:** March 2026
**Based On:** `bridgelet-frd-ui-ux.md`, `ROADMAP.md`, `FRONTEND_TECHNICAL_SPEC.md`

> **Implementation status:** Implementation compliance has **not** been verified. Treat this document as the intended design for Bridgelet's analytics instrumentation, not as a source of truth. See `bridgelet-product-audit/postmortems/analytics-spec-vs-implementation-unverified.md`.

---

## Spec Changelog

| Spec Version | Date | Changes | Compatible App Versions |
|--------------|------|---------|-------------------------|
| `1.0.0` | 2026-03-15 | Initial baseline analytics specification defining sender and recipient journey events, funnels, KPIs, and base payload. Added `analytics_spec_version` tracking field. | `0.1.0+` |
| `1.0.1` | 2026-10-18 | Document explicit drop-off measurement methodology in §7.1 and note absence of explicit abandonment events (#702). | `0.1.0+` |
| `1.0.2` | 2026-10-18 | Added `"qr_scan"` entry channel to `Claim Page Opened` and Recipient Entry Channel Distribution for mobile QR scan entry (#704). | `0.1.0+` |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Event Naming Conventions](#2-event-naming-conventions)
3. [Standard Payload Structure](#3-standard-payload-structure)
4. [Sender Journey Events](#4-sender-journey-events)
5. [Recipient Journey Events](#5-recipient-journey-events)
6. [Error & Edge Case Events](#6-error--edge-case-events)
7. [Conversion Funnel Definitions](#7-conversion-funnel-definitions)
8. [Business Metrics & KPI Definitions](#8-business-metrics--kpi-definitions)
9. [Implementation Notes](#9-implementation-notes)
10. [Mobile App Extension](#10-mobile-app-extension)

---

Per-event readiness — which of these events actually fire from production code
— is tracked in `docs/analytics-kpi-definitions.md`. A dashboard built from
this document alone will contain zeros.

> **Spec versioning.** This document is versioned (`**Version:**` above) and
> the version is reported as the §3.1 base-payload field
> `analytics_spec_version`. Every behaviour change — event added, renamed,
> removed, or payload altered — bumps the version and adds a row to the table
> below. Without this, a payload collected under an earlier revision is
> indistinguishable from one collected after a rename, and a historical series
> cannot be reinterpreted correctly.

| Spec version | Change |
| --- | --- |
| 1.0 | Initial document |

## 1. Overview

This document defines the analytics and product event tracking specification for Bridgelet — a crypto onboarding solution that allows senders to create claimable crypto links for recipients who do not yet have wallets.

The purpose of this spec is to:
- Define every trackable user interaction across both sender and recipient journeys
- Establish a consistent naming and payload convention
- Provide funnel definitions for measuring conversion
- Define business KPIs and how they are derived

> **Scope:** This document defines *what* to track and *how to structure it*. It does not implement any tracking code.

### Two Core User Journeys

| Journey | Actor | Goal |
|---------|-------|------|
| **Sender Journey** | Alice (crypto-literate) | Create a claimable payment link |
| **Recipient Journey** | Bob (crypto-novice) | Claim crypto sent to them |

### Out of Scope: Integrator Usage

This spec covers end-user journeys only. Actions taken by integrators through the bridgelet-sdk REST API, such as creating, listing, updating or deleting a webhook subscription (`POST`, `GET`, `PUT` and `DELETE` on `/webhooks`), have no events here. This is a deliberate omission, not an oversight.

Reasons:
- Every event in this spec is a product event raised in a browser session. The base payload in section 3.1 assumes browser context (`anonymous_id` in `localStorage`, `user_agent`, `device_type`, `referrer`), and section 9.5 relies on the browser Do Not Track header. An integrator calling the API from a backend has none of that.
- The webhook endpoints are authenticated, rate-limited, server-to-server calls. Their usage is already observable from backend request logs.

If integrator usage analytics later become a product goal, extend this spec rather than reusing the end-user events:
- Add an `integrator` value to the `journey` table in section 2.3 and a third row to the journey table above.
- Define the events as server-side only, named under the section 2.1 rules, with a server-side base payload that drops the browser fields.
- Keep secrets out of payloads. A webhook's signing `secret` must never be recorded, and the target `url` should be left out or reduced to its host.

### Out of Scope: Mobile Push Notifications & Badge Interactions

The mobile application prototype includes mock notifications and tab badge rendering (`mobile/app/src/hooks/useNotificationBadge.ts`, `mobile/app/src/store/notificationStore.ts`, `mobile/app/(tabs)/notifications.tsx`). In the current v1.0.0 specification:
- Mobile push notifications, in-app notification badge counts, and notification list interactions are not instrumented and are excluded from the baseline Sender and Recipient funnels.
- If push notifications and alert feeds are developed to re-engage senders (e.g., payment claimed or expired alerts) or recipients (claim reminders), a dedicated event category (`Notification Received`, `Notification Opened`, `Notification Cleared`) should be introduced in a future specification revision along with attribution parameters (`notification_id`, `notification_type`, `action_taken`) and funnel attribution hooks (§7).

### Mobile Feature Note: QR Code Scanning & Recipient Entry Channel

The mobile client architecture tracks recipient claims and deep linking. While `ShareSheet.tsx` supports rendering a QR code on sender devices for offline/in-person transfer, dedicated in-app camera QR scanning (`QRCodeScanner.tsx`) represents a distinct physical onboarding path:
- Once mobile QR scanning is integrated into the recipient flow, it maps to the recipient entry funnel via `Claim Page Opened` (with `entry_channel: "qr_scan"`) or a dedicated `QR Code Scanned` event.
- This will directly feed the *Recipient Entry Channel Distribution* KPI (§8.2) alongside existing digital channels (`sms`, `email`, `whatsapp`, `direct`). See `bridgelet-product-audit/postmortems/issue-704-qr-code-scanner-analytics-evaluation.md` for full evaluation.

### Out of Scope: Translation & Real-Time Language Detection (Mobile)

The mobile client contains translation caching and real-time input language detection features (`mobile/app/src/features/translate/languageDetection.ts`, `useLanguageDetection.ts`, `LanguageInput.tsx`). In the current v1.0.0 specification:
- Language detection and manual language overrides are uninstrumented and excluded from the core transaction funnels (Sender and Recipient funnels).
- If translation and real-time language detection become a core UX investment in future releases, a dedicated event category (e.g., `Language Detected`, `Language Overridden`) should be introduced in a future specification revision along with relevant payload properties (`detected_language`, `confidence`, `override_language`, `detection_source`) and privacy review (ensuring raw input text is never logged).

---

## 2. Event Naming Conventions

### 2.1 Format

Events use the **`Noun Verb`** pattern in **Title Case**, where:
- **Noun** = the object being acted on (e.g., `Payment`, `Claim`, `Wallet`)
- **Verb** = past tense of the action (e.g., `Created`, `Opened`, `Failed`)

```
<Noun> <Past-Tense Verb>
```

**Examples:**
```
Payment Created
Claim Link Copied
Wallet Connected
Claim Succeeded
```

### 2.2 Rules

| Rule | Good | Bad |
|------|------|-----|
| Title Case for event names | `Claim Link Shared` | `claim_link_shared`, `claimLinkShared` |
| Past tense verbs only | `Payment Created` | `Create Payment`, `Payment Create` |
| snake_case for all property keys | `asset_type` | `assetType`, `AssetType` |
| No abbreviations in event names | `Wallet Address Entered` | `Wallet Addr Entered` |
| Prefix error events with `Error` noun | `Error Displayed` | `show_error`, `ErrorShown` |

### 2.3 Namespacing by Journey

While event names do not require journey prefixes, the `journey` property in every payload identifies which flow the event belongs to. This keeps event names readable while preserving filterability.

| `journey` value | Description |
|-----------------|-------------|
| `sender` | Events from the sender (Alice) flow |
| `recipient` | Events from the recipient (Bob) flow |
| `shared` | Events that can occur in either flow |

---

## 3. Standard Payload Structure

Every event includes a **base payload** of common properties. Event-specific properties are added on top.

### 3.1 Base Payload

```jsonc
{
  // Identity
  "anonymous_id": "string",         // Client-generated UUID, persisted in localStorage
  "session_id": "string",           // UUID, reset per browser session

  // Context
  "journey": "sender | recipient | shared",
  "timestamp": "ISO 8601 string",   // e.g. "2026-03-15T10:23:45.123Z"
  "platform": "web",
  "network": "testnet | mainnet",

  // Device & Environment
  "user_agent": "string",
  "device_type": "mobile | tablet | desktop",
  "referrer": "string | null",      // URL of the referring page or null

  // App & Spec version
  "app_version": "string",          // e.g. "1.0.0"
  "analytics_spec_version": "string" // Semantic version of this analytics spec (e.g. "1.0.0")
}
```

> **`analytics_spec_version` is what makes the rest of this document auditable.**
> It travels with every event so that a payload can always be read against the
> revision of this spec that was in force when it was collected. Rename a
> field or change an event's shape without it, and the affected historical data
> becomes uninterpretable rather than merely differently-shaped.

> **Privacy note:** No PII (name, email, phone) should ever appear in an analytics payload. Wallet addresses are pseudonymous — include them only where explicitly specified below. Recipient wallet addresses must never be logged in sender-journey events.

### 3.2 Conditional Properties

These properties are included only where relevant and marked `(if available)` in event tables:

| Property | Type | Description |
|----------|------|-------------|
| `claim_id` | string | Unique ID for the claim/payment |
| `asset_type` | string | `"XLM"`, `"USDC"`, etc. |
| `amount_usd_equiv` | number | USD equivalent at time of event. Omitted entirely when the price is unavailable — never `0` |
| `expiry_days` | number | `1`, `3`, `7`, `30`, `90`, or `null` (never). `3` is the 72-hour window the send form offers |
| `error_code` | string | Machine-readable error identifier |
| `error_type` | string | Category of error (see §6) |

> **Implementation notes (`frontend/lib/analytics.ts`):**
> - `network` is derived from `NEXT_PUBLIC_CRYPTO_NETWORK` by `detectNetwork()`. Only `stellar-mainnet` reports `mainnet`; an unset or unrecognised value reports `testnet`, so a misconfigured build is excluded from production dashboards rather than polluting them.
> - `user_agent` is the raw `navigator.userAgent` string (empty during SSR).
> - `asset_type` is normalised by `normalizeAssetType()` (`native` → `XLM`, `CODE:ISSUER` → `CODE`, uppercased) on every event that carries it.
> - `amount_usd_equiv` is computed by `toAmountUsdEquiv()`: USDC converts 1:1, XLM uses the cached CoinGecko XLM/USD rate (`lib/xlm-price.ts`), and the value is rounded to cents. It is omitted, never sent as `0`, when the rate is not yet known or the asset has no USD mapping.

---

## 4. Sender Journey Events

Events are listed in chronological order through the sender flow.

### 4.1 Homepage / Entry

---

#### `Page Viewed`

Fired when the Bridgelet homepage loads.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `page` | string | `"homepage"` |
| `entry_source` | string | `"direct"`, `"referral"`, `"shared_link"`, `"unknown"` |

---

### 4.2 Create Claim Form

---

#### `Send Form Viewed`

Fired when the Create Claim form is rendered.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |

---

#### `Send Form Started`

Fired on the sender's first interaction with any field in the Create Claim form.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `first_field` | string | The field first interacted with: `"amount"`, `"asset"`, `"recipient_name"`, `"message"`, `"expiration"` |

> **Funnel note (§7.1):** This event marks the start of the sender form (Stage 2). If the user leaves before completing the form, partial abandonment is measured by the absence of `Send Form Completed` within the session window; no explicit "abandonment" event is fired. Granular drop-off analysis can be performed by tracking intermediate `Send Form Field Changed` events.

---

#### `Send Form Field Changed`

Fired when the sender changes a field value and moves focus away (blur). Not fired on every keystroke.

> **Volume rule — do not implement this on `onChange`.** A single busy sender
> can generate hundreds of keystroke events across five fields, and this event
> is the highest-volume one in the catalog. Fire it on **blur only**, and only
> when the committed value differs from the value at the previous blur (so
> re-focusing a field without editing it emits nothing). Per §9's sampling
> policy this event is a candidate for sampling; `Send Form Completed` and
> everything downstream of it never are.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `field_name` | string | `"amount"`, `"asset"`, `"expiration"`, `"recipient_name"`, `"message"` |
| `asset_type` | string | Current asset selection at time of change (if field is `"asset"`) |
| `expiry_days` | number \| null | Set value (if field is `"expiration"`) |

---

#### `Send Form Completed`

Fired when the sender clicks "Continue" and the form passes client-side validation.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `asset_type` | string | Selected asset |
| `expiry_days` | number \| null | Selected expiration |
| `has_recipient_name` | boolean | Whether the optional recipient name was provided |
| `has_message` | boolean | Whether the optional message was provided |

> **Funnel note (§7.1):** This event marks successful completion of the form (Stage 3). The Stage 2 drop-off metric (`% of form starters who complete it`) is computed as the ratio of sessions containing `Send Form Completed` to those containing `Send Form Started`.

---

### 4.3 Payment Confirmation

---

#### `Payment Confirmation Viewed`

Fired when the Confirm Payment screen is rendered.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `asset_type` | string | Asset to be sent |
| `expiry_days` | number \| null | |

---

#### `Wallet Connected`

Fired when the sender successfully connects their wallet.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `wallet_provider` | string | Closed set: `"freighter"`, `"lobstr"`, `"generated"`, `"unknown"` |
| `wallet_type` | string | Display name of the provider (e.g., `"Freighter"`). Retained for readability; group by `wallet_provider` instead |

---

#### `Wallet Connection Failed`

Fired when wallet connection is attempted but fails.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `wallet_provider` | string | Closed set: `"freighter"`, `"lobstr"`, `"generated"`, `"unknown"` |
| `wallet_type` | string | Display name of the attempted provider. Retained for readability; group by `wallet_provider` instead |
| `error_code` | string | Provider error code, or `"unknown"` |

`wallet_provider` names the provider that was *attempted*, which is known even
when the failure happened before it responded — a missing extension and a
declined permission prompt are both `"freighter"` here. Connection failure rate
is expected to differ sharply by provider (a version-pinned extension release
shows up as a `freighter`-only spike), so this is a first-class dimension
rather than free text.

`error_code` distinguishes the failure modes: `"FREIGHTER_NOT_INSTALLED"`,
`"CONNECTION_DENIED"` (the user dismissed the prompt), `"NO_ADDRESS_RETURNED"`,
or `"UNKNOWN"`.

**`wallet_provider` values (closed set)**

Both wallet events carry the same `wallet_provider` value, so `Wallet Connection Failed` can be broken down by connection path (the failure rate differs sharply by provider, and a provider-specific regression — for example a Freighter API version pin — is only visible when the provider is recorded). The values match the `WALLET_PROVIDERS` union in `frontend/lib/analytics.ts` in `frontend/lib/wallet.ts`:

| `wallet_provider` value | Connection path | Notes |
|-------------------------|-----------------|-------|
| `freighter` | Live connection to the Freighter browser extension | The only path wired into the UI today |
| `lobstr` | LOBSTR paste-your-public-key flow | `connectLobstr()` throws `USE_PASTE_FLOW`; a live SDK connection does not exist |
| `generated` | Client-side keypair from `generateNewWallet()` | The user never connects an external wallet; a key is created for them |
| `unknown` | Provider could not be identified | The honest default when the failure happened before the provider was known; emitters that cannot identify the connection path send this rather than guessing |

Definitions of the four paths, and how `generated` relates to the custodial funding key, are maintained in `bridgelet-product-audit/glossary/wallet-connection-types.md` and `bridgelet-product-audit/glossary/custodial-model-in-practice.md`. Send the lowercase enum value, never the display label.

> **Implementation status:** `Wallet Connection Failed` is emitted from `frontend/components/send-form/steps/connect-step.tsx` (and `Wallet Connected` from `lib/wallet.ts`). `WalletProvider` in `frontend/lib/wallet.ts`, per the pre-flight runbook `bridgelet-product-audit/runbooks/review-analytics-spec-before-new-event.md`. See `docs/analytics-server-vs-client-decision.md` §2.

---

#### `Payment Confirmed`

> **⚠️ Naming trap — "Confirmed" means the user, not the chain.**
> This event fires when the sender **signs**, before any on-chain settlement.
> It does not mean the payment succeeded. A payment that is signed and then
> fails on-chain produces `Payment Confirmed` with **no** `Payment Created`.
> Any metric counting `Payment Confirmed` as a successful payment will
> **overcount**. The rule, stated once so it cannot be missed:
>
> **A successful payment is `Payment Created`. Never `Payment Confirmed`.**
>
> The name is kept as-is rather than renamed because it has already shipped to
> existing dashboards, and renaming an emitted event silently splits a metric
> in two. If it is ever renamed, treat it as a breaking change requiring a
> spec-version bump and a dual-emission window.

Fired when the sender clicks "Confirm & Pay" and signs the transaction. This indicates user intent; it fires *before* blockchain confirmation.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `asset_type` | string | |
| `amount_usd_equiv` | number | Omitted when the price is unavailable — never sent as `0` |
| `expiry_days` | number \| null | |
| `wallet_provider` | string | Closed set: `"freighter"`, `"lobstr"`, `"generated"`, `"unknown"` |
| `wallet_type` | string | Display name. Retained for readability; group by `wallet_provider` instead |

---

#### `Payment Created`

Fired when the blockchain confirms the funding transaction and a claim ID is returned. This is the definitive "payment exists" event.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | Unique identifier for this payment |
| `asset_type` | string | |
| `expiry_days` | number \| null | |
| `confirmation_time_ms` | number | Time in milliseconds from `Payment Confirmed` to `Payment Created` |

---

#### `Payment Creation Failed`

Fired when the blockchain transaction fails after the sender signed.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `asset_type` | string | |
| `error_code` | string | Stellar error code or `"unknown"` |

---

### 4.4 Payment Success & Sharing

---

#### `Payment Success Viewed`

Fired when the success screen (with claim link) is rendered.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `asset_type` | string | |

---

#### `Claim Link Copied`

Fired when the sender copies the claim link to clipboard.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `copy_location` | string | `"success_screen"`, `"dashboard_detail"` |

---

#### `Claim Link Shared`

Fired when the sender uses a share button (SMS, Email, WhatsApp, QR).

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `share_method` | string | `"sms"`, `"email"`, `"whatsapp"`, `"qr_code"` |

---

### 4.5 Sender Dashboard

---

#### `Dashboard Viewed`

Fired when the sender's payment dashboard is loaded.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `total_payments` | number | Total number of payments visible to the sender |
| `active_filter` | string | Filter active on load. Same closed set as `Dashboard Filter Applied.filter` (see below) |

---

#### `Dashboard Filter Applied`

Fired when the sender selects a different status filter on the dashboard. It does not fire on the initial dashboard load (that state is reported by `Dashboard Viewed.active_filter`) or when the sender re-selects the filter that is already active.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `filter` | string | **Closed set:** exactly one of `"all"`, `"unclaimed"`, `"claimed"`, `"expired"` (see below) |

**`filter` values (closed set)**

| `filter` value | Dashboard label | Payments shown |
|----------------|-----------------|----------------|
| `all` | All | Every payment, no status restriction |
| `unclaimed` | Unclaimed | Payments the recipient has not claimed and that have not expired |
| `claimed` | Claimed | Payments the recipient has claimed |
| `expired` | Expired | Payments past their expiry (the state in which the sender can reclaim funds) |

The four values and labels come from the Sender Dashboard screen in `bridgelet-frd-ui-ux.md`.

**Rules for `filter` and `active_filter`**

- The set is closed. Any other value is an implementation bug, not a new category.
- Send the lowercase enum value, never the display label and never user-entered text, so usage can be aggregated with a plain group-by.
- Status is the only dashboard filter dimension the FRD defines. There is no date-range or asset-type filter today, so no open-ended filter value exists.
- If another filter dimension is added later (for example date range or asset type), do not widen `filter`. Give the new dimension its own property and document here, in the same change that adds the feature, either its closed set of values or, if it is open-ended (such as a free date range), that it is open-ended and how it is bucketed for aggregation.
- Open item: the FRD does not say how backend lifecycle statuses beyond claimed and expired (for example `pending_payment` or `failed`) map onto these four buckets. The dashboard implementation must apply one fixed mapping and record it with the dashboard, so the same payment is never counted under two different filters.

---

#### `Payment Details Viewed`

Fired when the sender opens the detail view for a specific payment **and** that view has rendered the details of a payment the sender owns.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | Identifier of the payment, taken from the loaded payment record (the backend account id), never copied from the URL |
| `claim_status` | string | `"unclaimed"`, `"claimed"`, `"expired"` |

**Firing rule: own payments only**

- Fire only after the payment record has been loaded and displayed to the sender it belongs to. The event means "a sender looked at one of their own payments".
- Do not fire for attempted access. A payment ID that does not exist, belongs to another sender, is rejected by the backend, or fails to load must not produce this event. Those cases render an error state and are reported through `Error Displayed` (section 6) with `claim_id` set to `null`.
- Never copy an unvalidated ID from the URL into any analytics property. It is attacker-controlled input, and for a payment the sender does not own it is not a payment they have viewed.

**Why attempted access is excluded**

- Counting probes as views would inflate the number of senders inspecting their payments and distort anything derived from it.
- Client-side analytics is not a security control: events can be forged or dropped, and all events are suppressed when Do Not Track is set (section 9.5). Detecting enumeration of payment-detail URLs therefore belongs on the backend (request logs, rate limiting, ownership checks), not in this event.
- The sender API should answer "not found" and "not yours" identically so the response itself does not reveal which IDs exist. That is a backend security requirement tracked in `docs/security-model.mdx`, not part of this analytics spec.
- If the product later wants a signal for denied attempts, add it as a separate server-side event under the naming rules in section 2, not as a variant of this event.

> **Implementation status:** The sender dashboard and its detail view are not built in the frontend yet. Today this event is emitted from the payment confirmation step shown right after a payment is created (`frontend/components/send-form/steps/confirm-step.tsx`, always with `claim_status: "unclaimed"`). That is consistent with the rule above, since it shows the sender their own just-created payment. See `docs/analytics-server-vs-client-decision.md`.

---

#### `Payment Cancelled`

Fired when the sender cancels an unclaimed payment.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `asset_type` | string | |
| `time_since_creation_hours` | number | Hours elapsed since the payment was created |

---

#### `Funds Reclaimed`

Fired when the sender successfully reclaims funds — either because the claim expired or because the sender cancelled an unclaimed payment.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `asset_type` | string | |
| `reclaim_reason` | string | **Closed set:** `"expired"` (the claim expired and the funds returned), `"cancelled"` (the sender cancelled the unclaimed payment and the funds returned) |
| `days_expired` | number | Days the claim was expired before reclaim. Only meaningful when `reclaim_reason = "expired"`; omit (or send `0`) when `reclaim_reason = "cancelled"` |

**`reclaim_reason` values (closed set)**

| `reclaim_reason` value | Situation | Distinct product signal |
|------------------------|-----------|-------------------------|
| `expired` | The recipient never claimed before the expiry window closed | The claim link reached the recipient but did not convert — a delivery/timing problem |
| `cancelled` | The sender cancelled the payment before it was claimed | The sender changed their mind — a sender-intent decision, not a recipient failure |

These are different user situations and warrant different interventions, so they must not be collapsed into one "reclaim" bucket. In particular, `Reclaim Rate` (§8.1) should be read per `reclaim_reason`; a rising `cancelled` share says something about sender intent, while a rising `expired` share says something about recipient reach. `days_expired` stays relevant only to the `expired` case, which is why it is scoped there.

---

#### `Recovery Information Viewed`

Fired when a sender opens the screen or panel that shows their recovery information for a payment — the details needed to get funds back when a claim link is lost, the recipient never claims, or the sender created a self-custody wallet. Fires when that information is rendered to the sender.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `recovery_method` | string | **Closed set:** `"reclaim_expired"`, `"reclaim_cancelled"`, `"self_custody_backup"` — which recovery surface was opened (see below) |

---

#### `Recovery Information Copied`

Fired when a sender copies their recovery information to the clipboard.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` |
| `claim_id` | string | |
| `recovery_method` | string | Same closed set as `Recovery Information Viewed` |
| `copy_target` | string | **Closed set:** `"claim_link"`, `"recovery_address"`, `"wallet_secret"` — what was copied |

**`recovery_method` values (closed set)**

| `recovery_method` value | Recovery surface |
|-------------------------|------------------|
| `reclaim_expired` | Reclaiming funds after a claim expired (the flow that produces `Funds Reclaimed`) |
| `reclaim_cancelled` | Reclaiming funds after the sender cancelled an unclaimed payment |
| `self_custody_backup` | Backing up a client-generated wallet's key/seed (`wallet_type: "generated"`) |

**Why these events exist**

For a custodial product, drop-off in the recovery flow is a direct signal of support burden: a sender who opens the recovery screen but never copies the information, or never completes a reclaim, is a likely support ticket. `Funds Reclaimed` records only the successful end state, so today there is no way to see how many senders reach recovery and abandon it. These two events add the entry point (`Recovery Information Viewed`) and the key hand-off step (`Recovery Information Copied`) so the funnel can be measured.

**Privacy boundary**

- Never include the recovery material itself in either payload — no claim link, no recovery address, no key, no seed phrase. Only the *fact* that the sender viewed or copied it, and which surface it was.
- `wallet_secret` records that a wallet secret or seed phrase was copied, not its value. If even that signal is judged too sensitive to store, prefer dropping the `copy_target` row over weakening the rule.
- Recovery events are `journey: "sender"` only. A recipient never sees these surfaces.

> **Implementation status:** The event names are registered in the `ClaimEvent` union and emitters (`analytics.recoveryInformationViewed` / `recoveryInformationCopied`) exist in `frontend/lib/analytics.ts`, so the `analytics-spec-diff` name check holds. No recovery UI, reclaim screen, or self-custody backup surface exists in `frontend/` today, so neither emitter has a call site yet (only the on-chain reclaim outcome is modeled, by `Funds Reclaimed`). Defined ahead of implementation per the pre-flight runbook `bridgelet-product-audit/runbooks/review-analytics-spec-before-new-event.md`. See `bridgelet-product-audit/glossary/custodial-model-in-practice.md`.

---

## 5. Recipient Journey Events

Events are listed in chronological order through the recipient claim flow.

### 5.1 Claim Landing Page

---

#### `Claim Page Opened`

Fired immediately when a recipient opens a claim link. Fires before token verification.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | Extracted from URL token |
| `entry_channel` | string | How the recipient arrived: `"sms"`, `"email"`, `"whatsapp"`, `"qr_scan"`, `"deep_link"`, `"direct"`, `"unknown"` |
| `is_returning_visit` | boolean | Whether this browser had already opened a claim link before |

**`entry_channel` values.** `qr_scan` is mobile-only and is set when the QR
scanner tags the destination URL with a channel parameter. `deep_link` means
the link was opened through the app scheme (`bridgelet://claim/<token>`) rather
than a pasted or shared https URL. Both are separate acquisition channels for
§8.2's Recipient Entry Channel Distribution and neither may be folded into
`direct`. `direct` therefore means "an https claim link with no referral signal",
and `unknown` means the channel could not be determined (no `document.referrer`
and no parameters).

**`is_returning_visit` is browser-scoped, not per-claim.** It is `true` when the
same browser has opened *any* claim link before. It is deliberately not
per-claim-id: answering "is this recipient deciding over several days?" does not
require knowing which claim they came back to, and persisting claim tokens to
`localStorage` would store bearer credentials for real money — see
`bridgelet-product-audit/checklists/localstorage-data-exposure-checklist.md`.
A recipient opening two different links from one device reports `true` on the
second; that is the accepted trade-off for keeping identifiers out of storage.

**Repeat opens are not deduplicated.** A refresh, a re-open from history, or a
React development-mode double mount each produce their own event, so the event
count is the number of *opens*, not the number of unique recipients — use
`is_returning_visit` and `anonymous_id` for the latter. Each event carries a
distinct `message_id` (§3.1), so the pipeline can deduplicate if a consumer
needs opens-per-session instead. This is a deliberate decision for this event
specifically rather than a gap in §9.4: a second open of the same link usually
represents a real decision, not an accident.

| `entry_channel` | string | Best-guess referral channel: `"sms"`, `"email"`, `"whatsapp"`, `"direct"`, `"qr_scan"`, `"unknown"` |
| `is_returning_visit` | boolean | `false` on the first `Claim Page Opened` recorded for this `anonymous_id`; `true` when the same `anonymous_id` has already fired `Claim Page Opened` before (any claim link) |

**`is_returning_visit` and how it is derived**

`Claim Conversion Rate` (§8.1) currently divides `Claim Succeeded` by `Claim Verified`, but the recipient funnel (§7.2) starts at `Claim Page Opened`. Without a first-time/returning split, a recipient who opens the same link several times while deciding whether to claim — inflating the opener count — is indistinguishable from genuinely new traffic, which makes the denominator of any open-based conversion metric misleading.

- The property is derived from `anonymous_id` history, not from anything about the current page load. It is `false` only for the first `Claim Page Opened` ever seen for a given `anonymous_id`; every subsequent open by that same `anonymous_id` is `true`.
- Two equivalent ways to compute it, both acceptable: (a) the emitter keeps a `localStorage` flag (`bridgelet_claim_page_opened`) and reports its value before setting it, or (b) the analytics pipeline computes it by grouping on `anonymous_id` and ordering by `timestamp`. Method (b) is authoritative — it still works when `localStorage` was cleared or blocked — and should be the fallback when `anonymous_id` is empty.
- `anonymous_id` is per-browser and per-store, so a recipient who opens the link on a second device is `false` there. That is inherent to a cookie-less anonymous identity (§9.3) and is preferable to inventing a cross-device signal.

**Deduplication within a session**

Repeat opens of the same claim link within one session are **not** deduplicated. A recipient who refreshes the page, navigates away and returns, or opens the same link again is performing a distinct, real interaction; every open emits one `Claim Page Opened`. This is deliberate and is consistent with §9.4, which makes only `Payment Created` and `Claim Succeeded` idempotent — `Claim Page Opened` is not in that set.

The rule below distinguishes a genuine repeat open from an accidental double-fire:

- **Count it:** one `Claim Page Opened` per page load. A second page load — in the same session or a later one — is another event.
- **Suppress it:** a second event from the *same* page load. React StrictMode double-invokes effects in development, and a component can re-render on mount; neither is a second open. The emitter must guard against this with a per-mount flag so one mounted claim page produces exactly one event.

Analysts wanting "distinct opens" should count distinct `session_id` (+ `claim_id`) pairs rather than assuming the event is deduplicated. Because a repeat open carries the same `claim_id` and `session_id` but a fresh `timestamp`, within-session repeats are still countable without losing the "returning to the same link" signal.

---

#### `Claim Verified`

Fired when the backend confirms the claim token is valid and the funds are available.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | Backend `accountId` from the verify response (see mapping below) |
| `asset_type` | string | Derived from the verify response `asset` (see mapping below) |
| `expiry_days_remaining` | number | Days until expiration at time of opening, derived from the response `expiresAt` |
| `verification_time_ms` | number | Time taken for backend verification, measured by the emitter (not returned by the backend) |

**Correspondence with the backend**

This event corresponds to an HTTP 200 from bridgelet-sdk `POST /claims/verify`, which `ClaimsController` hands to `TokenVerificationProvider.verifyClaimToken`. That provider throws for every non-success case, so a 200 always carries `valid: true`. There is no "verified but invalid" outcome, and `Claim Verified` never fires for a rejection.

**Rejection side, and which §6 `error_type` it produces.** Every non-200
outcome is reported as `Error Displayed` rather than `Claim Verified`, and the
backend status alone is not always enough to tell the failures apart — §6's
vocabulary is finer-grained than HTTP. The mapping an emitter must apply:

| Condition | Source | `error_type` | `error_code` |
|---|---|---|---|
| Token fails the client-side format check | client, before any request | `invalid_token` | `TOKEN_MALFORMED` |
| No matching claim record (404) | backend | `invalid_token` | `TOKEN_NOT_FOUND` |
| Token past its expiry (401 / `EXPIRED`) | backend | `expired_token` | `TOKEN_EXPIRED` |
| Funds already swept (409 / `CLAIMED`) | backend, or after a submit | `already_claimed` | `ALREADY_CLAIMED` |
| Submitted address fails validation | client | `invalid_wallet_address` | `INVALID_ADDRESS_<reason>` |
| Sweep rejected on-chain, or destination not funded | backend | `transaction_failed` | backend code, else status |
| API or Stellar network unreachable | network | `network_unavailable` | `API_UNREACHABLE` |

A token that cannot be a token is classified **client-side, before the request**:
without that check a mistyped link reaches the API, comes back 401, and is
reported as `expired_token`, so corrupt URLs inflate the expiry numbers. The
`source_screen` value distinguishes where a given failure was discovered —
`claim_landing` for page load, `claim_result` for the result of an action the
recipient took — so the same `error_type` is not double-counted when both
describe the same visit.

The 200 body (`ClaimVerificationResponseDto`) has five fields. Build the payload from them rather than re-deriving values elsewhere:

| Response field | Used for |
|----------------|----------|
| `valid` | Always `true` on a 200. Not emitted. |
| `accountId` | `claim_id`. It is the same identifier `Payment Created` uses on the sender side, so the two sides of one claim can be matched (section 9.3). |
| `amount` | Not part of this event. |
| `asset` | `asset_type`. The backend returns an identifier, either `"native"` or `"CODE:ISSUER"`. Take the part before the colon and map `native` to `XLM` (for example `"USDC:G..."` becomes `"USDC"`). |
| `expiresAt` | `expiry_days_remaining`, computed from this timestamp at event time. The backend does not return a remaining-days value. |

`verification_time_ms` is not in the response. Measured in the browser it is the full request round trip, including network latency. Measured on the server it is handler time only. The two are not comparable, so do not mix them in one metric.

**Rejections (no `Claim Verified`)**

Failure detail is not in a response body. The backend signals it through the HTTP status and an exception message, which map onto the `error_type` values in section 6 as follows:

| Backend outcome | HTTP status | Message | `error_type` |
|-----------------|-------------|---------|--------------|
| Token malformed, bad signature, or wrong token type | 401 | `Invalid token signature`, `Invalid token type` | `invalid_token` |
| No account matches the token | 401 | `Invalid claim token` | `invalid_token` |
| Token or account past its expiry | 401 | `Token has expired`, `Claim token has expired`, `Account has expired` | `expired_token` |
| Claim already redeemed | 409 | `Claim has already been redeemed` | `already_claimed` |
| Account initializing, awaiting payment, in a failed state, or in an unknown state | 400 | various | `unknown` (no dedicated value in section 6) |

Two consequences for implementers:

- The status code alone cannot separate `invalid_token` from `expired_token`: both are 401, and only the message differs. A client that maps every 401 to one outcome will misreport the other. The backend, which knows which branch it took, is the only place this can be classified exactly.
- The verify endpoint never returns 404. An unknown token is a 401, not "not found".

**Preferred source**

Section 9.2 already lists `Claim Verified` as server-side preferred. Emitting from the verify path (`TokenVerificationProvider`) gives exact classification of the rejections above and direct access to `accountId`, `asset` and `expiresAt`, instead of re-deriving them from a status code in the browser.

> **Implementation status:** Today the event is emitted client-side after `loadClaimView()` resolves, and recipient events use the URL token as `claim_id`, while sender events use `accountId`. Until that changes, the two sides cannot be joined on `claim_id` as section 9.3 intends. See `docs/analytics-server-vs-client-decision.md`.

---

#### `Claim CTA Clicked`

Fired when the recipient clicks "Claim Your Funds" on the landing page.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |

---

### 5.2 Wallet Address Entry

---

#### `Wallet Address Screen Viewed`

Fired when the wallet address input screen is rendered.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `has_previous_address` | boolean | Whether a previously-used address was offered as a suggestion |

---

#### `Wallet Address Entered`

Fired when the recipient submits a wallet address and it passes client-side validation (length, prefix check).

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `used_previous_address` | boolean | Whether the recipient reused a previously suggested address |

> **Privacy:** The wallet address itself must NOT be included in this payload.

---

#### `Wallet Address Validation Failed`

Fired when the recipient submits an address that fails client-side validation.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `validation_error` | string | `"invalid_prefix"`, `"invalid_length"`, `"invalid_checksum"` |
| `attempt_number` | number | How many failed attempts on this screen |

---

### 5.3 Claim Confirmation & Processing

---

#### `Claim Confirmation Viewed`

Fired when the review/confirm claim screen is shown.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |

---

#### `Claim Submitted`

Fired when the recipient clicks "Claim Now". Fires before the sweep is executed.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |

---

#### `Claim Succeeded`

Fired when the sweep transaction is confirmed on-chain. This is the primary conversion event for the recipient journey.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |
| `time_to_claim_hours` | number | Hours between `Payment Created` (sender) and `Claim Succeeded` (recipient) |
| `sweep_duration_ms` | number | Time in ms from `Claim Submitted` to on-chain confirmation |
| `entry_channel` | string | Same value recorded at `Claim Page Opened` |

---

#### `Claim Failed`

Fired when the sweep fails after the recipient confirmed.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |
| `error_code` | string | Stellar error code or `"unknown"` |
| `error_type` | string | `"network_error"`, `"token_expired"`, `"already_claimed"`, `"transaction_failed"`, `"unknown"` |
| `attempt_number` | number | How many times the recipient has tried on this claim |

---

### 5.4 Post-Claim

---

#### `Claim Success Viewed`

Fired when the success screen is displayed after a successful sweep.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `asset_type` | string | |

---

#### `Sender Signup CTA Clicked`

Fired when a recipient clicks "Create your account →" on the success screen. Measures viral growth potential.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"recipient"` |
| `claim_id` | string | |
| `source` | string | `"claim_success_screen"` |

---

#### `Explorer Link Clicked`

Fired when a user (sender or recipient) clicks a Stellar Explorer transaction link.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` or `"recipient"` |
| `claim_id` | string | |
| `source_screen` | string | `"claim_success"`, `"payment_details"` |
| `tx_hash` | string | Hash of the on-chain transaction the link points to, taken from the link's URL, so the click can be correlated with the actual Stellar transaction. Omit only when the link target has no transaction hash (for example an account-level link) |
| `explorer` | string | **Closed set:** `"stellar_expert"`, `"stellar_chain"` — the block explorer the link opened (see below) |
| `network` | string | `"testnet"` or `"mainnet"` — the network the explorer URL targets |

**`explorer` values (closed set)**

| `explorer` value | Explorer | Base URL pattern |
|------------------|----------|------------------|
| `stellar_expert` | [Stellar Expert](https://stellar.expert) | `https://stellar.expert/explorer/{network}/tx/{tx_hash}` |
| `stellar_chain` | [StellarChain](https://stellarchain.io) | `https://stellarchain.io/{network === "mainnet" ? "" : "testnet/"}tx/{tx_hash}` |

Rules:

- The explorer and network are properties of the *link the user clicked*, not of the user's session. If Bridgelet ever links to more than one explorer, each emits its own `explorer` value; do not collapse them into one.
- Testnet and mainnet explorers differ. `network` is recorded explicitly rather than inferred, because the same `tx_hash` shape appears on both networks and a dashboard that assumes one will silently mix them.
- Never build `tx_hash` from an unvalidated URL segment. Read it from the link target that was actually rendered, so a forged URL cannot inject an arbitrary value into the payload.

| `explorer` | string | Explorer the link pointed at: `"stellar_expert"` (mainnet), `"stellar_expert_testnet"` (testnet) |
| `tx_hash` | string | The transaction the link pointed at. **Omitted when the frontend has no transaction hash** |

`explorer` is recorded because the explorer instance differs by network —
testnet and mainnet transactions are not on the same instance — so a click
cannot be attributed to a transaction from the click alone.

`tx_hash` is omitted rather than sent as `null` or an empty string when no
hash is available. Omission means "this click could not be attributed to a
transaction"; an empty value would mean the hash was known and empty. A
transaction URL takes a transaction hash and nothing else: a claim id or an
account id in that path does not resolve, and on the claim page the token is a
bearer credential for the funds, so it must never be placed in a third-party
URL (see `docs/security-model.mdx`, T-16). Emitters must therefore render no
explorer link at all when no hash exists rather than substituting another
identifier.

---

## 6. Error & Edge Case Events

These events cover error states and special scenarios from the FRD.

---

#### `Error Displayed`

Fired whenever an error state screen or inline error is shown to the user.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` or `"recipient"` |
| `claim_id` | string \| null | If available |
| `error_type` | string | See table below |
| `error_code` | string | Machine-readable code or `"unknown"` |
| `source_screen` | string | Screen where the error appeared |

**Standard `error_type` values:**

| `error_type` | Trigger |
|---|---|
| `invalid_token` | Claim link is malformed or has no matching record |
| `expired_token` | Claim token is past its expiration date |
| `already_claimed` | Token is valid but funds were already swept |
| `invalid_wallet_address` | Wallet address fails validation |
| `transaction_failed` | Stellar transaction rejected |
| `network_unavailable` | Cannot reach Stellar network or Bridgelet API |
| `wallet_connection_failed` | Sender's wallet refused connection |
| `unknown` | Unclassified error |

---

#### `Retry Clicked`

Fired when a user clicks a "Try Again" or "Retry" button on an error screen.

| Property | Type | Value / Description |
|----------|------|---------------------|
| `journey` | string | `"sender"` or `"recipient"` |
| `claim_id` | string \| null | |
| `error_type` | string | Error type that triggered the retry prompt |
| `error_code` | string | §3.2 machine-readable code of the error being retried, or `"unknown"` |
| `attempt_number` | number | Which retry attempt this is |

`error_type` and `error_code` describe the error that *prompted* the retry, not
a generic failure. A retry offered after a rate limit and a retry offered after
a rejected sweep are different signals about where the flow is fragile, and
collapsing both into `unknown` discards the only thing the event carries.


---

## 7. Conversion Funnel Definitions

### 7.1 Sender Activation Funnel

Measures how effectively the product converts a homepage visitor into a sender who creates a payment.

```
Page Viewed (homepage)
    ↓
Send Form Started
    ↓
Send Form Completed
    ↓
Wallet Connected
    ↓
Payment Confirmed        ← intent committed
    ↓
Payment Created          ← conversion complete
    ↓
Claim Link Shared        ← activation milestone
```

| Stage | Event | Drop-off Metric |
|-------|-------|----------------|
| 1 | `Page Viewed` | Baseline |
| 2 | `Send Form Started` | % of visitors who start the form |
| 3 | `Send Form Completed` | % of form starters who complete it |
| 4 | `Wallet Connected` | % who connect wallet on confirm screen |
| 5 | `Payment Confirmed` | % who sign the transaction |
| 6 | `Payment Created` | % confirmed → on-chain success |

> **Acceptance criterion for any dashboard built on this funnel:** define
> "successful payment" as `Payment Created`. `Payment Confirmed` is intent and
> must never appear in a success count, a revenue total or a conversion
> numerator — a signed-then-failed payment fires `Payment Confirmed` and no
> `Payment Created`, so counting it as a success overcounts by exactly the
> on-chain failure rate. See §4.3 `Payment Confirmed` for the full note.
| 7 | `Claim Link Shared` | % who actively share (vs. just copy) |

**Abandonment is measured as absence, not as an event.** A sender who starts
the form and then closes the tab produces `Send Form Started` and nothing
further. There is deliberately no "abandoned" or "session timeout" event: the
drop-off from any stage to the next is `1 - (next stage count / stage count)`
over the same `session_id`, and an explicit abandonment event would double
count every real failure that already fires its own event (`Payment Creation
Failed`, `Claim Failed`) while still missing the tab-closed case.

This applies symmetrically to every stage in this funnel and to §7.2. When
building a dashboard, compute drop-off from stage counts rather than waiting
for a negative signal that will never arrive. Do not attribute a drop to a
failure without checking for the paired failure event first — a session that
emits `Payment Creation Failed` was already explained by that event.

#### Funnel Drop-off & Partial Abandonment Measurement Methodology

A common question when designing funnel queries and dashboards is how partial form abandonment (e.g. a user who triggers `Send Form Started` by focusing an input field, but navigates away or closes the browser tab before clicking "Continue" to trigger `Send Form Completed`) is captured.

**Intentional Design: Drop-off is measured purely as the absence of the next funnel milestone within an attribution window.**

1. **No Explicit "Form Abandoned" Event**:
   - There is deliberately no client-side `Send Form Abandoned` or `beforeunload` heartbeat event. Browser lifecycle events (`beforeunload`, `pagehide`) are notoriously unreliable across modern mobile and desktop browsers (often throttled or dropped) and introduce phantom signals on tab switches or reloads.
2. **Dashboard & Query Computation**:
   - In downstream analytics tools (Mixpanel, PostHog, Amplitude, SQL warehouse), stage 2 to stage 3 drop-off is calculated as:
     $$\text{Stage 2 Drop-off \%} = 100\% - \left( \frac{\text{Sessions/Users with } \texttt{Send Form Completed}}{\text{Sessions/Users with } \texttt{Send Form Started}} \times 100\% \right)$$
   - Both events carry the base payload (§3.1) with matching `session_id` and `anonymous_id`. The drop-off is evaluated over a standard session duration or attribution conversion window (e.g., 30 minutes to 24 hours).
3. **Granular Friction Diagnosis via Field Changes**:
   - To pinpoint *where* users abandon without needing an artificial timeout event, §4.2 provides `Send Form Field Changed` (`field_name: "amount" | "asset" | "expiration" | "recipient_name" | "message"`). By inspecting the last `Send Form Field Changed` emitted prior to session termination, teams can identify specific input friction points (e.g., users dropping off after editing `expiration`).

---

### 7.2 Recipient Claim Funnel

Measures how effectively a claim link converts a recipient into a successful claimer.

```
Claim Page Opened
    ↓
Claim Verified           ← link is valid
    ↓
Claim CTA Clicked
    ↓
Wallet Address Entered
    ↓
Claim Submitted          ← intent committed
    ↓
Claim Succeeded          ← conversion complete
```

| Stage | Event | Drop-off Metric |
|-------|-------|----------------|
| 1 | `Claim Page Opened` | Baseline (all link opens) |
| 2 | `Claim Verified` | % of opens with valid, unexpired tokens |
| 3 | `Claim CTA Clicked` | % of verified claims where recipient clicks CTA |
| 4 | `Wallet Address Entered` | % who successfully enter a valid wallet address |
| 5 | `Claim Submitted` | % who reach final confirmation and submit |
| 6 | `Claim Succeeded` | % of submissions that result in a successful sweep |

---

### 7.3 Full End-to-End Funnel

The combined funnel for measuring the complete value chain.

```
Page Viewed (sender)
    ↓
Payment Created          (Sender Activation Funnel)
    ↓
Claim Page Opened        (Recipient receives link)
    ↓
Claim Succeeded          (Recipient Claim Funnel)
```

**End-to-end conversion rate** = `Claim Succeeded` ÷ `Page Viewed (homepage)`

---

## 8. Business Metrics & KPI Definitions

### 8.1 Core KPIs

> **Query definitions:** executable query shapes for each KPI below,
> their join keys, and per-KPI readiness status are maintained in
> `docs/analytics-kpi-definitions.md`.

---

#### Claim Conversion Rate (CCR)

The percentage of opened, valid claim links that result in a successful claim.

```
CCR = (Claim Succeeded events) / (Claim Verified events) × 100
```

**Target baseline (MVP):** Establish benchmark.
**Signals a problem when:** CCR drops significantly, indicating friction in the recipient flow.

---

#### Time to Claim (TTC)

The median time elapsed between a payment being created and it being successfully claimed.

```
TTC = median(Claim Succeeded.timestamp − Payment Created.timestamp)
      for all matched claim_id pairs
```

**Reported as:** Hours or days.
**Signals a problem when:** Median TTC increases, suggesting recipients are failing to complete the flow on first visit.

---

#### Expiry Rate

The percentage of created payments that expire without being claimed.

```
Expiry Rate = (payments with status "expired" and no Claim Succeeded)
              / (total Payment Created events)
              × 100
```

**Signals a problem when:** Expiry rate is high, suggesting the claim link is not reaching recipients effectively, or the recipient experience is too difficult.

---

#### Reclaim Rate

The percentage of expired payments where the sender actively reclaims funds.

```
Reclaim Rate = (Funds Reclaimed events)
               / (payments with "expired" status)
               × 100
```

**Signals a problem when:** Very low reclaim rates may indicate senders are unaware of expired claims or the reclaim UX is poor.

---

#### Sender Activation Rate

The percentage of homepage visitors who complete at least one payment.

```
Sender Activation Rate = (unique anonymous_ids with ≥1 Payment Created)
                         / (unique anonymous_ids with Page Viewed homepage)
                         × 100
```

---

### 8.2 Engagement Metrics

---

#### Share Method Distribution

Breakdown of how senders share claim links.

```
For each share_method in {sms, email, whatsapp, qr_code, copy_only}:
  % = (Claim Link Shared events with share_method)
      / (total sharing actions per claim)
      × 100
```

**Use:** Informs which sharing channels to prioritize in the UI and for integrations.

---

#### Recipient Entry Channel Distribution

Breakdown of channels through which recipients open claim links.

> **Readiness: blocked.** The web client emits `Claim Page Opened` with the
> documented `entry_channel` values, but this repository contains no query or
> dashboard that computes the distribution below. The event payload tests only
> verify emission; they do not verify the KPI against an event export. Do not
> report this KPI until an aggregation query or dashboard is implemented and
> its result has been checked against the event data. See
> `bridgelet-product-audit/postmortems/analytics-spec-vs-implementation-unverified.md`.

```
For each entry_channel in {sms, email, whatsapp, direct, qr_scan, unknown}:
  % = (Claim Page Opened events with entry_channel)
      / (total Claim Page Opened events)
      × 100
```

**Use:** Cross-referenced against Claim Conversion Rate per channel to identify best-performing share channels.

---

#### Asset Distribution

Breakdown of assets used in payment creation.

```
For each asset in {XLM, USDC, ...}:
  % = (Payment Created events with asset_type)
      / (total Payment Created events)
      × 100
```

---

#### Claim Failure Rate

Percentage of claim submissions that result in failure.

```
Claim Failure Rate = (Claim Failed events)
                     / (Claim Submitted events)
                     × 100
```

Broken down further by `error_type` to diagnose the leading causes.

---

#### Wallet Address Validation Failure Rate

Percentage of wallet address submissions that fail client-side validation.

```
Validation Failure Rate = (Wallet Address Validation Failed events)
                          / (Wallet Address Screen Viewed events)
                          × 100
```

**Signals a problem when:** High, indicating recipient confusion about Stellar address format.

---

#### Viral K-Factor (Recipient → Sender)

Measures the product's viral loop: how often a recipient becomes a sender.

```
K-Factor = (Sender Signup CTA Clicked events)
           / (Claim Succeeded events)
```

> **Note:** `Sender Signup CTA Clicked` measures intent only. True K-factor requires tracking
> whether the recipient later creates a payment (linkable via `anonymous_id` if the same browser is used).

---

### 8.3 Operational Metrics

These are lower-level metrics derived from event data to monitor system health alongside product health.

| Metric | Derived From | Purpose |
|--------|-------------|---------|
| Median payment confirmation time | `confirmation_time_ms` in `Payment Created` | Monitor Stellar network performance |
| Median sweep duration | `sweep_duration_ms` in `Claim Succeeded` | Monitor backend sweep service |
| Wallet connection failure rate | `Wallet Connection Failed` / `Wallet Connected` + `Wallet Connection Failed` | Monitor wallet provider compatibility |
| Error rate by type | `Error Displayed` grouped by `error_type` | Detect spikes in specific failure modes |
| Network unavailability incidents | `Error Displayed` where `error_type = network_unavailable` | Proxy for Stellar network outages affecting users |

---

## 9. Implementation Notes

> This section is guidance for the engineering team when the time comes to implement tracking. It does not constitute part of the spec definition.

### 9.1 Recommended Analytics Platforms

This spec is platform-agnostic and compatible with:
- **[Segment](https://segment.com)** — recommended as a routing layer to downstream tools
- **[PostHog](https://posthog.com)** — open-source; suitable for self-hosted analytics
- **[Mixpanel](https://mixpanel.com)** — strong funnel analysis
- **[Amplitude](https://amplitude.com)** — strong for product metrics

**Current Bridgelet wiring (web):** Plausible is the primary collector
(`frontend/components/plausible-script.tsx`, configured by
`NEXT_PUBLIC_PLAUSIBLE_DOMAIN`), with PostHog (`window.posthog.capture`) as an
automatic fallback (`track()` in `frontend/lib/analytics.ts`). Plausible is a
collector, not one of the routing/analysis platforms above, so it does not
contradict this list: event names and payloads are unchanged whichever
provider receives them, and swapping collectors is a dispatch change only.
The mobile app (`mobile/app/src/analytics/analytics.ts`) is a console-only
stub and must target this same primary/fallback pair when a provider is wired.

### 9.2 Client-Side vs. Server-Side

| Event | Recommended Source | Reason |
|-------|--------------------|--------|
| `Page Viewed`, UI interactions | Client-side | UI state is only known client-side |
| `Payment Created` | **Server-side preferred** | Authoritative confirmation from blockchain |
| `Claim Verified` | **Server-side preferred** | Authoritative token validation |
| `Claim Succeeded` | **Server-side preferred** | Authoritative sweep confirmation |
| `Claim Failed` | **Server-side preferred** | Authoritative error source |

Where server-side events are used, they should be enriched with client context (session ID, device type) passed from the frontend.

### 9.3 Anonymous Identity & Session

- `anonymous_id`: Generate a UUID on first page load and persist to `localStorage`. Use this as the primary identifier across sessions. Do not use cookies for this if avoidable.
- `session_id`: Generate a new UUID when a browser session starts (first page load, or after 30 minutes of inactivity). Store in `sessionStorage`.
- Match sender and recipient sides of the same claim via `claim_id`, not via user identity.

### 9.4 Event Deduplication

- `Payment Created` and `Claim Succeeded` must be idempotent at the analytics layer. If a server-side retry sends the same event twice (same `claim_id`), the analytics pipeline must deduplicate on `claim_id` for these events.
- Use a `message_id` or `event_id` UUID on every event payload to support deduplication.

### 9.5 Do Not Track

Respect browser-level `DNT` headers. If `DNT: 1`, suppress all analytics events. This is especially important for the recipient flow, where the user may not have any prior relationship with Bridgelet.

### 9.6 Sampling Policy

Events are split into two classes, and the split is by role in a KPI rather
than by volume.

**Never sampled — anything that feeds a KPI numerator or denominator.**
`Page Viewed`, `Claim Page Opened`, `Claim Verified`, `Send Form Started`,
`Send Form Completed`, `Wallet Connected`, `Payment Confirmed`,
`Payment Created`, `Claim Submitted`, `Claim Succeeded`, `Claim Failed`,
`Funds Reclaimed`, `Sender Signup CTA Clicked`, and every §10 mobile-only
event. A sampled conversion rate is not a conversion rate; it is a rate with
an unquantified bias, and the bias is not uniform across segments, which is
what makes it misleading rather than merely imprecise.

**Sampling permitted under load — diagnostics only.** `Send Form Field
Changed`, `Wallet Address Validation Failed`, `Error Displayed` on the inline
address-validation path, and `Explorer Link Clicked`. These describe *how* a
flow felt, not *whether* it converted, so a sampled view of them is acceptable
as long as the sampling rate is recorded alongside the number. If any of these
is later promoted to a KPI input, it joins the never-sampled class.

**Applying a rate.** Sample at the emitter or the provider, never in the
query — a query-time sample hides the loss from anyone reading the query. The
rate applied must be written next to any chart built on a sampled event.

---

## 10. Mobile App Extension

The Expo app (`mobile/`) tracks the same event names as the web app wherever
the two flows overlap, so a single funnel spans both platforms. This section
records the parts that are genuinely different.

### 10.1 Base payload

Every mobile event carries these fields in addition to the event's own
parameters:

| Field | Type | Value |
|---|---|---|
| `journey` | string | `"sender"`, `"recipient"` or `"shared"` — the same vocabulary as §3.1 |
| `timestamp` | string | ISO 8601 |
| `platform` | string | `"ios"` or `"android"` |
| `app_version` | string | From the Expo config, or `"unknown"` |
| `device_type` | string | Always `"mobile"` on this platform |
| `anonymous_id` | string | UUID minted once per install |
| `session_id` | string | UUID regenerated on every cold start |

The `platform` field is what makes cross-platform reporting possible: filter on
`platform: "web"` for web-only numbers, or group by it to compare the two.

**Fields that do not apply on mobile.** `user_agent`, `referrer` and `network`
have no mobile equivalent — there is no user-agent string to read and no
per-request referrer — so they are omitted rather than sent empty. `device_type`
is constant rather than derived. `anonymous_id` is stored in AsyncStorage, the
app-scoped sandboxed equivalent of `localStorage`; it is deliberately **not** in
`expo-secure-store`, which is for credentials and this is not one.

### 10.2 Mobile-only events

These interactions exist only in the app. They are named with the same
`Noun Verb` convention as §2 and are additive to the catalog above.

| Event | Journey | Fired when |
|---|---|---|
| `Screen Viewed` | `shared` | A top-level screen is opened. `screen` names it (`home_index`, `onboarding`, `claim_token_entry`, `claim_success`, `sender_dashboard`, `send_create`, `security_setup`) |
| `Crash Reported` | `shared` | The root `ErrorBoundary` catches a render-time crash. Carries `error_name`, `error_code`, `component` (top frame of the component stack) and `recoverable` |
| `Notification Opened` | `shared` | The recipient opens one notification. Carries `notification_type` (`payment`, `message`, `general`, `unknown`) — never the notification id |
| `Notifications Cleared` | `shared` | Unread count reaches zero. Carries `source` (`read_all` / `last_read`) and `unread_before` |
| `Language Detected` | `shared` | A message language is determined. Carries `language`, `detection_source` (`auto` / `manual_override`) and `confidence` |
| `Theme Changed` | `shared` | The theme preference changes. Carries `from` and `to` (`light` / `dark` / `system`) |
| `Login Completed` | `shared` | Biometric or PIN authentication succeeds. Carries `method` (`biometric` / `pin`) |
| `Login Failed` | `shared` | Biometric or PIN authentication fails. Carries `method` and a coarse `reason` (`denied`, `incorrect_pin`, `unavailable`) — never a raw error message |

`Login Completed` / `Login Failed` cover the mobile security setup surface
(`app/security/index.tsx`), where a sensitive action is unlocked by biometrics
with a PIN fallback. They are the mobile analogue of a web authentication
success/failure pair and are deliberately split rather than merged into one
event with a `result` field, matching the `Claim Succeeded` / `Claim Failed`
convention in §5.3.

`Crash Reported` is deliberately **not** `Error Displayed`. The §6 event is for
expected, in-flow failures the app can explain to the user (invalid token,
network unreachable); a caught crash is a defect, and merging the two makes an
unexpected crash invisible in an error rate. The error *message* is not sent —
it can contain whatever was in scope at the throw site, including user input —
so the error class name plus the topmost component are used instead.

### 10.3 Environment and delivery

- Events are dispatched only when `EXPO_PUBLIC_ENV` is not `development` **and**
  `EXPO_PUBLIC_ANALYTICS_ENDPOINT` is configured. A development build logs
  instead of sending; a production build with no endpoint configured warns once
  rather than discarding every event silently.
- Development status comes from `EXPO_PUBLIC_ENV`, the same signal
  `mobile/services/logger` gates on. It must not be derived from
  `Constants.appOwnership`: that is `expo` for every Expo Go session, including
  QA passes run against a release branch, which would downgrade a real build to
  console-only output and make QA event volume misleadingly low.
- `track()` never throws and never blocks the caller. A failed send is logged
  and dropped; telemetry must not be able to break a claim.

---

*Document version 1.0 — Analytics & Product Event Tracking Specification for Bridgelet*
*Author: See git history*
