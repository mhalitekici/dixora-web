import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationPanels } from "./operation-panels";
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/use-auth", () => ({
  useCurrentUser: () => ({
    data: {
      user: { username: "manager", displayName: "Manager" },
      permissions: ["orders.create", "payments.manage"],
    },
  }),
}));
vi.mock("@/lib/api", () => ({ api: { post: mocks.post } }));
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <OperationPanels />
    </QueryClientProvider>,
  );
}
describe("OperationPanels credentials", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_PIN_LOGIN", "true");
    mocks.post.mockResolvedValue({});
  });
  it("prefills the current account and preserves password reauthentication", async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByLabelText("Kullanıcı adı")).toHaveValue("manager");
    await user.type(screen.getByLabelText("Parola"), "Manager!2026");
    await user.click(screen.getByRole("button", { name: "Yetkili giriş" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("auth/operation-grant", {
        username: "manager",
        password: "Manager!2026",
        panel: "waiter",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/waiter/tables");
  });
  it("clears the password when switching methods and sends PIN for the current account", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Parola"), "do-not-send");
    await user.selectOptions(screen.getByLabelText("Doğrulama yöntemi"), "pin");
    expect(screen.getByLabelText("PIN")).toHaveValue("");
    await user.type(screen.getByLabelText("PIN"), "7246");
    await user.click(screen.getByRole("radio", { name: "Kasiyer" }));
    await user.click(screen.getByRole("button", { name: "Yetkili giriş" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("auth/operation-grant", {
        username: "manager",
        pin: "7246",
        panel: "cashier",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/cashier");
  });
  it("shows a rejected PIN and clears it without navigating", async () => {
    mocks.post.mockRejectedValue(new Error("Aktif hesabınızı doğrulayın."));
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByLabelText("Doğrulama yöntemi"), "pin");
    await user.type(screen.getByLabelText("PIN"), "9999");
    await user.click(screen.getByRole("button", { name: "Yetkili giriş" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Aktif hesabınızı doğrulayın.",
    );
    expect(screen.getByLabelText("PIN")).toHaveValue("");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
