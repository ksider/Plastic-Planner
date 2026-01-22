export function toCsv(rows: Array<Record<string, string | number | null>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const line = headers
      .map((header) => {
        const value = row[header];
        if (value == null) return "";
        const text = String(value);
        if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\n");
}
