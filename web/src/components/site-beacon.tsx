"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.deployzy.com";

/**
 * Cookieless first-party analytics beacon for the Deployzy marketing site.
 * Fires one pageview per route change to the API's public collect endpoint.
 * Uses text/plain so the browser treats it as a simple request (no CORS
 * preflight); the server parses the JSON body regardless of content-type.
 */
export function SiteBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const body = JSON.stringify({
        path: pathname || window.location.pathname,
        referrer: document.referrer || "",
      });
      const url = `${API}/api/v1/analytics/collect`;
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      } else {
        fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
      }
    } catch {
      /* never let analytics break the page */
    }
  }, [pathname]);
  return null;
}
