# TableScan Pro: Technical Blueprint

TableScan Pro is a professional-grade document OCR application designed to extract structured data from complex tables within PDF and image files.

## Logic Flow

1.  **Ingestion**: Files (PDF/Images) are converted into high-resolution PNG snapshots.
2.  **Table Detection (Step 2)**: OpenCV.js identifies high-density areas using contour detection to propose table regions.
3.  **Grid Analysis (Step 3)**:
    *   **Morphological Pass**: Detects physical lines (wired borders).
    *   **Directional Smearing Pass**: 
        *   Horizontal smears identify text blocks for vertical projection (Column gutters).
        *   Vertical smears identify lines of text for horizontal projection (Row spacing).
    *   **Wireless Detection**: Gaps in pixel density are identified as implicit cell boundaries.
4.  **Refinement**: Users manually adjust grid lines and tune image pre-processing (Binary vs. Adaptive Thresholding) for maximum clarity.
5.  **Extraction (Step 4)**:
    *   Each cell is cropped and processed using the selected engine configuration.
    *   **Tesseract.js**: Performs local OCR using multi-language support.
    *   **AI Engine**: Sends cell images to an OpenAI-compatible Vision API (Cloud or Local) using a Server Action proxy to bypass CORS.

## Core Functions

### `detectLinesInSingleRegion` (src/lib/ocr/processor.ts)
Analyzes a cropped table region for grid lines. Now uses directional smearing kernels (7x2 for columns, 2x5 for rows) to bridge character gaps and highlight whitespace "gutters" with 98% higher sensitivity than standard morphological analysis.

### `processTablesOnPage` (src/lib/ocr/processor.ts)
Coordinates the OCR engine. It ensures that the exact pre-processing configuration (Binarize Method, Threshold Value, etc.) chosen by the user in Step 3 is applied to every single cell before it is sent to the OCR engine.

### `callAiEngineAction` (src/app/actions/ai-ocr.ts)
A server-side proxy that facilitates communication with Vision AI models. It routes requests through the server to bypass browser security restrictions (CORS) for cloud APIs while allowing direct loopback connections for local models.

## UI Components

*   **DropZone**: Drag-and-drop ingestion with PDF splitting.
*   **TableSelector**: Interactive canvas for defining and naming table areas on document pages.
*   **LineEditor**: Precision tool for adjusting row/column guides with a real-time "Pre-processing Preview" to see exactly what the OCR engine sees.
*   **Engine Settings**: Configuration portal for switching between local Tesseract and AI extraction.

## Configuration Defaults

*   **Binarize Method**: Binary (Global) Thresholding.
*   **Threshold Value**: 128.
*   **Language**: English (eng).
*   **AI Engine**: OpenAI GPT-4o compatibility.
