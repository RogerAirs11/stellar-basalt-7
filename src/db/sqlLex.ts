/** Lexical utilities for the application's SQLite/PostgreSQL SQL subset.
 * This is NOT a SQL parser or a sandbox for untrusted queries. It preserves
 * literal/comment bytes while making transformations and bind checks precise. */
export interface SqlSpan {
    start: number;
    end: number;
    kind: "code" | "quoted" | "comment";
}
export function sqlSpans(sql: string): SqlSpan[] {
    const spans: SqlSpan[] = [];
    let i = 0, codeStart = 0;
    while (i < sql.length) {
        const start = i;
        let kind: SqlSpan["kind"] | null = null;
        if (sql.startsWith("--", i)) {
            kind = "comment";
            const end = sql.indexOf("\n", i + 2);
            i = end < 0 ? sql.length : end;
        }
        else if (sql.startsWith("/*", i)) {
            kind = "comment";
            let depth = 1;
            i += 2;
            while (i < sql.length && depth) {
                if (sql.startsWith("/*", i)) {
                    depth++;
                    i += 2;
                }
                else if (sql.startsWith("*/", i)) {
                    depth--;
                    i += 2;
                }
                else
                    i++;
            }
            if (depth)
                throw new Error("Unterminated SQL comment");
        }
        else if (["'", '"', "`", "["].includes(sql[i]!)) {
            kind = "quoted";
            const opener = sql[i]!;
            const close = opener === "[" ? "]" : opener;
            const escapeString = opener === "'" && /(?:^|[^A-Za-z0-9_])[eE]$/.test(sql.slice(0, i));
            i++;
            let closed = false;
            while (i < sql.length) {
                if (escapeString && sql[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (sql[i] === close) {
                    if (sql[i + 1] === close) {
                        i += 2;
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed)
                throw new Error("Unterminated SQL quoted token");
        }
        else if (sql[i] === "$") {
            const delimiter = sql.slice(i).match(/^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/)?.[0];
            if (delimiter) {
                kind = "quoted";
                const end = sql.indexOf(delimiter, i + delimiter.length);
                if (end < 0)
                    throw new Error("Unterminated SQL dollar quote");
                i = end + delimiter.length;
            }
        }
        if (kind) {
            if (codeStart < start)
                spans.push({ start: codeStart, end: start, kind: "code" });
            spans.push({ start, end: i, kind });
            codeStart = i;
        }
        else
            i++;
    }
    if (codeStart < sql.length)
        spans.push({ start: codeStart, end: sql.length, kind: "code" });
    return spans;
}
/** Same offsets as input; protected content becomes whitespace. */
export function sqlCodeMask(sql: string): string {
    return sqlSpans(sql).map((span) => {
        const text = sql.slice(span.start, span.end);
        return span.kind === "code" ? text : text.replace(/[^\r\n]/g, " ");
    }).join("");
}
export function replaceSqlCode(sql: string, pattern: RegExp, replacement: (match: RegExpExecArray, original: string) => string): string {
    // Transform only contiguous code spans: masked whitespace must never let a
    // regex eat a real quoted literal (e.g. LIKE 'value' COLLATE NOCASE).
    return sqlSpans(sql).map((span) => {
        const text = sql.slice(span.start, span.end);
        if (span.kind !== "code")
            return text;
        const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
        let result = "", cursor = 0, match: RegExpExecArray | null;
        while ((match = regex.exec(text))) {
            if (!match[0].length)
                throw new Error("SQL replacement pattern must consume input");
            result += text.slice(cursor, match.index) + replacement(match, match[0]);
            cursor = match.index + match[0].length;
        }
        return result + text.slice(cursor);
    }).join("");
}
export function sqlParameters(sql: string): {
    start: number;
    end: number;
    index: number;
}[] {
    const mask = sqlCodeMask(sql);
    const parameters = [];
    let max = 0;
    for (const m of mask.matchAll(/\?(\d*)/g)) {
        const index = m[1] ? Number(m[1]) : max + 1;
        if (!Number.isSafeInteger(index) || index < 1 || index > 32766)
            throw new Error("Unsupported SQL parameter index");
        max = Math.max(max, index);
        parameters.push({ start: m.index, end: m.index + m[0].length, index });
    }
    return parameters;
}
export function assertSqlBindings(sql: string, count: number): void {
    const expected = sqlParameters(sql).reduce((max, p) => Math.max(max, p.index), 0);
    if (count !== expected)
        throw new Error(`SQL binding count mismatch: expected ${expected}, received ${count}`);
}
export function postgresParameters(sql: string): string {
    let out = "", cursor = 0;
    for (const p of sqlParameters(sql)) {
        out += sql.slice(cursor, p.start) + `$${p.index}`;
        cursor = p.end;
    }
    return out + sql.slice(cursor);
}
/** Node SQLite treats ordered parameters as named bindings; expand them into
 * anonymous placeholders so this adapter matches D1's bind(...values) API. */
export function anonymousBindings<T>(sql: string, values: readonly T[]): {
    sql: string;
    values: T[];
} {
    assertSqlBindings(sql, values.length);
    let out = "", cursor = 0;
    const expanded: T[] = [];
    for (const p of sqlParameters(sql)) {
        out += sql.slice(cursor, p.start) + "?";
        cursor = p.end;
        expanded.push(values[p.index - 1]!);
    }
    return { sql: out + sql.slice(cursor), values: expanded };
}
/** Conservative guard for our fixed read-query catalog, not arbitrary SQL.
 * Always pair with a DB role that cannot write or call write-capable functions. */
export function assertReadOnlySql(sql: string): void {
    const mask = sqlCodeMask(sql).trim();
    const error = () => new Error("Database provider is public-read-only; unsupported or mutating SQL is not allowed");
    if (!/^(SELECT|WITH|EXPLAIN|SHOW)\b/i.test(mask))
        throw error();
    // R132: REPLACE is both a mutating statement (SQLite/MySQL "REPLACE
    // INTO") and a harmless string FUNCTION ("REPLACE(expr, a, b)") — the
    // Persian collation-key expression nests ~80 REPLACE() calls and had been
    // misclassifying every sort-by-name browse query as a write batch (which
    // disables the read-retry path; the misclassification predates R132 and
    // was live). A REPLACE followed by an argument list is the function and
    // stays allowed; REPLACE INTO never carries a paren directly after the
    // keyword and remains flagged.
    if (/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM|REINDEX|ANALYZE|INTO|LOCK)\b/i.test(mask)
        || /\bREPLACE\b(?!\s*\()/i.test(mask))
        throw error();
    if (mask.replace(/;\s*$/, "").includes(";"))
        throw error();
}
export function sqlMayWrite(sql: string): boolean {
    try {
        assertReadOnlySql(sql);
        return false;
    }
    catch {
        return true;
    }
}
