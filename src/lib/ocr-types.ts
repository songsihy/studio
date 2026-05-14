
export type ProcessingStatus = 'idle' | 'uploading' | 'selecting-tables' | 'detecting' | 'refining' | 'ocr-processing' | 'completed' | 'error';

export type OcrEngineType = 'tesseract' | 'ai' | 'scribe';

export interface AiEngineConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export interface OcrEngineConfig {
  type: OcrEngineType;
  aiConfig: AiEngineConfig;
}

export interface TableLine {
  id: string;
  type: 'vertical' | 'horizontal';
  position: number; // percentage (0-100) relative to the container
}

export interface PreprocessingOptions {
  binarize: boolean;
  deskew: boolean;
  denoise: boolean;
  thresholdMethod: 'global' | 'adaptive';
  thresholdValue: number; // For global thresholding
  thresholdBlockSize: number; // For adaptive thresholding
  thresholdC: number; // For adaptive thresholding
  thresholdMaxValue: number;
  adaptiveMethod: 'mean' | 'gaussian';
  thresholdType: 'binary' | 'binary_inv';
  showTextBoxes?: boolean; // Visualization option
}

export interface TableRegion {
  id: string;
  name: string; // Variable name for the table
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
  verticalLines?: TableLine[];
  horizontalLines?: TableLine[];
  preprocessing?: PreprocessingOptions;
}

export interface TableCell {
  rowIndex: number;
  colIndex: number;
  text: string;
  confidence: number;
}

export interface ExtractedTable {
  id: string;
  tableName: string;
  rows: string[][];
  headers: string[];
}

export interface DocumentPage {
  id: string;
  originalImage: string; // Data URI
  tableRegions: TableRegion[];
}
