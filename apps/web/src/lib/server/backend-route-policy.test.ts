import { describe, expect, it } from "vitest"

import { isPublicBackendRequest } from "@/lib/server/backend-route-policy"

describe("isPublicBackendRequest", () => {
  const productImage =
    "media/products/0123456789abcdef01234567/0123456789abcdef0123456789abcdef.webp"
  const qrCover =
    "media/qr-menu/0123456789abcdef01234567/89abcdef0123456789abcdef/cover/0123456789abcdef0123456789abcdef.jpg"

  it("allows reads for opaque managed media", () => {
    expect(isPublicBackendRequest(productImage, "GET")).toBe(true)
    expect(isPublicBackendRequest(qrCover, "HEAD")).toBe(true)
  })

  it("keeps media mutations authenticated", () => {
    expect(isPublicBackendRequest(productImage, "POST")).toBe(false)
    expect(isPublicBackendRequest(productImage, "DELETE")).toBe(false)
    expect(
      isPublicBackendRequest("media/products/a-product-id/image", "POST"),
    ).toBe(false)
  })

  it("rejects legacy, malformed and unrelated media paths", () => {
    expect(
      isPublicBackendRequest(
        "media/tenants/0123456789abcdef0123456789abcdef/products/file.png",
        "GET",
      ),
    ).toBe(false)
    expect(
      isPublicBackendRequest(
        "media/products/../../secrets/0123456789abcdef0123456789abcdef.png",
        "GET",
      ),
    ).toBe(false)
    expect(isPublicBackendRequest("media/not-managed.svg", "GET")).toBe(false)
  })

  it("continues to allow the existing public API surface", () => {
    expect(isPublicBackendRequest("qr/public/dixora-lab/merkez", "GET")).toBe(
      true,
    )
    expect(
      isPublicBackendRequest("loyalty/public/dixora-lab/merkez/enroll", "POST"),
    ).toBe(true)
  })
})
