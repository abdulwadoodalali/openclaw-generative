// Client-side chat search for the sidebar. Pure (no react / react-native / expo).

/** Threads whose title contains every word of `query` (case-insensitive). An empty query matches all. */
export function searchThreads<T extends { title: string }>(threads: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...threads];
  return threads.filter((t) => {
    const title = t.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}
