import "@testing-library/jest-dom/vitest"

import { cleanup, configure } from "@testing-library/react"
import { afterEach } from "vitest"

// waitFor defaults to a 1s budget, which is not enough for async form
// validation when the whole suite runs in parallel on a loaded machine — it
// produced intermittent failures that had nothing to do with the assertions.
// Waiting longer never passes a wrong assertion; it only avoids false alarms.
configure({ asyncUtilTimeout: 5_000 })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
