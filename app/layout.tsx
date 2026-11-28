import type { Metadata, Viewport } from "next"
import { Cormorant_Garamond, DM_Sans } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { BrandingProvider } from "@/components/branding-provider"
import { MemberProfileProvider } from "@/components/member-profile/member-profile-provider"
import "./globals.css"

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
})

// Safari and Chrome tint their toolbar to match the dashboard's top bar.
export const viewport: Viewport = {
  themeColor: "#473728",
}

export const metadata: Metadata = {
  title: "Forma Admin",
  description: "Studio management dashboard",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <BrandingProvider />
      </head>
      <body
        className={`${cormorant.variable} ${dmSans.variable} min-h-screen antialiased`}
      >
        <MemberProfileProvider>
          {children}
        </MemberProfileProvider>
        <Toaster />
      </body>
    </html>
  )
}
