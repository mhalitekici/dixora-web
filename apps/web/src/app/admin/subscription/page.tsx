import { SubscriptionSettings } from "@/components/admin/subscription-settings";
import { BillingPanel } from "@/components/billing/billing-panel";

export default function Page() {
  return (
    <div className="space-y-6 pb-8">
      <SubscriptionSettings />
      <div className="px-4 sm:px-6">
        <BillingPanel />
      </div>
    </div>
  );
}
