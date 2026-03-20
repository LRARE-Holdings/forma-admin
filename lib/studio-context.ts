import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import type { StudioBranding, StudioBrandingColors } from "@/lib/types"

/**
 * Get the current studio ID from the request context.
 *
 * In production, proxy.ts resolves the studio from the Host header
 * and sets x-studio-id on the request. In local dev, falls back
 * to the NEXT_PUBLIC_STUDIO_ID env var.
 */
export async function getStudioId(): Promise<string> {
  // Local dev fallback
  if (process.env.NEXT_PUBLIC_STUDIO_ID) {
    return process.env.NEXT_PUBLIC_STUDIO_ID
  }

  const h = await headers()
  const studioId = h.get("x-studio-id")

  if (!studioId) {
    throw new Error("No studio context — x-studio-id header missing")
  }

  return studioId
}

/** Burn Mat Studio's colors — used as defaults when branding is missing */
const DEFAULT_COLORS: StudioBrandingColors = {
  wheat: "#DFD0A5",
  cocoa: "#473728",
  gold: "#C4A95A",
  cream: "#F5F0E8",
  sand: "#E8DCC8",
  charcoal: "#1A1A1A",
  slate: "#4A4A4A",
  warmGrey: "#8A8070",
  ember: "#D4713A",
  blush: "#E8936A",
  success: "#5A8F4A",
  successBg: "#EDF5EA",
}

const DEFAULT_BRANDING: StudioBranding = {
  colors: DEFAULT_COLORS,
  fonts: { heading: "Cormorant Garamond", body: "DM Sans" },
  borderRadius: "0.75rem",
}

/**
 * Get the studio's branding config, merged with defaults.
 * Any missing keys fall back to the default (Burn Mat Studio) values.
 */
export async function getStudioBranding(): Promise<StudioBranding> {
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data } = await supabase
    .from("studios")
    .select("branding")
    .eq("id", studioId)
    .single()

  const branding = data?.branding as Partial<StudioBranding> | null

  if (!branding) return DEFAULT_BRANDING

  return {
    colors: { ...DEFAULT_COLORS, ...branding.colors },
    fonts: { ...DEFAULT_BRANDING.fonts, ...branding.fonts },
    borderRadius: branding.borderRadius ?? DEFAULT_BRANDING.borderRadius,
  }
}
