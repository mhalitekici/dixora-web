import type { Metadata } from "next";

import {
  LoginPanel,
  type LoginMode,
} from "@/components/auth/login-panel";

export const metadata: Metadata = {
  title: "Giriş",
  description: "Dixora işletme çalışma alanına güvenli giriş.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string;
    business?: string;
    email?: string;
    mode?: string;
  }>;
}) {
  const { returnTo, business, email, mode } = await searchParams;
  // "waiter" is kept so older bookmarks and printed QR cards still work; the
  // entry is for every employee now, not just waiters.
  const initialMode: LoginMode =
    mode === "staff" || mode === "waiter" || mode === "pin" ? "pin" : "password";

  return (
    <LoginPanel
      returnTo={returnTo}
      initialBusiness={business}
      initialEmail={email}
      initialMode={initialMode}
    />
  );
}
