import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrialRegistrationForm } from "./trial-registration-form";

describe("TrialRegistrationForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels every control and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(<TrialRegistrationForm />);

    expect(screen.getByLabelText("İşletme adı")).toBeVisible();
    expect(screen.getByLabelText("İşletme türü")).toBeVisible();
    expect(screen.getByLabelText("Yetkili adı ve soyadı")).toBeVisible();
    expect(screen.getByLabelText("E-posta adresi")).toBeVisible();
    expect(screen.getByLabelText("Parola")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "30 gün ücretsiz başla" }),
    );

    expect(await screen.findByText("İşletme adını girin.")).toBeVisible();
    expect(screen.getByLabelText("İşletme adı")).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies the owner's email before creating the business", async () => {
    const fetchMock = vi.mocked(fetch);
    // Signing up now emails a code first; the business only exists after it is
    // confirmed, so an abandoned signup leaves nothing behind.
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/register") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            verification_id: "11111111-1111-1111-1111-111111111111",
            email: "sahibi@example.com",
            expires_in_seconds: 1200,
            development_code: null,
          }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          business_name: "Sahil Restoran",
          business_slug: "sahil-restoran",
          owner_username: "sahibi@example.com",
          trial_ends_at: "2026-09-02T12:00:00Z",
        }),
      } as unknown as Response);
    });

    const user = userEvent.setup();
    render(<TrialRegistrationForm />);

    await user.type(screen.getByLabelText("İşletme adı"), "Sahil Restoran");
    await user.selectOptions(screen.getByLabelText("İşletme türü"), "RESTAURANT");
    await user.type(
      screen.getByLabelText("Yetkili adı ve soyadı"),
      "Deniz Yılmaz",
    );
    await user.type(
      screen.getByLabelText("E-posta adresi"),
      "sahibi@example.com",
    );
    await user.type(screen.getByLabelText("Telefon numarası"), "0555 111 22 33");
    await user.type(screen.getByLabelText("Parola"), "Guvenli!2026");
    // Three checkboxes: membership agreement, KVKK notice, optional marketing.
    // Only the first two are ticked — the optional one is deliberately skipped.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(
      screen.getByRole("button", { name: "30 gün ücretsiz başla" }),
    );

    // Step 1 only requests a code — no business yet.
    expect(await screen.findByText("E-postanızı doğrulayın")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/register",
      expect.objectContaining({ method: "POST" }),
    );
    const registerCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/register",
    );
    const sentBody = JSON.parse(String(registerCall?.[1]?.body));
    expect(sentBody.terms_accepted).toBe(true);
    expect(sentBody.privacy_notice_acknowledged).toBe(true);
    expect(sentBody.marketing_consent).toBe(false);
    expect(sentBody.contract_version).toBeTruthy();
    expect(sentBody.privacy_notice_version).toBeTruthy();

    await user.type(screen.getByLabelText("Doğrulama kodu"), "123456");
    await user.click(
      screen.getByRole("button", { name: /Doğrula ve işletmemi oluştur/ }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/register/confirm",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByRole("link", {
        name: "Giriş yap ve kuruluma başla",
      }),
    ).toHaveAttribute(
      "href",
      "/login?business=sahil-restoran&email=sahibi%40example.com",
    );
  });

  it("shows VAT-inclusive prices and never mentions a card requirement", () => {
    const { container } = render(<TrialRegistrationForm />);
    const text = container.textContent ?? "";

    expect(text).toContain("₺1.200,00 (KDV dahil) / ay");
    expect(text).toContain("₺850,00 (KDV dahil)");
    expect(text).not.toContain("KDV hariç");
    expect(text.toLocaleLowerCase("tr")).not.toContain("kredi kartı");
  });

  it("keeps the KVKK acknowledgement separate from the membership agreement", async () => {
    const user = userEvent.setup();
    render(<TrialRegistrationForm />);

    await user.type(screen.getByLabelText("İşletme adı"), "Sahil Restoran");
    await user.type(
      screen.getByLabelText("Yetkili adı ve soyadı"),
      "Deniz Yılmaz",
    );
    await user.type(
      screen.getByLabelText("E-posta adresi"),
      "sahibi@example.com",
    );
    await user.type(screen.getByLabelText("Telefon numarası"), "0555 111 22 33");
    await user.type(screen.getByLabelText("Parola"), "Guvenli!2026");

    // Only the membership agreement is ticked; the KVKK notice is left unread.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(
      screen.getByRole("button", { name: "30 gün ücretsiz başla" }),
    );

    expect(
      await screen.findByText(
        "KVKK Aydınlatma Metni'ni okuduğunuzu onaylamanız gerekiyor.",
      ),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("links to the real KVKK notice page rather than bundling it into a dialog", () => {
    render(<TrialRegistrationForm />);

    expect(
      screen.getByRole("link", { name: "KVKK Aydınlatma Metni" }),
    ).toHaveAttribute("href", "/kvkk-aydinlatma-metni");
  });

  it("leaves the marketing consent checkbox unticked by default and never required", () => {
    render(<TrialRegistrationForm />);

    const marketingCheckbox = screen.getByRole("checkbox", {
      name: /ticari elektronik ileti gönderilmesine izin veriyorum/i,
    });
    expect(marketingCheckbox).not.toBeChecked();
    expect(marketingCheckbox).not.toBeRequired();
  });
});
