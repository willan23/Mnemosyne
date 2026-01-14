import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// IMPORTANTE: Usar europe-west1 para compatibilidade com extensão Stripe
const regionalFunctions = functions.region('europe-west1');

// Get Stripe instance with key from Firebase config (lazy initialization)
function getStripe(): Stripe {
    const stripeKey = functions.config().stripe?.secret_key || process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
    return new Stripe(stripeKey);
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

    const { priceId, successUrl, cancelUrl } = data;
    const uid = context.auth.uid;
    const email = context.auth.token?.email || undefined;

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
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                firebaseUID: uid
            }
        });

        return {
            sessionId: session.id,
            url: session.url
        };
    } catch (error) {
        console.error('Error creating checkout session:', error);
        throw new functions.https.HttpsError(
            'internal',
            'Failed to create checkout session'
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
                    status: 'active',
                    limit: 1
                });

                if (subscriptions.data.length > 0) {
                    const activeSub = subscriptions.data[0] as any;
                    const tier = determineTier(activeSub);

                    // Update Firestore if needed
                    if (tier !== subscription.tier || activeSub.status !== subscription.status) {
                        console.log(`✅ Detected change via sync! Updating to ${tier}`);

                        await userDocRef.set({
                            subscription: {
                                stripeSubscriptionId: activeSub.id,
                                tier,
                                status: activeSub.status,
                                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(activeSub.current_period_end * 1000),
                                cancelAtPeriodEnd: activeSub.cancel_at_period_end
                            }
                        }, { merge: true });

                        // Return updated data immediately
                        return {
                            tier,
                            status: activeSub.status,
                            currentPeriodEnd: activeSub.current_period_end * 1000,
                            cancelAtPeriodEnd: activeSub.cancel_at_period_end,
                            limits: getSubscriptionLimits(tier),
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

        // Determine limits based on tier
        const limits = getSubscriptionLimits(subscription.tier || 'free');

        return {
            tier: subscription.tier || 'free',
            status: subscription.status || 'active',
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
    const webhookSecret = functions.config().stripe?.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '';

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

    await db.collection('users').doc(uid).set({
        subscription: {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            status: 'active'
        }
    }, { merge: true });
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

    await userDoc.ref.set({
        subscription: {
            stripeSubscriptionId: subscription.id,
            tier,
            status: subscription.status,
            currentPeriodEnd: admin.firestore.Timestamp.fromMillis((subscription as any).current_period_end * 1000),
            cancelAtPeriodEnd: (subscription as any).cancel_at_period_end
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

function determineTier(subscription: Stripe.Subscription): 'free' | 'pro' | 'business' {
    const priceId = subscription.items.data[0]?.price.id;

    // Match price IDs from environment variables
    // Match price IDs from environment variables OR hardcoded fallbacks form config
    if (priceId === (functions.config().stripe?.price_pro_monthly || process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_1SiN8nPOfX00FmXdekXeO1Gu') ||
        priceId === (functions.config().stripe?.price_pro_yearly || process.env.STRIPE_PRICE_PRO_YEARLY || 'price_1SiNEmPOfX00FmXdl5wNHgQz')) {
        return 'pro';
    }

    if (priceId === (functions.config().stripe?.price_business_monthly || process.env.STRIPE_PRICE_BUSINESS_MONTHLY || 'price_1SiNHHPOfX00FmXdC36rjbD9') ||
        priceId === (functions.config().stripe?.price_business_yearly || process.env.STRIPE_PRICE_BUSINESS_YEARLY || 'price_1SiNICPOfX00FmXdLCaQeLSl')) {
        return 'business';
    }

    return 'free';
}

function getSubscriptionLimits(tier: string) {
    const limits = {
        free: {
            memoriesPerMonth: 30, // Reduced from 50 to 30
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
        business: {
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
