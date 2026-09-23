"use client"

import { useEffect, useRef, useState } from "react"
import { CameraOff, Loader2 } from "lucide-react"

/**
 * The phone or tablet's camera, reading QR codes.
 *
 * Each code is handed to `onScan` once; the same code is ignored for a few
 * seconds after, so holding a phone up to the camera doesn't check someone in
 * ten times. Scanning pauses while `onScan` is working.
 *
 * Camera access needs HTTPS (or localhost) and the browser's permission.
 */
export function QrScanView({ onScan }: { onScan: (code: string) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const busy = useRef(false)
  const recent = useRef<{ code: string; at: number } | null>(null)
  const [state, setState] = useState<"starting" | "running" | "denied" | "no-camera">("starting")

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    let scanner: { start(): Promise<void>; stop(): void; destroy(): void } | null = null
    let cancelled = false

    async function start() {
      // Loaded here, in the browser only: it needs the DOM and a web worker.
      const { default: QrScanner } = await import("qr-scanner")
      if (cancelled || !videoRef.current) return

      if (!(await QrScanner.hasCamera())) {
        setState("no-camera")
        return
      }

      scanner = new QrScanner(
        videoRef.current,
        async (result) => {
          const code = result.data
          const now = Date.now()
          if (busy.current) return
          if (recent.current && recent.current.code === code && now - recent.current.at < 4000) return
          recent.current = { code, at: now }
          busy.current = true
          try {
            await onScanRef.current(code)
          } finally {
            busy.current = false
          }
        },
        {
          preferredCamera: "environment",
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 8,
          returnDetailedScanResult: true,
        },
      )

      try {
        await scanner.start()
        if (!cancelled) setState("running")
      } catch {
        if (!cancelled) setState("denied")
      }
    }

    start()
    return () => {
      cancelled = true
      scanner?.stop()
      scanner?.destroy()
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-2xl bg-charcoal aspect-[4/3] sm:aspect-video">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

      {state === "starting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-wheat">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-[0.8rem]">Starting camera…</span>
        </div>
      )}
      {(state === "denied" || state === "no-camera") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-charcoal px-6 text-center text-wheat">
          <CameraOff className="h-7 w-7" />
          <p className="text-[0.85rem] font-semibold">
            {state === "denied" ? "Camera access was blocked" : "No camera found"}
          </p>
          <p className="max-w-xs text-[0.75rem] text-wheat/70">
            {state === "denied"
              ? "Allow camera access for this site in your browser settings, then reopen the scanner. You can still check people in by name."
              : "Use a phone or tablet with a camera, or check people in by name."}
          </p>
        </div>
      )}
    </div>
  )
}
