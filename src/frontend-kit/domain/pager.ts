/**
 * R88 agent plan P20: shared pagination semantics. The directory APIs are
 * cursor-paginated (next_cursor is the last person/organization id of the
 * page); the marketplace is offset-paginated. Both helpers are pure and
 * headless — renderers decide how to present the pager.
 */

export interface CursorPageState {
  /** The cursor to request next; null means end of list. */
  nextCursor: number | null;
  /** Cursors already visited, for stepping back without refetching surprises. */
  history: number[];
  /** The cursor currently displayed (0 = first page). */
  current: number;
  pageSize: number;
}

export function initialCursorPage(pageSize: number): CursorPageState {
  return { nextCursor: null, history: [0], current: 0, pageSize };
}

/** Can we go forward? Only when the server said a next page exists. */
export function canAdvanceCursor(page: CursorPageState): boolean {
  return page.nextCursor != null;
}

/** Can we go back? Only when we are not on the first page. */
export function canRetreatCursor(page: CursorPageState): boolean {
  return page.current !== 0;
}

/**
 * Record the outcome of the page currently displayed. `nextCursor` is null
 * when the server returned fewer than page_size rows or no next cursor.
 */
export function cursorPageLoaded(page: CursorPageState, nextCursor: number | null): CursorPageState {
  return { ...page, nextCursor };
}

/** Move forward onto the server-provided cursor. Refuses when none exists. */
export function advanceCursor(page: CursorPageState): CursorPageState {
  if (page.nextCursor == null) return page;
  const current = page.nextCursor;
  return { ...page, history: [...page.history, current], current, nextCursor: null };
}

/** Step back to the previously visited cursor. */
export function retreatCursor(page: CursorPageState): CursorPageState {
  if (!canRetreatCursor(page)) return page;
  const history = [...page.history];
  history.pop();
  const current = history[history.length - 1] ?? 0;
  return { ...page, history, current, nextCursor: null };
}

export interface OffsetPageState {
  offset: number;
  pageSize: number;
  total: number | null;
}

export function initialOffsetPage(pageSize: number): OffsetPageState {
  return { offset: 0, pageSize, total: null };
}

export function canAdvanceOffset(page: OffsetPageState): boolean {
  return page.total == null || page.offset + page.pageSize < page.total;
}

export function canRetreatOffset(page: OffsetPageState): boolean {
  return page.offset > 0;
}

export function offsetPageLoaded(page: OffsetPageState, total: number): OffsetPageState {
  return { ...page, total };
}

export function advanceOffset(page: OffsetPageState): OffsetPageState {
  return canAdvanceOffset(page) ? { ...page, offset: page.offset + page.pageSize } : page;
}

export function retreatOffset(page: OffsetPageState): OffsetPageState {
  return { ...page, offset: Math.max(0, page.offset - page.pageSize) };
}
