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

  it("submits the business and exposes the resulting login link", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        business_name: "Sahil Restoran",
        business_slug: "sahil-restoran",
        owner_username: "sahibi@example.com",
        trial_ends_at: "2026-09-02T12:00:00Z",
      }),
    } as unknown as Response);

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
    await user.type(screen.getByLabelText("Parola"), "Guvenli!2026");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "30 gün ücretsiz başla" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/register",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(
      await screen.findByRole("link", {
        name: "İşletme paneline giriş yap",
      }),
    ).toHaveAttribute(
      "href",
      "/login?business=sahil-restoran&email=sahibi%40example.com",
    );
  });
});
