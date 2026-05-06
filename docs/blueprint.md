# TableScan Pro - Technical Blueprint

## 1. Overview
TableScan Pro is a professional-grade document OCR tool specializing in complex table extraction. It combines classic computer vision (OpenCV.js) with modern OCR engines (Tesseract.js) and Generative AI (Vision LLMs) to handle both wired and wireless table structures.

## 2. Technical Stack
- **Framework**: Next.js 15 (App Router)
- **UI Components**: Radix UI + ShadCN + Tailwind CSS
- **Computer Vision**: OpenCV.js (WebAssembly)
- **OCR (Local)**: Tesseract.js
- **OCR (AI)**: OpenAI-compatible Vision API (GPT-4o, llama.cpp, Ollama)
- **PDF Processing**: PDF.js

## 3. Core Logic Flow

### Step 1: Document Ingestion
- User uploads PDF or Image.
- `pdfToImages` converts PDF pages into high-resolution PNG Data URIs.
- State initializes with `DocumentPage` objects.

### Step 2: Table Region Detection
- **Auto-Detection**: `detectTableRegions` uses OpenCV's `adaptiveThreshold` and `findContours` to suggest bounding boxes for tables based on area density.
- **Manual Selection**: `TableSelector` allows users to draw `TableRegion` objects directly on the page canvas.

### Step 3: Grid Refinement & Preprocessing
- **Grid Detection**: `detectLinesInSingleRegion` applies vertical/horizontal morphological kernels to identify cell boundaries.
- **Image Cleanup**: Users configure `PreprocessingOptions`:
  - **Binarization**: Global (Binary) or Adaptive (Mean/Gaussian).
  - **Deskew**: Automatic rotation correction.
  - **Denoise**: Median blur for speckle removal.
- **Preview**: `getPreprocessedPreview` generates a real-time high-contrast visualization of how the OCR engine will "see" the table.

### Step 4: Extraction Engine
`processTablesOnPage` orchestrates the extraction:
1. **Engine Selection**:
   - **Tesseract.js**: Performs local OCR using multi-language workers.
   - **AI Engine**: 
     - **Local**: Direct client fetch (bypassing server) for privacy and speed with local models (llama.cpp).
     - **Remote**: Server Action proxy (`callAiEngineAction`) to bypass CORS and protect API keys.
2. **Cell-by-Cell Processing**:
   - The region is cropped into individual cells based on grid guides.
   - Each cell is preprocessed according to region-specific rules.
   - Content is extracted and mapped to a structured `ExtractedTable` object.

### Step 5: Export
- Extracted data is presented in an interactive `table` view.
- Content can be exported via `exporter.ts` into:
  - **CSV**: Plain comma-separated values.
  - **JSON**: Structured object data.
  - **Markdown**: GFM-compatible tables.
  - **HTML**: Standard table markup.

## 4. Key Functions Reference

| Function | File | Purpose |
| :--- | :--- | :--- |
| `detectTableRegions` | `processor.ts` | OpenCV contour detection for table discovery. |
| `detectLinesInSingleRegion` | `processor.ts` | Morphological analysis for grid line identification. |
| `preprocessMatForOcr` | `processor.ts` | Advanced OpenCV image cleaning pipeline. |
| `processTablesOnPage` | `processor.ts` | Main engine loop for cell extraction. |
| `callAiEngineAction` | `ai-ocr.ts` | Server-side proxy for external Vision APIs. |
| `pdfToImages` | `pdf-loader.ts` | PDF.js implementation for document loading. |

## 5. UI Architecture
- **Workflow State**: Managed in `page.tsx` via `status` ('uploading' | 'selecting-tables' | 'refining' | 'ocr-processing' | 'completed').
- **LineEditor**: A custom SVG/HTML overlay for interactive grid manipulation.
- **TableSelector**: A canvas-based drawing interface for region definition.
- **Engine Settings**: A global popover for switching between Tesseract and custom AI configurations.
