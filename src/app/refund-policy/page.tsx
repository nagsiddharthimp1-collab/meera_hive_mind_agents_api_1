import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Refunds, cancellations and delivery | Meera',
  description: 'How Meera digital access is delivered, how to request a refund, and lifetime access.',
};

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-16 text-primary sm:px-9">
      <div className="mx-auto max-w-3xl space-y-7 leading-7">
        <Link href="/sign-in" className="text-sm font-semibold underline underline-offset-4">
          ← Back to Meera
        </Link>
        <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Refunds, cancellations and delivery</h1>
        <p>Meera is a digital service sold by Meera Labs Inc. No physical goods are shipped.</p>
        <section>
          <h2 className="text-2xl font-semibold">Delivery</h2>
          <p className="mt-2">
            Paid access is made available in your Meera account after payment is confirmed. If access does not appear,
            contact support with your account email and purchase details.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">Cancellation</h2>
          <p className="mt-2">
            Lifetime access costs ₹499 in India through Cashfree or US$99 internationally through Stripe. This is a
            one-time purchase. It does not renew automatically, so no cancellation is needed to stop future charges.
            Previously purchased 30-day access remains valid for its original term and does not renew automatically.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">Refunds and payment disputes</h2>
          <p className="mt-2">
            Purchases are generally non-refundable unless required by applicable law. To request a refund or report an
            unrecognized charge, email{' '}
            <a href="mailto:siddharth.nag@himeera.com" className="underline underline-offset-4">
              siddharth.nag@himeera.com
            </a>{' '}
            with your account email, purchase date, and reason for the request. We will investigate and respond by
            email. If a refund is approved, it will be sent to the original payment method within 7 working days.
          </p>
        </section>
        <footer className="flex flex-wrap gap-6 border-t border-primary/15 pt-6 text-sm">
          <Link href="/pricing" className="underline underline-offset-4">
            Pricing
          </Link>
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
        </footer>
      </div>
    </main>
  );
}
