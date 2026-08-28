import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoyaltyEnrollmentDialog } from "@/components/loyalty/loyalty-enrollment-dialog";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderDialog(onEnrolled?: (code: string) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <LoyaltyEnrollmentDialog open onOpenChange={() => {}} onEnrolled={onEnrolled} />,
    { wrapper },
  );
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Ad"), "Ahmet");
  await user.type(screen.getByLabelText("Soyad"), "Yılmaz");
  await user.type(screen.getByLabelText("E-posta"), "ahmet@example.com");
}

describe("LoyaltyEnrollmentDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("will not send a code until the cashier has a usable email", async () => {
    const user = userEvent.setup({ delay: null });
    // Stubbed even though nothing should be sent, so the test never depends on
    // whatever fetch another suite happened to leave behind.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("no request expected before the form is valid");
      }),
    );
    renderDialog();

    const send = screen.getByRole("button", { name: /Kodu gönder/ });
    await waitFor(() => expect(send).toBeDisabled());

    await user.type(screen.getByLabelText("Ad"), "Ahmet");
    await user.type(screen.getByLabelText("Soyad"), "Yılmaz");
    await user.type(screen.getByLabelText("E-posta"), "gecersiz");
    await waitFor(() => expect(send).toBeDisabled());

    await user.clear(screen.getByLabelText("E-posta"));
    await user.type(screen.getByLabelText("E-posta"), "ahmet@example.com");
    await waitFor(() => expect(send).toBeEnabled());
  });

  it("walks details -> code -> card and hands the code back to the caller", async () => {
    const user = userEvent.setup({ delay: null });
    const onEnrolled = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("enrollments/start")) {
          return Promise.resolve(
            jsonResponse({
              verification_id: "v-1",
              email: "ahmet@example.com",
              expires_in_seconds: 900,
              development_code: null,
            }),
          );
        }
        if (url.includes("enrollments/confirm")) {
          return Promise.resolve(
            jsonResponse({
              member_code: "DXRTT62",
              display_name: "Ahmet Yılmaz",
              email: "ahmet@example.com",
              program_name: "Dixora Müdavim",
              progress: "0",
              progress_target: 5,
              card_email_sent: true,
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderDialog(onEnrolled);
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /Kodu gönder/ }));

    const codeInput = await screen.findByLabelText("Doğrulama kodu");
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: /Doğrula ve kaydet/ }));

    // The card code is shown so the cashier can read it out immediately.
    expect(await screen.findByText("DXRTT62")).toBeVisible();
    expect(screen.getByText(/kartı müşterinin e-postasına gönderildi/i)).toBeVisible();
    await waitFor(() => expect(onEnrolled).toHaveBeenCalledWith("DXRTT62"));
  });

  it("says so when the card email could not be delivered", async () => {
    const user = userEvent.setup({ delay: null });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("enrollments/start")) {
          return Promise.resolve(
            jsonResponse({
              verification_id: "v-1",
              email: "ahmet@example.com",
              expires_in_seconds: 900,
              development_code: null,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            member_code: "DXRTT62",
            display_name: "Ahmet Yılmaz",
            email: "ahmet@example.com",
            program_name: "Dixora Müdavim",
            progress: "0",
            progress_target: 5,
            card_email_sent: false,
          }),
        );
      }),
    );

    renderDialog();
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /Kodu gönder/ }));
    await user.type(await screen.findByLabelText("Doğrulama kodu"), "123456");
    await user.click(screen.getByRole("button", { name: /Doğrula ve kaydet/ }));

    // The membership still exists — staff just have to pass the code on.
    expect(await screen.findByText("DXRTT62")).toBeVisible();
    expect(screen.getByText(/kodu müşteriye siz iletin/i)).toBeVisible();
  });

  it("only reveals a development code when the server returns one", async () => {
    const user = userEvent.setup({ delay: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            verification_id: "v-1",
            email: "ahmet@example.com",
            expires_in_seconds: 900,
            development_code: "919708",
          }),
        ),
      ),
    );

    renderDialog();
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /Kodu gönder/ }));

    expect(await screen.findByText(/Geliştirme modu/)).toBeVisible();
    expect(screen.getByText("919708")).toBeVisible();
  });
});
