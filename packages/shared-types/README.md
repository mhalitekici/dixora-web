# @dixora/shared-types

Small transport contracts shared by TypeScript consumers. The package currently
covers tenant context, pagination/errors, table and order states, real-time
envelopes, and normalized print documents.

`DecimalString` deliberately represents money and stock values as strings on the
wire. Consumers must use decimal-safe arithmetic rather than converting these
values to JavaScript floating point numbers.

The FastAPI OpenAPI schema remains authoritative. A future CI step should
generate or compare client contracts so handwritten types cannot drift.
