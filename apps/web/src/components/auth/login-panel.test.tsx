import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginPanel } from "@/components/auth/login-panel"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("next/image", () => ({
  default: () => null,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

describe("LoginPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes an accessible control for showing and hiding the password", async () => {
    const user = userEvent.setup()
    render(
      <LoginPanel
        initialBusiness="sahil-restoran"
        initialEmail="sahibi@example.com"
      />,
    )

    const password = screen.getByLabelText("Parola")
    expect(password).toHaveAttribute("type", "password")

    await user.click(
      screen.getByRole("button", { name: "Parolayı göster" }),
    )
    expect(password).toHaveAttribute("type", "text")
    expect(
      screen.getByRole("button", { name: "Parolayı gizle" }),
    ).toBeVisible()
    expect(screen.getByRole("checkbox", { name: /Beni hatırla/i })).not.toBeChecked()
  })

  it("validates an invalid quick PIN without sending a request", async () => {
    const user = userEvent.setup()
    render(<LoginPanel />)

    await user.click(screen.getByRole("tab", { name: "Garson girişi" }))
    const pin = screen.getByLabelText("PIN")
    await user.clear(pin)
    await user.type(pin, "12")
    await user.click(screen.getByRole("button", { name: "PIN ile devam et" }))

    expect(await screen.findByText("4–12 haneli PIN girin.")).toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("opens directly in waiter mode and submits the PIN contract", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        user: { roleCode: "WAITER" },
      }),
    } as unknown as Response)
    const user = userEvent.setup()

    render(
      <LoginPanel
        initialMode="pin"
        initialBusiness="sahil-restoran"
        initialEmail="ayse"
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Garson girişi" }),
    ).toBeVisible()
    expect(
      screen.getByRole("tab", { name: "Garson girişi" }),
    ).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Bu cihazda ilk giriş mi?")).toBeVisible()
    expect(screen.getByLabelText("İşletme kodu")).toHaveValue(
      "sahil-restoran",
    )
    expect(screen.getByLabelText("Kullanıcı adı")).toHaveValue("ayse")

    await user.type(screen.getByLabelText("Şube kodu"), "merkez")
    await user.type(screen.getByLabelText("PIN"), "2468")
    await user.click(screen.getByRole("button", { name: "PIN ile devam et" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/auth/pin-login")
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(JSON.parse(String(options?.body))).toEqual({
      business_slug: "sahil-restoran",
      branch_slug: "merkez",
      username: "ayse",
      pin: "2468",
    })
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/waiter/tables")
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
    })
  })

  it("explains how to authorize a device rejected by PIN login", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: {
          code: "trusted_device_required",
          message: "This device must be authorized first",
        },
      }),
    } as unknown as Response)
    const user = userEvent.setup()

    render(
      <LoginPanel
        initialMode="pin"
        initialBusiness="sahil-restoran"
        initialEmail="ayse"
      />,
    )

    await user.type(screen.getByLabelText("Şube kodu"), "merkez")
    await user.type(screen.getByLabelText("PIN"), "2468")
    await user.click(screen.getByRole("button", { name: "PIN ile devam et" }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "PIN girişi başarısız",
        expect.objectContaining({
          description: expect.stringContaining("İşletme girişi sekmesinden"),
        }),
      )
    })
  })

  it("submits the tenant credentials and routes a waiter to the waiter workspace", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        user: { roleCode: "WAITER" },
      }),
    } as unknown as Response)
    const user = userEvent.setup()
    render(
      <LoginPanel
        initialBusiness="sahil-restoran"
        initialEmail="sahibi@example.com"
      />,
    )

    await user.type(screen.getByLabelText("Parola"), "Guvenli!2026")

    await user.click(
      screen.getByRole("button", { name: "Güvenli giriş yap" }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/auth/login")
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(JSON.parse(String(options?.body))).toEqual({
      business_slug: "sahil-restoran",
      identifier: "sahibi@example.com",
      password: "Guvenli!2026",
      remember_me: false,
    })

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/waiter/tables")
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
    })
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it("submits the persistent session preference when remember me is checked", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        user: { roleCode: "BUSINESS_OWNER" },
      }),
    } as unknown as Response)
    const user = userEvent.setup()
    render(
      <LoginPanel
        initialBusiness="sahil-restoran"
        initialEmail="sahibi@example.com"
      />,
    )

    await user.type(screen.getByLabelText("Parola"), "Guvenli!2026")
    await user.click(screen.getByRole("checkbox", { name: /Beni hatırla/i }))
    await user.click(screen.getByRole("button", { name: "Güvenli giriş yap" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, options] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(options?.body))).toEqual(
      expect.objectContaining({ remember_me: true }),
    )
  })
})
