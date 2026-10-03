// PostgREST caps every select at 1000 rows and returns the first 1000 with no
// error, so a studio-wide list silently loses rows once the studio outgrows
// it. Burn Mat passed 1000 members in Oct 2026 and the newest sign-ups simply
// vanished from the Members page.
//
// Page through instead. The query must have a stable, unique ordering (end it
// with .order("id")) or rows can repeat or go missing between pages.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}
