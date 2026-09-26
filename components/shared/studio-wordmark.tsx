import type { Studio } from "@/lib/types"

/**
 * The studio's logo (studios.branding.logo_url) on the dark header bars, or
 * its name when it has none — so every Forma studio gets its own mark.
 */
export function StudioWordmark({
  studio,
  height,
  className = "",
}: {
  studio: Pick<Studio, "name" | "branding">
  height: number
  className?: string
}) {
  const name = studio.name?.replace(" Studio", "") ?? "Studio"
  const logo = studio.branding?.logo_url
  if (logo) {
    // A plain img: the logo is a small, fixed-size file on the studio's own domain.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={studio.name ?? "Studio"} style={{ height }} className={`block w-auto ${className}`} />
  }
  return <span className={`font-heading font-semibold text-wheat ${className}`}>{name}</span>
}
