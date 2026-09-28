/**
 * Read every row of a query by walking it in `.range()` pages.
 *
 * PostgREST caps each response at the project's `max_rows` (1000 by default)
 * no matter what `.limit()` asks for, and truncates silently — a user with
 * 1,500 favorites would just see 1,000. `buildPage(from, to)` must return the
 * query for rows [from, to] with a stable ORDER BY so pages don't overlap.
 */
export const SUPABASE_PAGE_SIZE = 1000

export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    if (data) rows.push(...data)
    if (!data || data.length < pageSize) return { data: rows, error: null }
  }
}
