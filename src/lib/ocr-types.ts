
export type ProcessingStatus = 'idle' | 'uploading' | 'detecting' | 'refining' | 'ocr-processing' | 'completed' | 'error';

export interface TableLine {
  id: string;
  type: 'vertical' | 'horizontal';
  position: number; // percentage (0-100)
}

export interface TableCell {
  rowIndex: number;
  colIndex: number;
  text: string;
  confidence: number;
}

export interface ExtractedTable {
  id: string;
  rows: string[][];
  headers: string[];
}

export interface DocumentPage {
  id: string;
  originalImage: string; // Base64 or ObjectURL
  detectedTables: ExtractedTable[];
  verticalLines: TableLine[];
  horizontalLines: TableLine[];
}
