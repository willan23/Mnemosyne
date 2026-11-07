import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import {
    readEnv,
    readSecret,
    stripeSecretKey,
    stripeWebhookSecret,
} from './params';

// Ensure Admin is ready even when this module loads before index.ts finishes init.
// Wrapped so unit tests can import pure helpers (assertAllowedRedirectUrl,
// processStripeWebhookRequest, tier functions) without GCP credentials.
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (error) {
        console.warn('firebase-admin initializeApp deferred (unit tests / missing ADC)');
    }
}

// IMPORTANTE: Usar europe-west1 para compatibilidade com extensão Stripe
const regionalFunctions = () => functions.region('europe-west1');
const STRIPE_API_VERSION = '2026-02-25.clover';

type BillingInterval = 'monthly' | 'yearly';
type BillingPlan = 'pro' | 'sovereign';
type SubscriptionTier = 'free' | 'pro' | 'sovereign';

const ENTITLED_STATUSES = new Set([
    'active',
    'trialing',
    'past_due',
]);

const SYNC_STATUS_PRIORITY = [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
    'canceled',
];

// Read the bound SecretParam at runtime; the SDK injects its environment value.
function getStripe(): Stripe {
    const stripeKey = readSecret(stripeSecretKey, 'STRIPE_SECRET_KEY');
    if (!stripeKey) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Stripe secret key is not configured.'
        );
    }
    return new Stripe(stripeKey, {
        apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
}

function getDb(): admin.firestore.Firestore {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    return admin.firestore();
}

const ALLOWED_REDIRECT_ORIGINS = new Set([
    'https://mnemosyne-one.com',
    'https://www.mnemosyne-one.com',
    'https://mnemosyne-one.web.app',
    'https://mnemosyne-one.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:1420',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:1420',
    'tauri://localhost',
]);

export function assertAllowedRedirectUrl(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new functions.https.HttpsError('invalid-argument', `${field} is required`);
    }
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new functions.https.HttpsError('invalid-argument', `${field} is not a valid URL`);
    }
    if (!ALLOWED_REDIRECT_ORIGINS.has(parsed.origin)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            `${field} origin is not allowlisted`
        );
    }
    return parsed.toString();
}

/**
 * Resolve the subscription period end in **milliseconds**.
 * Stripe API 2025-03+ moved `current_period_end` from the subscription to its
 * items; support both shapes and never produce NaN. Returns null when unknown.
 */
