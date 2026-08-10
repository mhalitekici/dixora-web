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
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "30 gün ücretsiz başla" }),
    );

    // Step 1 only requests a code — no business yet.
    expect(await screen.findByText("E-postanızı doğrulayın")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/register",
      expect.objectContaining({ method: "POST" }),
    );

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
});
