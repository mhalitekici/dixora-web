/* eslint-disable @next/next/no-img-element -- DOM test double for next/image. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaImage, mediaImageSource } from "./media-image";

// A plain image lets this component test dispatch the browser error event.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
  }) => <img src={src} alt={alt} onError={onError} />,
}));

describe("managed product images", () => {
  it("uses the current web origin for a managed image saved under an old API domain", () => {
    expect(
      mediaImageSource("http://old-host/api/v1/media/products/abc/photo.png"),
    ).toBe("/api/v1/media/products/abc/photo.png");
  });
  it("shows an accessible fallback and loads a replacement URL", () => {
    const { rerender } = render(
      <MediaImage src="/one.png" alt="Kahve" width={80} height={80} />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Kahve" }));
    expect(
      screen.getByRole("img", { name: "Kahve — görsel yüklenemedi" }),
    ).toBeVisible();
    rerender(<MediaImage src="/two.png" alt="Kahve" width={80} height={80} />);
    expect(screen.getByRole("img", { name: "Kahve" })).toHaveAttribute(
      "src",
      "/two.png",
    );
  });
});
