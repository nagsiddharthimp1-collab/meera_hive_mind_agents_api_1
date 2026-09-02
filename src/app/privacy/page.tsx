'use client';

import { H1 } from '@/components/ui/Typography';

// import { Navbar } from '@/app/about/components/Navbar';
// import { Footer } from '@/app/about/components/Footer';

export default function Privacy() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME;
  const appNameOS = `${appName} OS`;

  return (
    <main className="flex-auto bg-white">
      {/* <Navbar /> */}
      <div className="relative py-16 sm:py-24 px-4 sm:px-8 md:px-16 mx-auto max-w-4xl">
        <div className="mx-auto">
          <H1 className="text-3xl sm:text-4xl font-bold tracking-tight text-primary mb-10 font-sans">
            Privacy Policy for {appNameOS}
          </H1>
          <div className="mt-10 space-y-7 text-base text-primary/80">
            <p>Effective Date: 1/1/2025</p>
            <p>
              At {appNameOS}, we value your privacy and are committed to protecting your personal data. This privacy
              policy outlines how we collect, use, store, and protect your information when you use our services.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">1. Information We Collect</h2>
            <p>We collect the following types of information to provide and improve the {appNameOS} experience:</p>

            <h3 className="text-xl font-bold text-primary mt-8 mb-3">1.1. Personal Information You Provide</h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Account Information</strong>: Name, email address, and any details provided during registration.
              </li>
              <li>
                <strong>Preferences and Usage Data</strong>: Information shared through interactions with {appName},
                such as saved preferences, feedback, and usage patterns.
              </li>
            </ul>

            <h3 className="text-xl font-bold text-primary mt-8 mb-3">1.2. Automatically Collected Information</h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Device Information</strong>: Type of device, operating system, browser type, and IP address.
              </li>
              <li>
                <strong>Usage Data</strong>: Interaction logs, including feature usage, timestamps, and errors for
                performance improvements.
              </li>
              <li>
                <strong>Cookies and Similar Technologies</strong>: Used to enhance your experience and personalize
                services.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">2. How We Use Your Information</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>To deliver and improve {appNameOS}&apos;s functionality, features, and performance.</li>
              <li>To personalize your interactions and recommendations within the {appName}-Verse.</li>
              <li>To communicate updates, promotions, or changes to services.</li>
              <li>To ensure the security and integrity of our platform.</li>
              <li>To comply with legal requirements.</li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">3. How We Protect Your Information</h2>
            <p>We prioritize the security of your data by implementing industry-standard practices:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Encryption</strong>: All communications are encrypted in transit and at rest using
                state-of-the-art protocols.
              </li>
              <li>
                <strong>Local-First Processing</strong>: Most data is processed locally on your device to minimize
                server dependencies.
              </li>
              <li>
                <strong>Access Controls</strong>: Restricted access to your data, ensuring only authorized personnel can
                access it.
              </li>
              <li>
                <strong>Data Minimization</strong>: We collect only the information necessary to provide the services
                effectively.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">4. Data Sharing and Third-Party Access</h2>
            <p>
              We do not sell or rent your personal data. Your data may be shared with third parties in the following
              scenarios:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Service Providers</strong>: Trusted partners that assist in hosting, analytics, or improving the
                platform&apos;s functionality.
              </li>
              <li>
                <strong>Legal Compliance</strong>: If required by law or to protect the rights, property, or safety of {appNameOS} and its users.
              </li>
              <li>
                <strong>Business Transfers</strong>: In the event of a merger, acquisition, or sale of assets, your data
                may be transferred, with prior notice provided.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">5. User Control Over Data</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Access and Review</strong>: View and update your account information through your profile
                settings.
              </li>
              <li>
                <strong>Delete Data</strong>: Request the deletion of your personal data by contacting{' '}
                <a href="mailto:siddharth.nag@himeera.com" className="text-primary hover:text-primary/70">
                  siddharth.nag@himeera.com
                </a>
                .
              </li>
              <li>
                <strong>Opt-Out</strong>: Unsubscribe from marketing communications or limit data collection through
                your account settings.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">6. Data Retention</h2>
            <p>
              We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy
              or as required by law. Once no longer needed, data is securely deleted or anonymized.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">7. Children&apos;s Privacy</h2>
            <p>
              {appNameOS} is not intended for use by individuals under the age of 13. We do not knowingly collect
              personal data from children. If we become aware that a child&apos;s data has been collected, it will be
              promptly deleted.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">8. Cross-Border Data Transfers</h2>
            <p>
              Your data may be processed and stored on servers located in other countries. We ensure compliance with
              applicable laws and maintain safeguards to protect your data during cross-border transfers.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">9. Updates to This Privacy Policy</h2>
            <p>
              We may update this privacy policy periodically to reflect changes in our services or applicable
              regulations. Changes will be communicated through the app or via email, with the updated policy effective
              upon posting.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">10. Contact Us</h2>
            <p>
              If you have any questions or concerns regarding this privacy policy or your data, please contact us at:
            </p>
            <p className="mt-4">
              <strong>Email</strong>:{' '}
              <a href="mailto:siddharth.nag@himeera.com" className="text-primary hover:text-primary/70">
                siddharth.nag@himeera.com
              </a>
            </p>
            <p className="mt-4">
              <strong>Address</strong>:
            </p>
            <p>
              FLAT-F/10, 3RD FLOOR
              <br />
              P-167, PANDIT ISHAN CHANDRA ROAD RISHRA
              <br />
              HOOGHLY, WEST BENGAL - 712248
            </p>
          </div>
        </div>
      </div>
      {/* <Footer /> */}
    </main>
  );
}
