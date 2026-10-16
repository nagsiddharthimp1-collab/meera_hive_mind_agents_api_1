import { fulfillStripeSession, getStripe, restoreStripePayment, revokeStripePayment } from '@/lib/stripePayments';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      request.headers.get('stripe-signature') ?? '',
      secret,
    );
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await fulfillStripeSession(event.data.object);
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (charge.refunded && intent) await revokeStripePayment(intent, 'refunded');
    } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      const dispute = await getStripe().disputes.retrieve(event.data.object.id);
      const intent = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
      if (intent) {
        if (dispute.status === 'won' || dispute.status === 'warning_closed') await restoreStripePayment(intent);
        else await revokeStripePayment(intent, 'disputed');
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe event processing failed', event.id, error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Event processing failed; retry required' }, { status: 500 });
  }
}
