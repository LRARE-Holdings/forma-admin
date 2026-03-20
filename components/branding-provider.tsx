import { getStudioBranding } from "@/lib/studio-context"
import type { StudioBrandingColors } from "@/lib/types"

/**
 * Maps branding color keys to CSS custom property names used in globals.css.
 * Only overrides the Forma design tokens — the shadcn/ui semantic variables
 * (--primary, --background, etc.) derive from these via the @theme block.
 */
function buildColorOverrides(colors: StudioBrandingColors): string {
  return `
    --color-wheat: ${colors.wheat};
    --color-cocoa: ${colors.cocoa};
    --color-gold: ${colors.gold};
    --color-cream: ${colors.cream};
    --color-sand: ${colors.sand};
    --color-charcoal: ${colors.charcoal};
    --color-slate: ${colors.slate};
    --color-warm-grey: ${colors.warmGrey};
    --color-ember: ${colors.ember};
    --color-blush: ${colors.blush};
    --color-success: ${colors.success};
    --color-success-bg: ${colors.successBg};

    --background: ${colors.cream};
    --foreground: ${colors.cocoa};
    --card-foreground: ${colors.cocoa};
    --popover-foreground: ${colors.cocoa};
    --primary: ${colors.gold};
    --primary-foreground: ${colors.cocoa};
    --secondary: ${colors.cream};
    --secondary-foreground: ${colors.slate};
    --muted: ${colors.sand};
    --muted-foreground: ${colors.warmGrey};
    --accent: ${colors.sand};
    --accent-foreground: ${colors.cocoa};
    --destructive: ${colors.ember};
    --border: ${colors.sand};
    --input: ${colors.sand};
    --ring: ${colors.gold};

    --sidebar: ${colors.cocoa};
    --sidebar-foreground: ${colors.warmGrey};
    --sidebar-primary: ${colors.gold};
    --sidebar-primary-foreground: ${colors.cocoa};
    --sidebar-accent-foreground: ${colors.gold};
    --sidebar-ring: ${colors.gold};

    --chart-1: ${colors.gold};
    --chart-2: ${colors.ember};
    --chart-3: ${colors.success};
    --chart-4: ${colors.blush};
    --chart-5: ${colors.wheat};
  `
}

/**
 * Server component that injects per-studio CSS variable overrides.
 * Reads branding from the database and outputs a <style> tag.
 *
 * For Burn Mat Studio, the branding values match the hardcoded defaults
 * in globals.css exactly — so there's zero visual change.
 */
export async function BrandingProvider() {
  const branding = await getStudioBranding()

  const css = `:root {
    ${buildColorOverrides(branding.colors)}
    --radius: ${branding.borderRadius};
  }`

  return <style dangerouslySetInnerHTML={{ __html: css }} />
}