export function resolveSubscriptionPeriodEndMs(subscription: unknown): number | null {
    const sub = subscription as {
        current_period_end?: unknown;
        items?: { data?: Array<{ current_period_end?: unknown }> };
    } | null | undefined;

    const candidates: number[] = [];
    if (typeof sub?.current_period_end === 'number' && Number.isFinite(sub.current_period_end)) {
        candidates.push(sub.current_period_end);
    }
    for (const item of sub?.items?.data ?? []) {
        if (typeof item?.current_period_end === 'number' && Number.isFinite(item.current_period_end)) {
            candidates.push(item.current_period_end);
        }
    }

    const seconds = candidates.length ? Math.max(...candidates) : null;
    return seconds !== null && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Server-owned entitlements mirror consumed by firestore.rules/storage.rules.
 * Written only via Admin SDK (rules deny all client writes).
 */
export function buildEntitlementsPayload(tier: unknown, status: unknown): {
    tier: SubscriptionTier;
    status: string;
    effectiveTier: SubscriptionTier;
    canUploadAttachments: boolean;
    memoriesPerMonth: number;
    storageGB: number;
} {
    const normalizedTier = normalizeTier(tier);
    const normalizedStatus = typeof status === 'string' && status ? status : 'canceled';
    const effectiveTier = getEffectiveTier(normalizedTier, normalizedStatus);
    const limits = getSubscriptionLimits(effectiveTier);
    return {
        tier: normalizedTier,
        status: normalizedStatus,
        effectiveTier,
        canUploadAttachments: Boolean(limits.canUploadAttachments),
        memoriesPerMonth: limits.memoriesPerMonth,
        storageGB: limits.storageGB,
    };
}

export async function syncEntitlementsForUser(uid: string, tier: unknown, status: unknown): Promise<void> {
    await writeLiveBillingAccount(uid, {}, {
        ...buildEntitlementsPayload(tier, status),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/** Serialize webhook writes with the deletion marker; a delayed event cannot recreate a profile or entitlement. */
export async function writeLiveBillingAccount(uid: string, profileFields: FirebaseFirestore.DocumentData,
    entitlementFields?: FirebaseFirestore.DocumentData, notification?: { id: string; data: FirebaseFirestore.DocumentData }, db = getDb()): Promise<boolean> {
    return db.runTransaction(async tx => {
        const user = db.collection('users').doc(uid);
        const [profile, deletion] = await tx.getAll(user, db.collection('accountDeletions').doc(uid));
        if (!profile.exists || profile.data()?.deletionState === 'deleting' || deletion.exists) return false;
        if (Object.keys(profileFields).length) tx.set(user, profileFields, { merge: true });
        if (entitlementFields) tx.set(db.collection('entitlements').doc(uid), entitlementFields, { merge: true });
        if (notification) tx.set(db.collection('notifications').doc(notification.id), notification.data, { merge: true });
        return true;
    });
}

/**
 * Claim a Stripe event for exactly-once processing.
 * Returns false when the event was already processed.
 */
async function claimStripeEvent(event: Stripe.Event): Promise<boolean> {
    const ref = getDb().collection('processedStripeEvents').doc(event.id);
    try {
        await getDb().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists) {
                throw new Error('DUPLICATE_STRIPE_EVENT');
            }
            tx.set(ref, {
                type: event.type,
                livemode: event.livemode,
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        return true;
    } catch (error) {
        if (error instanceof Error && error.message === 'DUPLICATE_STRIPE_EVENT') {
            return false;
        }
        throw error;
    }
}

async function resolveUserRefByCustomerId(
    customerId: string,
    preferredUid?: string | null,
): Promise<FirebaseFirestore.DocumentReference | null> {
    if (preferredUid) {
        return getDb().collection('users').doc(preferredUid);
    }
    const usersSnapshot = await getDb().collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
    if (usersSnapshot.empty) return null;
    return usersSnapshot.docs[0].ref;
}

/** Billing cleanup must finish before the account and its billing identifiers are erased. */
export async function cancelStripeBillingForUser(uid: string): Promise<void> {
    const userDoc = await getDb().collection('users').doc(uid).get();
    const subscription = userDoc.data()?.subscription || {};
    const customerId = typeof subscription.stripeCustomerId === 'string'
        ? subscription.stripeCustomerId
        : null;
    const subscriptionId = typeof subscription.stripeSubscriptionId === 'string'
        ? subscription.stripeSubscriptionId
        : null;

    if (!customerId && !subscriptionId) return;

    const stripe = getStripe();

    if (subscriptionId) {
        try {
            const current = await stripe.subscriptions.retrieve(subscriptionId);
            if (current.status !== 'canceled') await stripe.subscriptions.cancel(subscriptionId);
            console.log('Stripe subscription canceled');
        } catch (error) {
            if ((error as { code?: string }).code !== 'resource_missing') throw error;
        }
    }

    if (customerId) {
        try {
            await stripe.customers.del(customerId);
            console.log('Stripe customer deleted');
        } catch (error) {
            if ((error as { code?: string }).code !== 'resource_missing') throw error;
        }
    }
}

/**
 * Create Stripe Checkout Session
 */
export const createCheckoutSession = regionalFunctions().runWith({ secrets: [stripeSecretKey] }).https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    const successUrl = assertAllowedRedirectUrl(data?.successUrl, 'successUrl');
    const cancelUrl = assertAllowedRedirectUrl(data?.cancelUrl, 'cancelUrl');
    const uid = context.auth.uid;
    const email = context.auth.token?.email || undefined;
    const checkoutPlan = resolveCheckoutPlan(data);

    try {
        // Get or create Stripe customer (never trust client-supplied customer IDs)
        const userDoc = await getDb().collection('users').doc(uid).get();
        if (!userDoc.exists || userDoc.data()?.deletionState === 'deleting' || (await getDb().doc(`accountDeletions/${uid}`).get()).exists) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
        let customerId = userDoc.data()?.subscription?.stripeCustomerId;

        if (!customerId) {
            const customer = await getStripe().customers.create({
                email: email || undefined,
                metadata: {
                    firebaseUID: uid
                }
            });
            customerId = customer.id;

            // Save customer ID
            const saved = await writeLiveBillingAccount(uid, {
                subscription: {
                    stripeCustomerId: customerId
                }
            });
            if (!saved) { await getStripe().customers.del(customerId); throw new functions.https.HttpsError('failed-precondition', 'Account unavailable'); }
        }

        // Create checkout session
        const session = await getStripe().checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [
                {
                    price: checkoutPlan.priceId,
                    quantity: 1,
                },
            ],
            allow_promotion_codes: true,
            success_url: successUrl,
            cancel_url: cancelUrl,
            subscription_data: {
                metadata: {
                    firebaseUID: uid,
                    tier: checkoutPlan.tier,
                    billingInterval: checkoutPlan.interval,
                }
            },
            metadata: {
                firebaseUID: uid,
                tier: checkoutPlan.tier,
                billingInterval: checkoutPlan.interval,
            }
        });

        return {
            sessionId: session.id,
            url: session.url
        };
    } catch (error) {
        console.error('Error creating checkout session');

        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        throw new functions.https.HttpsError(
            'aborted',
            'Stripe checkout unavailable'
        );
    }
});

/**
 * Create Billing Portal Session
 */
export const createBillingPortalSession = regionalFunctions().runWith({ secrets: [stripeSecretKey] }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    const returnUrl = assertAllowedRedirectUrl(data?.returnUrl, 'returnUrl');
    const uid = context.auth.uid;

    try {
        const userDoc = await getDb().collection('users').doc(uid).get();
        const customerId = userDoc.data()?.subscription?.stripeCustomerId;

        if (!customerId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'No Stripe customer found'
            );
        }

        const session = await getStripe().billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });

        return {
            url: session.url
        };
    } catch {
        console.error('Error creating billing portal session');
        throw new functions.https.HttpsError(
            'internal',
            'Failed to create billing portal session'
        );
    }
});

