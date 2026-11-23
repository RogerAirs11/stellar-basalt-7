import { postgresParameters, replaceSqlCode, sqlCodeMask, sqlSpans } from "./sqlLex";
export function stripLeadingComments(sql: string): string {
    for (const span of sqlSpans(sql)) {
        if (span.kind === "comment")
            continue;
        const value = sql.slice(span.start, span.end);
        const nonspace = value.search(/\S/);
        if (nonspace >= 0)
            return sql.slice(span.start + nonspace);
    }
    return "";
}
function closingParen(mask: string, open: number): number {
    let depth = 0;
    for (let i = open; i < mask.length; i++) {
        if (mask[i] === "(")
            depth++;
        if (mask[i] === ")" && --depth === 0)
            return i;
    }
    throw new Error("Unbalanced SQL function parentheses");
}
function argsOf(inner: string): string[] {
    const mask = sqlCodeMask(inner);
    let depth = 0, start = 0;
    const args: string[] = [];
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === "(")
            depth++;
        if (mask[i] === ")")
            depth--;
        if (mask[i] === "," && depth === 0) {
            args.push(inner.slice(start, i).trim());
            start = i + 1;
        }
    }
    if (inner.slice(start).trim())
        args.push(inner.slice(start).trim());
    return args;
}
const UTC_FORMAT = "'YYYY-MM-DD HH24:MI:SS'";
const SQLITE_TS_TEXT = (expr: string) => `to_char((${expr})::timestamptz AT TIME ZONE 'UTC', ${UTC_FORMAT})`;
function translateFunctions(sql: string, nesting = 0): string {
    if (nesting > 100)
        throw new Error("SQL function nesting exceeds translator limit");
    const pattern = /\b(datetime|json_group_array|json_object|json|group_concat|ifnull)\s*\(/gi;
    const mask = sqlCodeMask(sql);
    let out = "", cursor = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(mask))) {
        const open = mask.indexOf("(", match.index), close = closingParen(mask, open);
        const args = argsOf(sql.slice(open + 1, close)).map((arg) => translateFunctions(arg, nesting + 1));
        const fn = match[1]!.toLowerCase();
        let result: string;
        const arity = (min: number, max = min) => {
            if (args.length < min || args.length > max)
                throw new Error(`Unsupported ${fn}() arity; add an explicit parity-tested translation`);
        };
        if (fn === "datetime") {
            arity(1, 2);
            const now = /^'now'$/i.test(args[0]!);
            if (args.length === 1)
                result = now ? `to_char(now() AT TIME ZONE 'UTC', ${UTC_FORMAT})` : SQLITE_TS_TEXT(args[0]!);
            else {
                const modifier = args[1]!;
                if (/^'/.test(modifier) && !/^'[+-]?\d+(?:\.\d+)? (?:seconds?|minutes?|hours?|days?)'$/i.test(modifier)) {
                    throw new Error("Unsupported datetime modifier; do not approximate SQLite date semantics");
                }
                result = now ? `to_char((now() AT TIME ZONE 'UTC' + ${modifier}::interval), ${UTC_FORMAT})`
                    : `to_char((((${args[0]})::timestamptz + (${modifier})::interval) AT TIME ZONE 'UTC'), ${UTC_FORMAT})`;
            }
        }
        else if (fn === "json_group_array") {
            arity(1);
            result = `jsonb_agg(${args[0]})`;
        }
        else if (fn === "json_object") {
            if (args.length % 2)
                throw new Error("json_object requires key/value pairs");
            result = `jsonb_build_object(${args.join(", ")})`;
        }
        else if (fn === "json") {
            arity(1);
            result = `(${args[0]})::jsonb`;
        }
        else if (fn === "ifnull") {
            arity(2);
            result = `COALESCE(${args.join(", ")})`;
        }
        else {
            arity(1, 2);
            result = `string_agg(${args[0]}, ${args[1] ?? "','"})`;
        }
        out += sql.slice(cursor, match.index) + result;
        cursor = close + 1;
        pattern.lastIndex = cursor;
    }
    return out + sql.slice(cursor);
}
/** Append before RETURNING/semicolon/trailing comment, never inside a literal. */
export function appendSqlClause(sql: string, clause: string, beforeReturning = false): string {
    const mask = sqlCodeMask(sql);
    const returning = beforeReturning ? /\bRETURNING\b/i.exec(mask) : null;
    if (returning)
        return sql.slice(0, returning.index).trimEnd() + ` ${clause} ` + sql.slice(returning.index);
    // Quoted values at the end are meaningful; only whitespace/comments are skipped.
    let end = 0;
    for (const span of sqlSpans(sql))
        if (span.kind !== "comment") {
            const meaningful = sql.slice(span.start, span.end).replace(/[\s;]+$/, "");
            if (meaningful)
                end = span.start + meaningful.length;
        }
    return sql.slice(0, end) + ` ${clause}` + sql.slice(end);
}
/** Tested application subset only. Literals, identifiers and comments are never
 * rewritten as keywords. This is not a general-purpose SQL compatibility layer. */
export function sqliteSqlToPostgres(input: string): string {
    let value = translateFunctions(input);
    value = replaceSqlCode(value, /\bCURRENT_TIMESTAMP\b/gi, () => `to_char(now() AT TIME ZONE 'UTC', ${UTC_FORMAT})`);
    const ignoredInsert = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sqlCodeMask(value).trimStart());
    if (ignoredInsert && !/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(value)) {
        throw new Error("Unsupported comment-separated INSERT OR IGNORE; use a parity-tested statement");
    }
    value = replaceSqlCode(value, /\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, () => "INSERT INTO");
    if (ignoredInsert && !/\bON\s+CONFLICT\b/i.test(sqlCodeMask(value)))
        value = appendSqlClause(value, "ON CONFLICT DO NOTHING", true);
    value = replaceSqlCode(value, /\b([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(\?\d*)\s+COLLATE\s+NOCASE\b/gi, (m) => `LOWER(${m[1]})=LOWER(${m[2]})`);
    value = replaceSqlCode(value, /\s+COLLATE\s+NOCASE\b/gi, () => "");
    value = replaceSqlCode(value, /\bLIKE\b/gi, () => "ILIKE");
    return postgresParameters(value);
}
export function sqliteReadSqlToPostgres(sql: string): string { return sqliteSqlToPostgres(sql); }
