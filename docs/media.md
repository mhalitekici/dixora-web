# Product media

Product images are stored in a private S3-compatible bucket. MinIO provides the
local implementation; browsers never receive MinIO credentials or direct bucket
URLs.

## API

- `POST /api/v1/media/products/{product_id}/image` accepts multipart field
  `file` and returns the existing `ProductOut` contract with its new `image_url`.
- `DELETE /api/v1/media/products/{product_id}/image` archives the current
  reference and returns `204`.
- `POST /api/v1/media/qr-menu/{logo|cover}` and the matching `DELETE` route
  manage QR-menu branding for the authenticated branch.
- `GET /api/v1/media/{object_key}` publicly delivers only a valid object key
  that is still referenced by an active product.

Upload and delete require the relevant product or QR permission. Lookups and
generated object keys are tenant/branch scoped. Original filenames are never
used in an object key. Browser-facing keys use stable opaque scope hashes rather
than database UUIDs. Legacy managed URLs remain removable from the admin panel
but are omitted from the public QR payload until re-uploaded with the opaque
format.

JPEG, PNG, and WebP are accepted. The API checks the declared MIME type, decodes
the image with Pillow, rejects corrupt or mismatched data, treats decompression
bomb warnings as errors, and enforces byte, dimension, and pixel limits. Storage
SDK and image decode work runs outside the async event loop.

Replacement writes the new random object before committing its database URL.
After the commit succeeds, the previous managed object is removed. A cleanup
failure cannot make the database point to a missing new object; it is logged for
operator follow-up. Public delivery also verifies the active database reference,
so an orphaned key is not web-accessible.

## Configuration

The API reads:

- `DIXORA_S3_ENDPOINT`
- `DIXORA_S3_ACCESS_KEY`
- `DIXORA_S3_SECRET_KEY`
- `DIXORA_S3_BUCKET`
- `DIXORA_S3_REGION`
- `DIXORA_MEDIA_PUBLIC_BASE_URL`
- `DIXORA_MEDIA_MAX_UPLOAD_BYTES`
- `DIXORA_MEDIA_MIN_DIMENSION`
- `DIXORA_MEDIA_MAX_DIMENSION`
- `DIXORA_MEDIA_MAX_PIXELS`

`DIXORA_S3_ENDPOINT` is the server-side S3 origin. In Compose this is
`http://minio:9000`. `DIXORA_MEDIA_PUBLIC_BASE_URL` is browser-facing and must
point to the API media route, for example
`http://localhost:8000/api/v1/media` locally.

Production configuration rejects SQLite, known placeholder database or MinIO
credentials, localhost S3 endpoints, public media URLs without HTTPS, wildcard
CORS, development seeds, and automatic schema creation. The MinIO initialization
job explicitly keeps the local bucket private.

## Local request

```bash
curl --request POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --form "file=@product.webp;type=image/webp" \
  http://localhost:8000/api/v1/media/products/$PRODUCT_ID/image
```

Random immutable keys permit long-lived public cache headers. Responsive
variants and thumbnail generation remain future processing work.