/**
 * Get Subscription Status & Sync with Stripe
 */
export const getSubscriptionStatus = regionalFunctions().runWith({ secrets: [stripeSecretKey] }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    const uid = context.auth.uid;
    let userData: any = {};
    let subscription: any = {};

    try {
        const userDocRef = getDb().collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        userData = (userDoc.data() || {}) as any;
        subscription = userData.subscription || {};

        // SYNC: Check with Stripe if we have a customer ID
        if (subscription.stripeCustomerId) {
            try {
                console.log('Syncing Stripe subscription');

                const stripe = getStripe();
                const subscriptions = await stripe.subscriptions.list({
                    customer: subscription.stripeCustomerId,
                    status: 'all',
                    limit: 10
                });

                const syncedSubscription = pickCurrentSubscription(subscriptions.data);

                if (syncedSubscription) {
                    const activeSub = syncedSubscription as any;
                    const tier = determineTier(syncedSubscription);
                    const effectiveTier = getEffectiveTier(tier, syncedSubscription.status);
                    const periodEndMs = resolveSubscriptionPeriodEndMs(syncedSubscription);

                    // Update Firestore if needed
                    if (
                        tier !== normalizeTier(subscription.tier) ||
                        activeSub.status !== subscription.status ||
                        subscription.tier === 'business'
                    ) {
                        console.log(`✅ Detected change via sync! Updating to ${tier}/${activeSub.status}`);

                        await writeLiveBillingAccount(uid, {
                            subscription: {
                                stripeSubscriptionId: activeSub.id,
                                tier,
                                status: activeSub.status,
                                ...(periodEndMs !== null
                                    ? { currentPeriodEnd: admin.firestore.Timestamp.fromMillis(periodEndMs) }
                                    : {}),
                                cancelAtPeriodEnd: activeSub.cancel_at_period_end || false
                            }
                        });

                        await syncEntitlementsForUser(uid, tier, activeSub.status);

                        // Return updated data immediately
                        return {
                            tier,
                            status: activeSub.status,
                            currentPeriodEnd: periodEndMs,
                            cancelAtPeriodEnd: activeSub.cancel_at_period_end || false,
                            limits: getSubscriptionLimits(effectiveTier),
                            usage: {
                                memoriesThisMonth: userData.usage?.memoriesThisMonth || 0,
                                storageUsedMB: userData.usage?.storageUsedMB || 0
                            }
                        };
                    }
                }
            } catch {
                console.error('Stripe sync failed, falling back to cached data');
            }
        }

        const usage = userData.usage || {};
        const tier = normalizeTier(subscription.tier || 'free');
        const status = subscription.status || 'active';
        const effectiveTier = getEffectiveTier(tier, status);

        // Determine limits based on tier
        const limits = getSubscriptionLimits(effectiveTier);

        return {
            tier,
            status,
            currentPeriodEnd: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toMillis() : null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
            limits,
            usage: {
                memoriesThisMonth: usage.memoriesThisMonth || 0,
                storageUsedMB: usage.storageUsedMB || 0
            }
        };

    } catch {
        console.error('Error getting subscription status');
        throw new functions.https.HttpsError(
            'internal',
            'Failed to get subscription status'
        );
    }
});

