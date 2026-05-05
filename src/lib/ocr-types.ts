
export type ProcessingStatus = 'idle' | 'uploading' | 'selecting-tables' | 'detecting' | 'refining' | 'ocr-processing' | 'completed' | 'error';

export interface TableLine {
  id: string;
  type: 'vertical' | 'horizontal';
  position: number; // percentage (0-100)
}

export interface TableRegion {
  id: string;
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
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
  originalImage: string; // Data URI
  tableRegions: TableRegion[];
  verticalLines: TableLine[];
  horizontalLines: TableLine[];
}
