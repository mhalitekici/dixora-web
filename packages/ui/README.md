# @dixora/ui

Framework-neutral React presentation primitives shared by Dixora surfaces.

```tsx
import { PageHeader, StatusBadge } from "@dixora/ui";
import "@dixora/ui/styles.css";

export function OrdersHeader() {
  return (
    <>
      <PageHeader title="Orders" description="Live branch operations" />
      <StatusBadge tone="success">Ready</StatusBadge>
    </>
  );
}
```

The package intentionally starts small. Domain data loading, permissions, and
business actions stay in applications. Components use semantic content and CSS
custom properties so each surface can integrate them without duplicating domain
logic.
