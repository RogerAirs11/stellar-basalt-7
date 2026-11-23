/**
 * Derive the final declared SQLite schema in migration order. This scanner is
 * deliberately limited to supported table DDL, and rejects an unfamiliar
 * table-changing statement rather than silently weakening inventory checks.
 * It ignores SQL comments/literals as syntax, honors rebuild/rename/drop, and
 * does not count SQLite-generated FTS shadow tables as declared structures.
 */
const ID = '(?:"(?:""|[^"])+"|`(?:``|[^`])+`|\\[(?:\\]\\]|[^\\]])+\\]|[A-Za-z_][A-Za-z0-9_$]*)';
const TABLE_ID = `${ID}(?:\\s*\\.\\s*${ID})?`;

function identifier(token) {
  const value = token.trim();
  if (value.startsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  if (value.startsWith('`')) return value.slice(1, -1).replaceAll('``', '`');
  if (value.startsWith('[')) return value.slice(1, -1).replaceAll(']]', ']');
  return value;
}

function endQuote(quote) { return quote === '[' ? ']' : quote; }

export function stripSqlComments(sql) {
  let result = '', quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i], next = sql[i + 1];
    if (quote) {
      result += c;
      if (c === endQuote(quote)) {
        if (next === c) { result += next; i += 1; } else quote = null;
      }
    } else if (["'", '"', '`', '['].includes(c)) { quote = c; result += c; }
    else if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      result += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) { if (sql[i] === '\n') result += '\n'; i += 1; }
      if (i >= sql.length) throw new Error('Unterminated SQL block comment');
      i += 1; result += ' ';
    } else result += c;
  }
  if (quote) throw new Error('Unterminated SQL quoted token');
  return result;
}

/** Split only outside strings, quoted identifiers and nested parentheses. */
function splitSql(sql, delimiter) {
  const parts = []; let start = 0, depth = 0, quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (quote) {
      if (c === endQuote(quote)) { if (sql[i + 1] === c) i += 1; else quote = null; }
      continue;
    }
    if (["'", '"', '`', '['].includes(c)) { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === delimiter && depth === 0) { parts.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(sql.slice(start).trim());
  return parts.filter(Boolean);
}

function tableName(token) { return identifier(splitSql(token, '.').at(-1)); }
function existingName(schema, name) { return [...schema.keys()].find(key => key.toLowerCase() === name.toLowerCase()); }
function normalizeReferences(text) { return text.replace(new RegExp(`\\bREFERENCES\\s+(${TABLE_ID})`, 'gi'), (_, name) => `REFERENCES ${tableName(name)}`); }
function maskStringLiterals(sql) {
  let result = '', identifierQuote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (identifierQuote) {
      result += c;
      if (c === endQuote(identifierQuote)) { if (sql[i + 1] === c) { result += c; i += 1; } else identifierQuote = null; }
    } else if (['"', '`', '['].includes(c)) { identifierQuote = c; result += c; }
    else if (c === "'") {
      result += "''"; i += 1;
      while (i < sql.length) { if (sql[i] === "'") { if (sql[i + 1] === "'") i += 1; else break; } i += 1; }
    } else result += c;
  }
  return result;
}

function tableBody(rest) {
  const start = rest.indexOf('(');
  if (start < 0) throw new Error(`Unsupported table DDL (no declared columns): ${rest.slice(0, 100)}`);
  let depth = 0, quote = null;
  for (let i = start; i < rest.length; i += 1) {
    const c = rest[i];
    if (quote) { if (c === endQuote(quote)) { if (rest[i + 1] === c) i += 1; else quote = null; } continue; }
    if (["'", '"', '`', '['].includes(c)) { quote = c; continue; }
    if (c === '(') depth += 1;
    if (c === ')' && --depth === 0) return rest.slice(start + 1, i);
  }
  throw new Error('Unterminated CREATE TABLE body');
}

function addColumn(columns, definition) {
  const match = new RegExp(`^(${ID})\\s*`).exec(definition);
  if (!match) throw new Error(`Unrecognized column declaration: ${definition.slice(0, 100)}`);
  columns.set(identifier(match[1]), normalizeReferences(maskStringLiterals(definition)));
}

