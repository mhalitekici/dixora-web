"use client"

import Image from "next/image"
import { useEffect, useState } from "react"

type IntroPhase = "visible" | "leaving" | "hidden"

interface IntroDecision {
  markSession: boolean
  show: boolean
}

function getIntroDecision(storageKey: string, hasLogo: boolean): IntroDecision {
  if (!hasLogo || typeof window === "undefined") {
    return { markSession: false, show: false }
  }

  try {
    if (window.sessionStorage.getItem(storageKey)) {
      return { markSession: false, show: false }
    }
  } catch {
    // Storage can be unavailable in privacy modes; the intro can still run.
  }

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  return { markSession: true, show: !reducedMotion }
}

export function QrBrandIntro({
  businessSlug,
  branchSlug,
  logoUrl,
  primaryColor,
}: {
  businessSlug: string
  branchSlug: string
  logoUrl: string | null
  primaryColor: string
}) {
  const storageKey = `dixora:qr-intro:${businessSlug}:${branchSlug}`

  return (
    <QrBrandIntroCycle
      key={`${storageKey}:${logoUrl ?? "no-logo"}`}
      storageKey={storageKey}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
    />
  )
}

function QrBrandIntroCycle({
  storageKey,
  logoUrl,
  primaryColor,
}: {
  storageKey: string
  logoUrl: string | null
  primaryColor: string
}) {
  const [decision] = useState(() =>
    getIntroDecision(storageKey, Boolean(logoUrl)),
  )
  const [phase, setPhase] = useState<IntroPhase>(
    decision.show ? "visible" : "hidden",
  )

  useEffect(() => {
    if (decision.markSession) {
      try {
        window.sessionStorage.setItem(storageKey, "shown")
      } catch {
        // Storage can be unavailable in privacy modes; the intro remains bounded.
      }
    }

    if (!decision.show) return

    const leaveTimer = window.setTimeout(() => setPhase("leaving"), 850)
    const hideTimer = window.setTimeout(() => setPhase("hidden"), 1150)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(hideTimer)
    }
  }, [decision.markSession, decision.show, storageKey])

  if (phase === "hidden" || !logoUrl) return null

  const leaving = phase === "leaving"

  return (
    <div
      aria-hidden="true"
      data-qr-brand-intro
      className="pointer-events-none fixed inset-0 z-[100] grid place-items-center transition-opacity duration-300"
      style={{
        backgroundColor: primaryColor,
        opacity: leaving ? 0 : 1,
      }}
    >
      <div
        className="flex size-28 items-center justify-center rounded-[2rem] bg-white p-5 shadow-2xl transition duration-300"
        style={{
          opacity: leaving ? 0 : 1,
          transform: leaving ? "scale(.94)" : "scale(1)",
        }}
      >
        <div className="relative size-full">
          <Image
            src={logoUrl}
            alt=""
            fill
            sizes="112px"
            className="object-contain"
          />
        </div>
      </div>
    </div>
  )
}
