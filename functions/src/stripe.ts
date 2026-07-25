import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// IMPORTANTE: Usar europe-west1 para compatibilidade com extensão Stripe
const regionalFunctions = functions.region('europe-west1');
const STRIPE_API_VERSION = '2026-02-25.clover';

const getRuntimeConfig = (): Record<string, any> => {
    const compatFunctions = functions as unknown as { config?: () => Record<string, any> };
    return typeof compatFunctions.config === 'function' ? compatFunctions.config() : {};
};

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

// Get Stripe instance with key from Firebase config (lazy initialization)
function getStripe(): Stripe {
    const stripeKey = getRuntimeConfig().stripe?.secret_key || process.env.STRIPE_SECRET_KEY;
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

const db = admin.firestore();

/**
 * Create Stripe Checkout Session
 */
export const createCheckoutSession = regionalFunctions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    const { successUrl, cancelUrl } = data;
    const uid = context.auth.uid;
    const email = context.auth.token?.email || undefined;
    const checkoutPlan = resolveCheckoutPlan(data);

    try {
        // Get or create Stripe customer
        const userDoc = await db.collection('users').doc(uid).get();
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
            await db.collection('users').doc(uid).set({
                subscription: {
                    stripeCustomerId: customerId
                }
            }, { merge: true });
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
    } catch (error: any) {
        console.error('Error creating checkout session:', error);
        console.error('Request Data:', {
            planId: data?.planId,
            billingInterval: data?.billingInterval,
            successUrl,
            cancelUrl
        });
        console.error('Stripe Config:', {
            keyStart: getRuntimeConfig().stripe?.secret_key?.substring(0, 8),
            envKeyStart: process.env.STRIPE_SECRET_KEY?.substring(0, 8)
        });

        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        throw new functions.https.HttpsError(
            'aborted',
            `Stripe Error: ${error.message}`
        );
    }
});

/**
 * Create Billing Portal Session
 */
export const createBillingPortalSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    const { returnUrl } = data;
    const uid = context.auth.uid;

    try {
        const userDoc = await db.collection('users').doc(uid).get();
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
    } catch (error) {
        console.error('Error creating billing portal session:', error);
        throw new functions.https.HttpsError(
            'internal',
            'Failed to create billing portal session'
        );
    }
});

/**
 * Get Subscription Status & Sync with Stripe
 */
export const getSubscriptionStatus = regionalFunctions.https.onCall(async (data, context) => {
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
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        userData = (userDoc.data() || {}) as any;
        subscription = userData.subscription || {};

        // SYNC: Check with Stripe if we have a customer ID
        if (subscription.stripeCustomerId) {
            try {
                console.log(`🔄 Syncing subscription for user ${uid} with customer ${subscription.stripeCustomerId}`);

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

                    // Update Firestore if needed
                    if (
                        tier !== normalizeTier(subscription.tier) ||
                        activeSub.status !== subscription.status ||
                        subscription.tier === 'business'
                    ) {
                        console.log(`✅ Detected change via sync! Updating to ${tier}/${activeSub.status}`);

                        await userDocRef.set({
                            subscription: {
                                stripeSubscriptionId: activeSub.id,
                                tier,
                                status: activeSub.status,
                                currentPeriodEnd: admin.firestore.Timestamp.fromMillis((activeSub.current_period_end || Date.now() / 1000) * 1000),
                                cancelAtPeriodEnd: activeSub.cancel_at_period_end || false
                            }
                        }, { merge: true });

                        // Return updated data immediately
                        return {
                            tier,
                            status: activeSub.status,
                            currentPeriodEnd: activeSub.current_period_end * 1000,
                            cancelAtPeriodEnd: activeSub.cancel_at_period_end,
                            limits: getSubscriptionLimits(effectiveTier),
                            usage: {
                                memoriesThisMonth: userData.usage?.memoriesThisMonth || 0,
                                storageUsedMB: userData.usage?.storageUsedMB || 0
                            }
                        };
                    }
                }
            } catch (syncError: any) {
                console.error('⚠️ Sync failed, falling back to cached data:', syncError);
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

    } catch (error) {
        console.error('CRITICAL Error getting subscription status:', error);
        throw new functions.https.HttpsError(
            'internal',
            'Failed to get subscription status',
            error
        );
    }
});

/**
 * Handle Stripe Webhooks
 */
export const handleStripeWebhook = regionalFunctions.https.onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = getRuntimeConfig().stripe?.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '';

    if (!sig || !webhookSecret) {
        console.error('Stripe webhook rejected: missing signature or webhook secret.');
        res.status(400).send('Webhook signature or secret is not configured');
        return;
    }

    let event: Stripe.Event;

    try {
        event = getStripe().webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err);
        res.status(400).send(`Webhook Error: ${err}`);
        return;
    }

    console.log(`Received webhook: ${event.type}`);

    try {
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

        res.json({ received: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Webhook processing failed');
    }
});