/**
 * Handle Stripe Webhooks
 *
 * The request pipeline is factored into processStripeWebhookRequest with
 * injectable dependencies so unit tests can exercise signature verification,
 * idempotency and dispatch/rollback behaviour without live Firestore/Stripe.
 */

export interface StripeWebhookLikeRequest {
    headers: Record<string, unknown>;
    rawBody: Buffer | string;
}

export interface StripeWebhookLikeResponse {
    status: (code: number) => StripeWebhookLikeResponse;
    send: (body?: unknown) => unknown;
    json: (body?: unknown) => unknown;
}

export interface StripeWebhookDeps {
    webhookSecret: string;
    constructEvent: (rawBody: Buffer | string, signature: string, secret: string) => Stripe.Event;
    claimEvent: (event: Stripe.Event) => Promise<boolean>;
    releaseEventClaim: (event: Stripe.Event) => Promise<void>;
    dispatchEvent: (event: Stripe.Event) => Promise<void>;
}

export async function processStripeWebhookRequest(
    req: StripeWebhookLikeRequest,
    res: StripeWebhookLikeResponse,
    deps: StripeWebhookDeps,
): Promise<void> {
    const sig = typeof req.headers['stripe-signature'] === 'string'
        ? req.headers['stripe-signature'] as string
        : '';

    if (!sig || !deps.webhookSecret) {
        console.error('Stripe webhook rejected: missing signature or webhook secret.');
        res.status(400).send('Webhook signature or secret is not configured');
        return;
    }

    let event: Stripe.Event;

    try {
        event = deps.constructEvent(req.rawBody, sig, deps.webhookSecret);
    } catch {
        console.error('Webhook signature verification failed');
        res.status(400).send('Webhook signature invalid');
        return;
    }

    console.log('Received Stripe webhook', { type: event.type });

    try {
        const claimed = await deps.claimEvent(event);
        if (!claimed) {
            console.log('Skipping duplicate Stripe webhook');
            res.json({ received: true, duplicate: true });
            return;
        }

        await deps.dispatchEvent(event);
        res.json({ received: true });
    } catch {
        console.error('Error processing Stripe webhook');
        // Allow Stripe to retry; remove claim so a later attempt can reprocess.
        try {
            await deps.releaseEventClaim(event);
        } catch {
            console.warn('Failed to release Stripe event claim');
        }
        res.status(500).send('Webhook processing failed');
    }
}

export async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
            break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
            break;

        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
            break;

        case 'invoice.payment_succeeded':
            await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
            break;

        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object as Stripe.Invoice);
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }
}

export const handleStripeWebhook = regionalFunctions().runWith({ secrets: [stripeSecretKey, stripeWebhookSecret] }).https.onRequest(async (req, res) => {
    await processStripeWebhookRequest(req, res, {
        webhookSecret: readSecret(stripeWebhookSecret, 'STRIPE_WEBHOOK_SECRET'),
        constructEvent: (rawBody, signature, secret) => getStripe().webhooks.constructEvent(rawBody, signature, secret),
        claimEvent: claimStripeEvent,
        releaseEventClaim: async (event) => {
            await getDb().collection('processedStripeEvents').doc(event.id).delete();
        },
        dispatchEvent: dispatchStripeEvent,
    });
});

