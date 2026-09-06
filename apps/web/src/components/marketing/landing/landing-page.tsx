import { CookieConsentBanner } from "@/components/legal/cookie-consent-banner";

import { FeatureStories } from "./feature-stories";
import { HeroSection } from "./hero-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { OperationFlowSection } from "./operation-flow-section";
import { PricingSection } from "./pricing-section";
import { RegistrationSection } from "./registration-section";
import styles from "./landing.module.css";

export function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#ana-icerik">
        Ana içeriğe geç
      </a>
      <LandingHeader />
      <main id="ana-icerik">
        <HeroSection />
        <OperationFlowSection />
        <FeatureStories />
        <PricingSection />
        <RegistrationSection />
      </main>
      <LandingFooter />
      <CookieConsentBanner />
    </div>
  );
}
