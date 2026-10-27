"use client";

import { useEffect } from "react";
import { reportIncident } from "@/lib/report-incident";

export function ErrorReporting() {
  useEffect(() => {
    const onError = () => reportIncident("unhandled_error");
    const onRejection = () => reportIncident("unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