// Helper functions

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const uid = session.metadata?.firebaseUID;
    if (!uid) return;

    console.log(`Checkout completed for user: ${uid}`);

    try {
        const subscriptionId = session.subscription as string;
        console.log(`🔍 [handleCheckoutCompleted] Fetching subscription: ${subscriptionId}`);

        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
        console.log(`📦 [handleCheckoutCompleted] Subscription fetched. Status: ${subscription.status}`);

        const tier = determineTier(subscription);
        console.log(`🏷️ [handleCheckoutCompleted] Determined tier: ${tier}`);

        await db.collection('users').doc(uid).set({
            subscription: {
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: subscriptionId,
                status: subscription.status,
                tier: tier,
                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(((subscription as any).current_period_end || Date.now() / 1000) * 1000),
                cancelAtPeriodEnd: (subscription as any).cancel_at_period_end || false
            }
        }, { merge: true });

        console.log(`✅ User ${uid} upgraded to ${tier} immediately after checkout`);
    } catch (error) {
        console.error('❌ [handleCheckoutCompleted] Error updating user after checkout:', error);

        // Try to recover tier from session if possible (e.g. from metadata if we added it, or default to checking price)
        // For now, defaulting to 'pro' if we can't determine, just to UNBLOCK the user if it's a critical failure?
        // No, better to log detailed error.

        // Fallback: just set the basics if fetch fails
        await db.collection('users').doc(uid).set({
            subscription: {
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: session.subscription as string,
                status: 'active'
                // Missing tier here is why it falls back to free
            }
        }, { merge: true });
    }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Find user by customer ID
    const usersSnapshot = await db.collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (usersSnapshot.empty) {
        console.error('No user found for customer:', customerId);
        return;
    }

    const userDoc = usersSnapshot.docs[0];
    const tier = determineTier(subscription);

    const currentPeriodEnd = (subscription as any).current_period_end;
    const timestamp = currentPeriodEnd
        ? admin.firestore.Timestamp.fromMillis(currentPeriodEnd * 1000)
        : admin.firestore.FieldValue.serverTimestamp();

    await userDoc.ref.set({
        subscription: {
            stripeSubscriptionId: subscription.id,
            tier,
            status: subscription.status,
            currentPeriodEnd: timestamp,
            cancelAtPeriodEnd: (subscription as any).cancel_at_period_end || false
        }
    }, { merge: true });

    console.log(`Subscription updated for user: ${userDoc.id}, tier: ${tier}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    const usersSnapshot = await db.collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (usersSnapshot.empty) return;

    const userDoc = usersSnapshot.docs[0];

    await userDoc.ref.set({
        subscription: {
            tier: 'free',
            status: 'canceled',
            cancelAtPeriodEnd: false
        }
    }, { merge: true });

    console.log(`Subscription deleted, downgraded to free: ${userDoc.id}`);
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
    console.log(`Payment succeeded for invoice: ${invoice.id}`);
    // Could send confirmation email here
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
    console.log(`Payment failed for invoice: ${invoice.id}`);

    const customerId = invoice.customer as string;

    const usersSnapshot = await db.collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (usersSnapshot.empty) return;

    const userDoc = usersSnapshot.docs[0];

    await userDoc.ref.set({
        subscription: {
            status: 'past_due'
        }
    }, { merge: true });

    // Create notification
    await db.collection('notifications').add({
        uid: userDoc.id,
        type: 'payment_failed',
        title: 'Falha no Pagamento',
        message: 'Houve um problema com o seu pagamento. Por favor, atualize seu método de pagamento.',
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

function getStripeConfigValue(key: string): string | undefined {
    return getRuntimeConfig().stripe?.[key] || process.env[`STRIPE_${key.toUpperCase()}`];
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

function normalizeTier(tier: unknown): SubscriptionTier {
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

function findTierByPriceId(priceId: string | undefined): SubscriptionTier {
    if (!priceId) return 'free';

    const prices = getConfiguredPrices();
    for (const plan of Object.keys(prices) as BillingPlan[]) {
        const matchesPlan = Object.values(prices[plan]).some((configuredPriceId) => configuredPriceId === priceId);
        if (matchesPlan) return plan;
    }

    console.warn(`⚠️ [determineTier] No match found for ${priceId}, defaulting to free`);
    return 'free';
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

function getEffectiveTier(tier: SubscriptionTier, status: string): SubscriptionTier {
    if (tier === 'free') return 'free';
    return ENTITLED_STATUSES.has(status) ? tier : 'free';
}

function determineTier(subscription: Stripe.Subscription): SubscriptionTier {
    const priceId = subscription.items.data[0]?.price.id;

    console.log(`🧐 [determineTier] Checking PriceID: ${priceId}`);
    return findTierByPriceId(priceId);
}

function getSubscriptionLimits(tier: string) {
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
