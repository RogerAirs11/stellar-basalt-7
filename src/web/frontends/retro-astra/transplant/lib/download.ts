export function createCsv(rows: readonly (readonly (string | number)[])[]): string {
  const cell = (value: string | number) => {
    const raw = String(value);
    const safe = /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(rows: readonly (readonly (string | number)[])[], filename: string) {
  const url = URL.createObjectURL(new Blob([createCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}