function createColumns(body, virtual) {
  const columns = new Map(), constraints = [];
  for (const definition of splitSql(body, ',')) {
    if (/^(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(definition)) { constraints.push(definition); continue; }
    // fts5 options such as tokenize='unicode61' are not physical columns.
    if (virtual && /^\w+\s*=/.test(definition)) continue;
    addColumn(columns, definition);
  }
  for (const constraint of constraints) {
    const foreign = new RegExp(`^(?:CONSTRAINT\\s+${ID}\\s+)?FOREIGN\\s+KEY\\s*\\((.*?)\\)\\s+REFERENCES\\s+(${TABLE_ID})`, 'is').exec(constraint);
    if (!foreign) continue;
    for (const name of splitSql(foreign[1], ',').map(identifier)) {
      if (!columns.has(name)) throw new Error(`Foreign key names missing column ${name}`);
      columns.set(name, `${columns.get(name)} REFERENCES ${tableName(foreign[2])} (table_constraint)`);
    }
  }
  return columns;
}

/** @returns {Map<string,{columns:Map<string,string>,virtual:boolean,temporary:boolean}>} */
export function deriveMigrationSchema(sql) {
  const schema = new Map();
  const statements = splitSql(stripSqlComments(Array.isArray(sql) ? sql.join('\n') : sql), ';');
  for (const statement of statements) {
    const create = new RegExp(`^CREATE\\s+(?:(TEMP(?:ORARY)?|VIRTUAL)\\s+)?TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(${TABLE_ID})\\s*([\\s\\S]*)$`, 'i').exec(statement);
    if (create) {
      const name = tableName(create[3]), old = existingName(schema, name);
      if (old && create[2]) continue;
      if (old) throw new Error(`Table ${name} is created twice without IF NOT EXISTS`);
      const virtual = (create[1] ?? '').toUpperCase() === 'VIRTUAL';
      if (!virtual && !create[4].trimStart().startsWith('(')) throw new Error(`Unsupported CREATE TABLE form for ${name}`);
      schema.set(name, { columns: createColumns(tableBody(create[4]), virtual), virtual, temporary: /^TEMP/i.test(create[1] ?? '') });
      continue;
    }
    const drop = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${TABLE_ID})(?:\\s+(?:CASCADE|RESTRICT))?\\s*$`, 'i').exec(statement);
    if (drop) { const old = existingName(schema, tableName(drop[1])); if (old) schema.delete(old); continue; }
    const alter = new RegExp(`^ALTER\\s+TABLE\\s+(${TABLE_ID})\\s+([\\s\\S]*)$`, 'i').exec(statement);
    if (alter) {
      const name = existingName(schema, tableName(alter[1]));
      if (!name) throw new Error(`ALTER TABLE names unknown table ${alter[1]}`);
      const table = schema.get(name), action = alter[2].trim();
      const rename = new RegExp(`^RENAME\\s+TO\\s+(${TABLE_ID})\\s*$`, 'i').exec(action);
      if (rename) {
        const target = tableName(rename[1]);
        if (existingName(schema, target) && target.toLowerCase() !== name.toLowerCase()) throw new Error(`RENAME would overwrite ${target}`);
        schema.delete(name); schema.set(target, table);
        for (const definition of schema.values()) for (const [column, line] of definition.columns) {
          definition.columns.set(column, line.replace(/\bREFERENCES\s+([A-Za-z_][A-Za-z0-9_$]*)/gi, (full, reference) => reference.toLowerCase() === name.toLowerCase() ? `REFERENCES ${target}` : full));
        }
        continue;
      }
      const add = /^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?([\s\S]*)$/i.exec(action);
      if (add) {
        if (/^(?:CONSTRAINT|CHECK|UNIQUE|FOREIGN|PRIMARY)\b/i.test(add[2])) throw new Error(`Unsupported ALTER TABLE constraint form for ${name}`);
        const column = new RegExp(`^(${ID})`).exec(add[2]);
        const old = column && existingName(table.columns, identifier(column[1]));
        if (old && add[1]) continue;
        if (old) throw new Error(`Column ${name}.${old} is added twice without IF NOT EXISTS`);
        addColumn(table.columns, add[2]); continue;
      }
      const renameColumn = new RegExp(`^RENAME\\s+(?:COLUMN\\s+)?(${ID})\\s+TO\\s+(${ID})\\s*$`, 'i').exec(action);
      if (renameColumn) {
        const old = existingName(table.columns, identifier(renameColumn[1])), target = identifier(renameColumn[2]);
        if (!old) throw new Error(`RENAME COLUMN names unknown column ${renameColumn[1]}`);
        const definition = table.columns.get(old); table.columns.delete(old); table.columns.set(target, definition); continue;
      }
      const dropColumn = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${ID})\\s*$`, 'i').exec(action);
      if (dropColumn) { const old = existingName(table.columns, identifier(dropColumn[1])); if (old) table.columns.delete(old); continue; }
      throw new Error(`Unsupported ALTER TABLE form for ${name}: ${action.slice(0, 100)}`);
    }
    if (/^(?:CREATE\s+(?:(?:TEMP(?:ORARY)?|VIRTUAL)\s+)?TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i.test(statement)) {
      throw new Error(`Unrecognized table DDL: ${statement.slice(0, 120)}`);
    }
  }
  return schema;
}
