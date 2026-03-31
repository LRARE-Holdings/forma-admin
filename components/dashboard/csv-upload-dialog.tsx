"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import {
  matchCsvEmails,
  importCsvBookings,
  type MatchResult,
} from "@/app/actions/csv-bookings"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowLeft,
} from "lucide-react"

interface CsvUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduleId: string
  date: string
  className: string
  startTime: string
  capacity: number
  bookingCount: number
}

interface ParsedRow {
  firstName: string
  lastName: string
  email: string
}

type Step = "select" | "preview" | "results"

export function CsvUploadDialog({
  open,
  onOpenChange,
  scheduleId,
  date,
  className: classTitle,
  startTime,
  capacity,
  bookingCount,
}: CsvUploadDialogProps) {
  const [step, setStep] = useState<Step>("select")
  const [matching, setMatching] = useState(false)
  const [importing, setImporting] = useState(false)
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [results, setResults] = useState<{
    created: number
    skippedAlreadyBooked: number
    skippedNotFound: number
  } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString(
    "en-GB",
    { weekday: "long", day: "numeric", month: "long" }
  )

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("select")
      setMatches([])
      setResults(null)
      setParseError(null)
      setDragOver(false)
      setMatching(false)
      setImporting(false)
    }
  }, [open])

  function parseCsv(text: string): ParsedRow[] {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return []

    // Validate header looks like a TeamUp export
    const header = lines[0].toLowerCase()
    if (!header.includes("email")) {
      throw new Error(
        "This doesn't look like a TeamUp export. Expected an Email column."
      )
    }

    const rows: ParsedRow[] = []
    const seen = new Set<string>()

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim())
      if (cols.length < 3 || !cols[2]) continue

      const email = cols[2].toLowerCase()
      if (seen.has(email)) continue
      seen.add(email)

      rows.push({
        firstName: cols[0],
        lastName: cols[1],
        email,
      })
    }

    return rows
  }

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null)

      if (!file.name.endsWith(".csv")) {
        setParseError("Please select a CSV file (.csv).")
        return
      }
      if (file.size > 1024 * 1024) {
        setParseError("File is too large. Please select a file under 1 MB.")
        return
      }

      const text = await file.text()
      let rows: ParsedRow[]

      try {
        rows = parseCsv(text)
      } catch (e) {
        setParseError(
          e instanceof Error ? e.message : "Failed to parse CSV file."
        )
        return
      }

      if (rows.length === 0) {
        setParseError("No members found in this file.")
        return
      }

      // Send to server for matching
      setStep("preview")
      setMatching(true)

      try {
        const result = await matchCsvEmails(rows, scheduleId, date)
        setMatches(result)
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to match members"
        )
        setStep("select")
      } finally {
        setMatching(false)
      }
    },
    [scheduleId, date]
  )

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so re-selecting the same file works
    e.target.value = ""
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleImport() {
    const emailsToImport = matches
      .filter((m) => m.profileId && !m.alreadyBooked)
      .map((m) => m.email)

    if (emailsToImport.length === 0) return

    setImporting(true)
    try {
      const result = await importCsvBookings(emailsToImport, scheduleId, date)
      setResults(result)
      setStep("results")
      toast.success(`${result.created} booking${result.created !== 1 ? "s" : ""} imported`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import bookings")
    } finally {
      setImporting(false)
    }
  }

  const readyCount = matches.filter(
    (m) => m.profileId && !m.alreadyBooked
  ).length
  const alreadyBookedCount = matches.filter((m) => m.alreadyBooked).length
  const notFoundCount = matches.filter((m) => !m.profileId).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-gold" />
            Import bookings
          </DialogTitle>
          <DialogDescription>
            <strong>{classTitle}</strong> &mdash; {startTime},{" "}
            {formattedDate} ({bookingCount}/{capacity} booked)
          </DialogDescription>
        </DialogHeader>

        {/* Step: select file */}
        {step === "select" && (
          <div className="space-y-3 py-1">
            <div
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragOver
                  ? "border-gold bg-gold/5"
                  : "border-sand hover:border-gold/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-8 w-8 text-warm-grey" />
              <p className="text-[0.82rem] text-cocoa">
                Drop a CSV file here, or click to browse
              </p>
              <p className="text-[0.72rem] text-warm-grey">
                TeamUp export format (.csv)
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />

            {parseError && (
              <div className="rounded-lg bg-ember/10 px-3 py-2 text-[0.78rem] text-cocoa">
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* Step: preview matches */}
        {step === "preview" && (
          <div className="space-y-3 py-1">
            {matching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[0.82rem] text-warm-grey">
                <Loader2 className="h-4 w-4 animate-spin" />
                Matching members...
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="flex flex-wrap gap-2 text-[0.78rem]">
                  {readyCount > 0 && (
                    <span className="rounded-full bg-success/10 px-2.5 py-0.5 font-medium text-success">
                      {readyCount} ready
                    </span>
                  )}
                  {alreadyBookedCount > 0 && (
                    <span className="rounded-full bg-sand/50 px-2.5 py-0.5 font-medium text-warm-grey">
                      {alreadyBookedCount} already booked
                    </span>
                  )}
                  {notFoundCount > 0 && (
                    <span className="rounded-full bg-ember/10 px-2.5 py-0.5 font-medium text-ember">
                      {notFoundCount} not found
                    </span>
                  )}
                </div>

                {bookingCount + readyCount > capacity && readyCount > 0 && (
                  <div className="rounded-lg bg-gold/10 px-3 py-2 text-[0.78rem] text-cocoa">
                    This will exceed the class capacity of {capacity}.
                  </div>
                )}

                {/* Member list */}
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {matches.map((m) => (
                    <div
                      key={m.email}
                      className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[0.78rem]"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-cocoa">
                          {m.fullName ?? `${m.firstName} ${m.lastName}`}
                        </span>
                        <span className="ml-1.5 text-warm-grey">{m.email}</span>
                      </div>
                      <div className="ml-2 shrink-0">
                        {m.profileId && !m.alreadyBooked && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        )}
                        {m.alreadyBooked && (
                          <AlertCircle className="h-3.5 w-3.5 text-warm-grey" />
                        )}
                        {!m.profileId && (
                          <XCircle className="h-3.5 w-3.5 text-ember" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: results */}
        {step === "results" && results && (
          <div className="space-y-3 py-1">
            <div className="rounded-lg bg-success/10 px-4 py-3 text-[0.82rem] text-cocoa">
              <strong>{results.created}</strong> booking
              {results.created !== 1 ? "s" : ""} created as complimentary.
            </div>

            {results.skippedAlreadyBooked > 0 && (
              <p className="text-[0.78rem] text-warm-grey">
                {results.skippedAlreadyBooked} skipped (already booked).
              </p>
            )}

            {results.skippedNotFound > 0 && (
              <div className="text-[0.78rem] text-warm-grey">
                <p>
                  {results.skippedNotFound} not found &mdash; they may need to
                  register first:
                </p>
                <ul className="mt-1 list-inside list-disc text-[0.72rem]">
                  {matches
                    .filter((m) => !m.profileId)
                    .map((m) => (
                      <li key={m.email}>
                        {m.firstName} {m.lastName} ({m.email})
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <DialogFooter>
          {step === "select" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}

          {step === "preview" && !matching && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("select")
                  setMatches([])
                }}
                disabled={importing}
              >
                <ArrowLeft className="mr-1.5 h-3 w-3" />
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || readyCount === 0}
              >
                {importing && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {readyCount > 0
                  ? `Import ${readyCount} booking${readyCount !== 1 ? "s" : ""}`
                  : "No members to import"}
              </Button>
            </>
          )}

          {step === "results" && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