// Helper functions

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const uid = session.metadata?.firebaseUID;
    if (!uid) return;

    console.log('Stripe checkout completed');
    const metadataTier = normalizeTier(session.metadata?.tier);

    try {
        const subscriptionId = session.subscription as string;
        console.log('Fetching Stripe subscription after checkout');

        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
        console.log(`📦 [handleCheckoutCompleted] Subscription fetched. Status: ${subscription.status}`);

        const resolvedTier = determineTier(subscription);
        const tier = resolvedTier !== 'free' ? resolvedTier : metadataTier;
        console.log(`🏷️ [handleCheckoutCompleted] Determined tier: ${tier}`);

        const periodEndMs = resolveSubscriptionPeriodEndMs(subscription);

        await writeLiveBillingAccount(uid, {
            subscription: {
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: subscriptionId,
                status: subscription.status,
                tier: tier,
                ...(periodEndMs !== null
                    ? { currentPeriodEnd: admin.firestore.Timestamp.fromMillis(periodEndMs) }
                    : {}),
                cancelAtPeriodEnd: (subscription as any).cancel_at_period_end || false
            }
        });

        await syncEntitlementsForUser(uid, tier, subscription.status);

        console.log('Entitlements updated after Stripe checkout', { tier });
    } catch (error) {
        console.error('Error updating entitlements after Stripe checkout');

        // Never grant an active/pro subscription on failure. Persist only the
        // Stripe identifiers (best-effort, so later webhooks can resolve this
        // user) and rethrow so Stripe retries the event; the corresponding
        // customer.subscription.* webhook is the source of truth for tier.
        try {
            await writeLiveBillingAccount(uid, {
                subscription: {
                    stripeCustomerId: session.customer as string,
                    stripeSubscriptionId: session.subscription as string,
                }
            });
        } catch {
            console.warn('Could not persist Stripe identifiers after checkout');
        }

        throw error;
    }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const preferredUid = subscription.metadata?.firebaseUID || null;
    const userRef = await resolveUserRefByCustomerId(customerId, preferredUid);

    if (!userRef) {
        console.error('No user found for Stripe customer');
        return;
    }

    const tier = determineTier(subscription);

    const periodEndMs = resolveSubscriptionPeriodEndMs(subscription);
    const timestamp = periodEndMs !== null
        ? admin.firestore.Timestamp.fromMillis(periodEndMs)
        : admin.firestore.FieldValue.serverTimestamp();

    await writeLiveBillingAccount(userRef.id, {
        subscription: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            tier,
            status: subscription.status,
            currentPeriodEnd: timestamp,
            cancelAtPeriodEnd: (subscription as any).cancel_at_period_end || false
        }
    });

    await syncEntitlementsForUser(userRef.id, tier, subscription.status);

    console.log('Stripe subscription updated', { tier });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const preferredUid = subscription.metadata?.firebaseUID || null;
    const userRef = await resolveUserRefByCustomerId(customerId, preferredUid);

    if (!userRef) return;

    await writeLiveBillingAccount(userRef.id, {
        subscription: {
            tier: 'free',
            status: 'canceled',
            cancelAtPeriodEnd: false
        }
    });

    await syncEntitlementsForUser(userRef.id, 'free', 'canceled');

    console.log('Stripe subscription deleted; tier set to free');
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
    console.log('Stripe invoice payment succeeded');
    // Could send confirmation email here
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
    console.log('Stripe invoice payment failed');

    const customerId = invoice.customer as string;
    const userRef = await resolveUserRefByCustomerId(customerId);

    if (!userRef) return;

    const currentTier = (await userRef.get()).data()?.subscription?.tier;

    // Deterministic doc id keyed by the invoice makes retries/redeliveries
    // idempotent (no duplicate notifications for the same failed invoice).
    const invoiceKey = String(invoice.id || 'unknown').replace(/[^\w-]/g, '_').slice(0, 900);
    await writeLiveBillingAccount(userRef.id, { subscription: { status: 'past_due' } }, {
        ...buildEntitlementsPayload(currentTier, 'past_due'), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { id: `payment-failed-${invoiceKey}`, data: {
        uid: userRef.id,
        type: 'payment_failed',
        title: 'Falha no Pagamento',
        message: 'Houve um problema com o seu pagamento. Por favor, atualize seu método de pagamento.',
        read: false,
        invoiceId: invoice.id || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    } });
}

function getStripeConfigValue(key: string): string | undefined {
    return readEnv(`STRIPE_${key.toUpperCase()}`);
}

function getSovereignConfigValue(interval: BillingInterval): string | undefined {
    return getStripeConfigValue(`price_sovereign_${interval}`) ||
        getStripeConfigValue(`price_business_${interval}`);
}

function getConfiguredPrices(): Record<BillingPlan, Record<BillingInterval, string | undefined>> {
    return {
        pro: {
            monthly: getStripeConfigValue('price_pro_monthly'),
            yearly: getStripeConfigValue('price_pro_yearly'),
        },
        sovereign: {
            monthly: getSovereignConfigValue('monthly'),
            yearly: getSovereignConfigValue('yearly'),
        },
    };
}

