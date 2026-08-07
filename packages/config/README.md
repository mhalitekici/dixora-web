# @dixora/config

Shared, side-effect-free TypeScript configuration for Dixora packages.

- `tsconfig/base.json` supplies strict compiler defaults.
- `tsconfig/node.json` configures Node.js packages.
- `tsconfig/react.json` configures React packages.
- The root export provides validated primitive environment readers and stable
  service/API path defaults.

Environment helpers accept an explicit record, which keeps tests deterministic
and avoids reading server secrets at import time.
