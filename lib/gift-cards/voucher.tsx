import { readFile } from "node:fs/promises"
import path from "node:path"
import { ImageResponse } from "next/og"
import { PDFDocument } from "pdf-lib"

/**
 * Lucy's gift voucher template with the blanks filled in, as a one-page PDF.
 *
 * The PDF has two layers: the template photo (JPEG, untouched) and a
 * transparent PNG with the filled-in text on top. The text layer is drawn with
 * next/og rather than as PDF text, because pdf-lib's font parser can't read
 * Cormorant Garamond's italic files.
 *
 * Positions are measured on the 1748×1240 template, top-left origin. The
 * template had nowhere to print the redemption code, so it goes in the dark
 * strip under the cream box.
 */

const W = 1748
const H = 1240
const PAGE_W = 595.28 // A5 landscape width; height keeps the template's shape
const PAGE_H = (H / W) * PAGE_W

const INK = "#3B0A0A"
const CREAM = "#F8E6AE"

const FIELDS = {
  to: { left: 88, top: 858, maxW: 395, size: 72 },
  from: { left: 594, top: 858, maxW: 470, size: 72 },
  value: { left: 88, top: 1066, maxW: 395, size: 60 },
  expiry: { left: 594, top: 1066, maxW: 470, size: 60 },
} as const

const ASSETS = path.join(process.cwd(), "lib/gift-cards/assets")

let assets: Promise<[Buffer, Buffer, Buffer]> | null = null
function loadAssets() {
  assets ??= Promise.all([
    readFile(path.join(ASSETS, "voucher-template.jpg")),
    readFile(path.join(ASSETS, "CormorantGaramond_600SemiBold_Italic.ttf")),
    readFile(path.join(ASSETS, "DMSans_600SemiBold.ttf")),
  ])
  return assets
}

export interface VoucherFields {
  recipientName: string
  senderName: string
  /** e.g. "5 classes" */
  value: string
  /** ISO timestamp; printed as "26 May 2027" */
  expiresAt: string
  code: string
  /** e.g. "burnmatstudio.co.uk/gift" */
  claimUrl: string
}

export function formatVoucherDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  })
}

/**
 * Shrink long names so they stay on their line. Cormorant italic runs about
 * 0.43em per character; never below 45% of the design size (past that the
 * box clips with an ellipsis). Names are capped at 30 characters anyway.
 */
function fitSize(text: string, size: number, maxW: number): number {
  const estimate = text.length * 0.43 * size
  if (estimate <= maxW) return size
  return Math.max(Math.floor(maxW / (text.length * 0.43)), Math.round(size * 0.45))
}

async function renderTextLayer(v: VoucherFields, serif: Buffer, sans: Buffer): Promise<Uint8Array> {
  const field = (key: keyof typeof FIELDS, text: string) => {
    const f = FIELDS[key]
    return (
      <div
        style={{
          position: "absolute",
          left: f.left,
          top: f.top,
          width: f.maxW,
          // Fixed-height box with the text pinned to its bottom, so a name
          // shrunk to fit still sits on the line.
          height: Math.round(f.size * 1.2),
          display: "flex",
          alignItems: "flex-end",
          fontFamily: "Cormorant",
          fontSize: fitSize(text, f.size, f.maxW),
          lineHeight: 1.2,
          color: INK,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {text}
      </div>
    )
  }

  const strip = {
    position: "absolute" as const,
    top: 1207,
    fontFamily: "DMSans",
    fontSize: 18,
    letterSpacing: 4,
    color: CREAM,
    textTransform: "uppercase" as const,
  }

  const res = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
        {field("to", v.recipientName)}
        {field("from", v.senderName)}
        {field("value", v.value)}
        {field("expiry", formatVoucherDate(v.expiresAt))}
        <div style={{ ...strip, left: 50, display: "flex" }}>
          Code&nbsp;&nbsp;<span style={{ letterSpacing: 6, opacity: 1 }}>{v.code}</span>
        </div>
        <div style={{ ...strip, right: W - 1112, display: "flex" }}>Claim at {v.claimUrl}</div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Cormorant", data: serif, weight: 600, style: "italic" },
        { name: "DMSans", data: sans, weight: 600, style: "normal" },
      ],
    }
  )
  return new Uint8Array(await res.arrayBuffer())
}

export async function renderVoucherPdf(v: VoucherFields): Promise<Uint8Array> {
  const [template, serif, sans] = await loadAssets()
  const textLayer = await renderTextLayer(v, serif, sans)

  const doc = await PDFDocument.create()
  doc.setTitle(`Burn gift voucher for ${v.recipientName}`)
  doc.setAuthor("Burn Mat Studio")

  const page = doc.addPage([PAGE_W, PAGE_H])
  page.drawImage(await doc.embedJpg(template), { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  page.drawImage(await doc.embedPng(textLayer), { x: 0, y: 0, width: PAGE_W, height: PAGE_H })

  return doc.save()
}