function normalizeBillingPlan(plan: unknown): BillingPlan | null {
    if (plan === 'pro') return 'pro';
    if (plan === 'sovereign' || plan === 'business') return 'sovereign';
    return null;
}

function normalizeBillingInterval(interval: unknown): BillingInterval | null {
    if (interval === 'monthly' || interval === 'yearly') return interval;
    return null;
}

export function normalizeTier(tier: unknown): SubscriptionTier {
    if (tier === 'pro') return 'pro';
    if (tier === 'sovereign' || tier === 'business') return 'sovereign';
    return 'free';
}

function resolveCheckoutPlan(data: any): { priceId: string; tier: BillingPlan; interval: BillingInterval } {
    const tier = normalizeBillingPlan(data?.planId);
    const interval = normalizeBillingInterval(data?.billingInterval || 'monthly');

    if (!tier || !interval) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Checkout requires a valid planId (pro or sovereign) and billingInterval (monthly or yearly).'
        );
    }

    const priceId = getConfiguredPrices()[tier][interval];
    if (!priceId) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `Stripe price is not configured for ${tier}/${interval}.`
        );
    }

    return { priceId, tier, interval };
}

export function findTierForPrice(
    priceId: string | undefined,
    prices: Record<BillingPlan, Record<BillingInterval, string | undefined>>,
    historical: Partial<Record<BillingPlan, readonly string[]>> = {},
): SubscriptionTier {
    if (!priceId) return 'free';

    const matches = (['pro', 'sovereign'] as const).filter(plan =>
        Object.values(prices[plan]).includes(priceId) || historical[plan]?.includes(priceId));
    if (matches.length === 1) return matches[0];

    console.warn('Unknown or ambiguous Stripe price; defaulting to free');
    return 'free';
}

/** Historical IDs only preserve entitlements; checkout always uses the current configured price. */
export function parseHistoricalStripePriceIds(raw: string | undefined): string[] {
    if (!raw || raw.length > 16_384) return [];
    try {
        const ids: unknown = JSON.parse(raw);
        if (!Array.isArray(ids) || ids.length > 100 ||
            !ids.every(id => typeof id === 'string' && /^price_[A-Za-z0-9]{6,100}$/.test(id))) return [];
        return [...new Set(ids)] as string[];
    } catch { return []; }
}

function findTierByPriceId(priceId: string | undefined): SubscriptionTier {
    return findTierForPrice(priceId, getConfiguredPrices(), {
        pro: parseHistoricalStripePriceIds(readEnv('STRIPE_HISTORICAL_PRICE_PRO_IDS')),
        sovereign: parseHistoricalStripePriceIds(readEnv('STRIPE_HISTORICAL_PRICE_SOVEREIGN_IDS')),
    });
}

function pickCurrentSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
    const sorted = [...subscriptions].sort((a, b) => {
        const aPriority = SYNC_STATUS_PRIORITY.indexOf(a.status);
        const bPriority = SYNC_STATUS_PRIORITY.indexOf(b.status);
        const priorityDelta = (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
        if (priorityDelta !== 0) return priorityDelta;
        return b.created - a.created;
    });

    return sorted[0] || null;
}

export function getEffectiveTier(tier: SubscriptionTier, status: string): SubscriptionTier {
    if (tier === 'free') return 'free';
    return ENTITLED_STATUSES.has(status) ? tier : 'free';
}

export function determineTier(subscription: Stripe.Subscription): SubscriptionTier {
    const priceId = subscription.items.data[0]?.price.id;

    console.log('Checking Stripe price tier');
    return findTierByPriceId(priceId);
}

export function getSubscriptionLimits(tier: string) {
    const limits = {
        free: {
            memoriesPerMonth: 30,
            storageGB: 1,
            canUploadAttachments: false,
            canSharePrivately: false,
            hasNotifications: false,
            hasAdvancedAnalytics: false
        },
        pro: {
            memoriesPerMonth: -1, // unlimited
            storageGB: 50,
            canUploadAttachments: true,
            canSharePrivately: true,
            hasNotifications: true,
            hasAdvancedAnalytics: true
        },
        sovereign: {
            memoriesPerMonth: -1, // unlimited
            storageGB: 500,
            canUploadAttachments: true,
            canSharePrivately: true,
            hasNotifications: true,
            hasAdvancedAnalytics: true,
            hasAPIAccess: true,
            maxTeamMembers: 10
        }
    };

    return limits[tier as keyof typeof limits] || limits.free;
}
