
export type ProcessingStatus = 'idle' | 'uploading' | 'selecting-tables' | 'detecting' | 'refining' | 'ocr-processing' | 'completed' | 'error';

export type OcrEngineType = 'tesseract' | 'ai';

export type ExtractionStrategy = 'single-pass' | 'cell-by-cell';

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
  thresholdValue: number;
  thresholdBlockSize: number;
  thresholdC: number;
  thresholdMaxValue: number;
  adaptiveMethod: 'mean' | 'gaussian';
  thresholdType: 'binary' | 'binary_inv';
  showTextBoxes?: boolean;
}

export interface TableRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  verticalLines: TableLine[];
  horizontalLines: TableLine[];
  preprocessing: PreprocessingOptions;
  extractionStrategy: ExtractionStrategy;
}

export interface ExtractedTable {
  id: string;
  tableName: string;
  rows: string[][];
  headers: string[];
}

export interface DocumentPage {
  id: string;
  originalImage: string;
  tableRegions: TableRegion[];
}
