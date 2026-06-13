(function () {
  function cellValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value.map(cellValue).filter(Boolean).join(' | ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function csvEscape(value) {
    const text = cellValue(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function columnValue(row, column) {
    if (typeof column.value === 'function') return column.value(row);
    if (typeof column.value === 'string') return column.value.split('.').reduce(function (current, key) {
      return current == null ? undefined : current[key];
    }, row);
    return row[column.key || column.header];
  }

  function toCsv(columns, rows) {
    const headers = columns.map(function (column) { return csvEscape(column.header); }).join(',');
    const lines = (rows || []).map(function (row) {
      return columns.map(function (column) { return csvEscape(columnValue(row, column)); }).join(',');
    });
    return [headers].concat(lines).join('\n') + '\n';
  }

  function downloadCsv(filename, columns, rows) {
    const csv = toCsv(columns, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { filename: filename, rows: (rows || []).length, columns: columns.length };
  }

  window.CrateAdminCsv = { toCsv: toCsv, downloadCsv: downloadCsv };
}());
