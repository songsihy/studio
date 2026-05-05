# **App Name**: TableScan Pro

## Core Features:

- Intelligent Document Upload: Allow users to upload single/multiple image files or PDF documents via file selection or intuitive drag-and-drop functionality, automatically detecting input type.
- PDF Page Pre-processing: Utilize pdf.js to render PDF pages as images, enabling users to select specific pages for OCR processing and table detection.
- Advanced Table Detection: Leverage OpenCV.js to detect table structures within images, handling both wired and wireless lines, and identifying multiple tables on a single page.
- Interactive Line Guiding & Adjustment: Provide a user interface for manual guidance and refinement of wireless table lines, with system suggestions based on font width and height analysis to improve accuracy.
- Multi-Language OCR Engine: Process the adjusted table regions using Tesseract.js, supporting English, Traditional Chinese, and Simplified Chinese character recognition to extract cell content.
- Structured Data Output Generation: Convert the OCR-processed table data into a structured format, enabling seamless export to HTML, CSV, JSON, and Markdown formats.

## Style Guidelines:

- Light color scheme, evoking a sense of clarity and professionalism. Primary actions are highlighted with a composed, clear blue (#267BC6), reflecting precision in data extraction. The background is a very light, almost imperceptible blue-grey (#F2F5F8) to maintain visual cleanliness. An energetic turquoise accent color (#22E1CC) is used sparingly for interactive elements and highlights, adding a modern touch.
- Body and headline font: 'Inter' (sans-serif) for its modern, legible, and objective aesthetic, ensuring clear readability across diverse data sets and UI elements.
- Clean, line-based or glyph-style icons that visually represent functions like upload, table, export, and language selection, contributing to an intuitive user experience.
- A structured and organized multi-panel layout, facilitating a clear workflow from input upload and preview to table adjustment and output export, ensuring ample whitespace for content clarity.
- Subtle, fluid animations provide immediate feedback for user interactions such as drag-and-drop actions, loading states during OCR processing, and successful export notifications.