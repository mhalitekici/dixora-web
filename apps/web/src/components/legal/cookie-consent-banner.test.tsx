import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CookieConsentBanner } from "@/components/legal/cookie-consent-banner"
import { useCookieConsentStore } from "@/stores/cookie-consent-store"

function reset() {
  window.localStorage.clear()
  useCookieConsentStore.setState({ decision: null, preferencesOpen: false })
}

beforeEach(reset)
afterEach(reset)

describe("CookieConsentBanner", () => {
  it("shows the notice before any decision is made", async () => {
    render(<CookieConsentBanner />)

    expect(
      await screen.findByRole("region", { name: "Çerez bildirimi" }),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Kabul et" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reddet" })).toBeVisible();
  });

  it("gives Reddet and Kabul Et real, comparably prominent buttons", async () => {
    // Both must be actual <button> elements a screen reader announces the
    // same way — neither is a plain text link buried next to a bright CTA.
    render(<CookieConsentBanner />);
    await screen.findByRole("region", { name: "Çerez bildirimi" });

    const accept = screen.getByRole("button", { name: "Kabul et" });
    const reject = screen.getByRole("button", { name: "Reddet" });
    expect(accept.tagName).toBe("BUTTON");
    expect(reject.tagName).toBe("BUTTON");
  });

  it("rejecting hides the banner and records the decision", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(await screen.findByRole("button", { name: "Reddet" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Çerez bildirimi" }),
      ).not.toBeInTheDocument(),
    );
    expect(useCookieConsentStore.getState().decision).toMatchObject({
      analytics: false,
      marketing: false,
    });
  });

  it("accepting hides the banner and enables every category", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(await screen.findByRole("button", { name: "Kabul et" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Çerez bildirimi" }),
      ).not.toBeInTheDocument(),
    );
    expect(useCookieConsentStore.getState().decision).toMatchObject({
      analytics: true,
      marketing: true,
    });
  });

  it("does not show again once a decision has already been made", () => {
    useCookieConsentStore.getState().acceptAll();
    render(<CookieConsentBanner />);

    expect(
      screen.queryByRole("region", { name: "Çerez bildirimi" }),
    ).not.toBeInTheDocument();
  });

  it("opens the preferences dialog and lets each category be toggled", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(
      await screen.findByRole("button", { name: "Tercihleri yönet" }),
    );

    expect(await screen.findByText("Çerez tercihleri")).toBeVisible();

    const zorunlu = screen.getByRole("switch", { name: "Zorunlu" });
    expect(zorunlu).toBeChecked();
    expect(zorunlu).toHaveAttribute("aria-disabled", "true");

    const analitik = screen.getByRole("switch", { name: "Analitik" });
    expect(analitik).not.toBeChecked();
    await user.click(analitik);

    await waitFor(() => expect(analitik).toBeChecked());
    expect(useCookieConsentStore.getState().decision?.analytics).toBe(true);
    // Toggling one category must not silently enable the other.
    expect(useCookieConsentStore.getState().decision?.marketing).toBe(false);
  });

  it("can be reopened from outside the banner, e.g. a footer link", async () => {
    const user = userEvent.setup();
    useCookieConsentStore.getState().acceptAll();
    render(<CookieConsentBanner />);

    expect(screen.queryByText("Çerez tercihleri")).not.toBeInTheDocument();

    useCookieConsentStore.getState().openPreferences();
    expect(await screen.findByText("Çerez tercihleri")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Kapat" }));
    await waitFor(() =>
      expect(screen.queryByText("Çerez tercihleri")).not.toBeInTheDocument(),
    );
  });
});
