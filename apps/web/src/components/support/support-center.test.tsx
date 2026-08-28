import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { INFO_EMAIL, SUPPORT_EMAIL, SupportCenter } from "./support-center";

describe("SupportCenter", () => {
  it("exposes both Dixora support addresses as clickable mailto links", () => {
    render(<SupportCenter />);
    const links = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(links).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(links).toContain(`mailto:${INFO_EMAIL}`);
  });

  it("uses the dixoratech.com addresses", () => {
    expect(SUPPORT_EMAIL).toBe("support@dixoratech.com");
    expect(INFO_EMAIL).toBe("info@dixoratech.com");
  });

  it("covers the documented FAQ topics", () => {
    render(<SupportCenter />);
    for (const topic of [
      /Şifremi unuttum/i,
      /QR menü açılmıyor/i,
      /Yazıcı çalışmıyor/i,
      /Sipariş görünmüyor/i,
      /Çalışan nasıl eklerim/i,
      /Sadakat ve kampanya/i,
      /Şube nasıl değiştiririm/i,
      /Teknik destek/i,
    ]) {
      expect(screen.getByRole("button", { name: topic })).toBeVisible();
    }
  });

  it("expands an answer when its question is opened", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<SupportCenter />);

    const question = screen.getByRole("button", { name: /Yazıcı çalışmıyor/i });
    expect(question).toHaveAttribute("aria-expanded", "false");
    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Print Bridge/)).toBeVisible();
  });
});
