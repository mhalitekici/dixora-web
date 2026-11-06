import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { OperationPanels } from "./operation-panels";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useCurrentUser: () => ({
    data: { user: { username: "manager", displayName: "Manager" } },
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/lib/api", () => ({ api: { post: mocks.post, get: mocks.get } }));
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <OperationPanels />
    </QueryClientProvider>,
  );
}
describe("Manager PIN panel login", () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue({ ready: false, waiter: true, cashier: true });
    mocks.post.mockResolvedValue({});
  });
  it("asks for employee username and PIN before selecting a panel", async () => {
    mount();
    expect(await screen.findByLabelText("Kullanıcı adı")).toHaveValue("");
    expect(screen.getByLabelText("PIN")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText("Parola")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Kasiyer paneli/ }),
    ).not.toBeInTheDocument();
  });
  it("rejects bad credentials and clears the PIN", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "invalid_credentials",
                message: "Kullanıcı adı veya PIN hatalı.",
              },
            }),
            { status: 401 },
          ),
        ),
    );
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText("Kullanıcı adı"), "manager");
    await user.type(screen.getByLabelText("PIN"), "9999");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kullanıcı adı veya PIN hatalı.",
    );
    expect(screen.getByLabelText("PIN")).toHaveValue("");
    expect(mocks.push).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("shows both panels after employee authentication and selects own cashier mode", async () => {
    mocks.get.mockResolvedValue({ ready: true, waiter: true, cashier: true });
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: /Kasiyer paneli/ }),
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("auth/operation-select", {
        panel: "cashier",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/cashier");
  });
});
