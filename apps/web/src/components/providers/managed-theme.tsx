import {
  MANAGED_THEME_DATASET_KEY,
  MANAGED_THEME_STORAGE_KEY,
  type ManagedThemeMode,
} from "@/stores/managed-theme-store"

/**
 * Applies the business's theme before the browser paints a single pixel.
 *
 * Runs the instant the parser reaches it — after next-themes' own script, so it
 * wins — which is what stops a pinned-light QR menu from loading dark on a
 * dark-mode phone and then correcting itself.
 *
 * This half only paints. Pair it with a `ManagedThemeScope` so the React side
 * knows what is in force and next-themes does not put the device preference
 * back a moment after hydration.
 *
 * Render it from a *server* layout wherever a business decides the look: the QR
 * menu and the staff phone screens. The back office is left alone — the theme
 * toggle there belongs to the person using it.
 *
 * @param mode        Resolved server-side, where the screen can know it that
 *                    early. Null means "nothing decided yet".
 * @param useStored    Fall back to the mode this device saw last. True for the
 *                    staff screens, which only learn theirs from the session.
 *                    False for the public menu: a stored staff preference must
 *                    never bleed into a guest's view of somebody's menu.
 */
export function ManagedThemeBootstrap({
  mode = null,
  useStored = false,
}: {
  mode?: ManagedThemeMode | null
  useStored?: boolean
}) {
  const args = [
    JSON.stringify(mode),
    JSON.stringify(useStored ? MANAGED_THEME_STORAGE_KEY : null),
    JSON.stringify(MANAGED_THEME_DATASET_KEY),
  ].join(",")

  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: `(${bootstrap.toString()})(${args})` }}
    />
  )
}

/**
 * Serialised into the page and run before paint — keep it self-contained.
 *
 * Everything is wrapped in try/catch: a browser that blocks storage, or a
 * private window, must degrade to the ordinary device-driven theme rather than
 * leave the page unstyled.
 */
function bootstrap(
  serverMode: string | null,
  storageKey: string | null,
  datasetKey: string,
) {
  try {
    let stored: string | null = null
    if (storageKey) {
      try {
        stored = window.localStorage.getItem(storageKey)
      } catch {
        stored = null
      }
    }
    const mode = serverMode || stored
    if (mode !== "LIGHT" && mode !== "DARK" && mode !== "SYSTEM") {
      return
    }
    const root = document.documentElement
    root.dataset[datasetKey] = mode
    // SYSTEM is handed straight back to next-themes, which is already following
    // the device; touching the class here would only fight it.
    if (mode === "SYSTEM") {
      return
    }
    const dark = mode === "DARK"
    root.classList.toggle("dark", dark)
    root.classList.toggle("light", !dark)
    root.style.colorScheme = dark ? "dark" : "light"
  } catch {
    /* An unstyled page is worse than the device's own theme. */
  }
}
