export function normalizePhone(input: string): string {
  return input.replace(/[\s()\-]/g, "")
}

export function isValidUKPhone(input: string): boolean {
  const n = normalizePhone(input)
  return /^0\d{10}$/.test(n) || /^\+44\d{10}$/.test(n)
}

export function formatUKPhoneDisplay(
  input: string | null | undefined,
): string {
  if (!input) return ""
  const n = normalizePhone(input)
  let local: string
  if (n.startsWith("+44")) {
    local = n.slice(3)
  } else if (n.startsWith("0")) {
    local = n.slice(1)
  } else {
    return input
  }
  if (local.length !== 10) return input
  return `+44 ${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}
