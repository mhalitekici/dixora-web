import { expect, it } from "vitest";
import { backendResponse } from "./responses";

it("preserves an image cache validation response without converting it into a redirect error", async () => {
  const response = await backendResponse(
    new Response(null, {
      status: 304,
      headers: {
        etag: '"photo"',
        "cache-control": "public, max-age=31536000, immutable",
      },
    }),
  );
  expect(response.status).toBe(304);
  expect(response.headers.get("etag")).toBe('"photo"');
  expect(await response.text()).toBe("");
});
