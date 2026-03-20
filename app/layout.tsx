import type { Metadata } from "next"
import { Cormorant_Garamond, DM_Sans } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { BrandingProvider } from "@/components/branding-provider"
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
        {children}
        <Toaster />
      </body>
    </html>
  )
}
