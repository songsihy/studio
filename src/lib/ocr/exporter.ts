
import { ExtractedTable } from '../ocr-types';

export const exportToCSV = (table: ExtractedTable): string => {
  return table.rows.map(row => row.join(',')).join('\n');
};

export const exportToJSON = (table: ExtractedTable): string => {
  return JSON.stringify(table, null, 2);
};

export const exportToMarkdown = (table: ExtractedTable): string => {
  if (table.rows.length === 0) return '';
  const header = `| ${table.rows[0].join(' | ')} |\n`;
  const separator = `| ${table.rows[0].map(() => '---').join(' | ')} |\n`;
  const body = table.rows.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n');
  return header + separator + body;
};

export const exportToHTML = (table: ExtractedTable): string => {
  const rows = table.rows.map(row => 
    `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('');
  return `<table border="1">${rows}</table>`;
};

export const downloadFile = (content: string, fileName: string, contentType: string) => {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};
