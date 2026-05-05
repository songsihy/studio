
import { createWorker, Worker } from 'tesseract.js';
import { TableLine, TableRegion } from '@/lib/ocr-types';

declare global {
  interface Window {
    cv: any;
  }
}

/**
 * Detects potential table regions in an image using OpenCV.js contour detection.
 */
export async function detectTableRegions(imageSrc: string): Promise<TableRegion[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        if (!window.cv) {
          throw new Error('OpenCV.js not loaded');
        }
        const cv = window.cv;
        const src = cv.imread(img);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // Preprocessing for contour detection
        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        
        const thresh = new cv.Mat();
        cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Dilate to join broken lines
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        const dilated = new cv.Mat();
        cv.dilate(thresh, dilated, kernel);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const detectedRegions: TableRegion[] = [];
        const minArea = (src.cols * src.rows) * 0.01; // At least 1% of image area

        for (let i = 0; i < contours.size(); ++i) {
          const cnt = contours.get(i);
          const rect = cv.boundingRect(cnt);
          const area = rect.width * rect.height;

          if (area > minArea) {
            detectedRegions.push({
              id: `auto-${Math.random().toString(36).substr(2, 9)}`,
              x: (rect.x / src.cols) * 100,
              y: (rect.y / src.rows) * 100,
              width: (rect.width / src.cols) * 100,
              height: (rect.height / src.rows) * 100
            });
          }
        }

        // Cleanup
        src.delete(); gray.delete(); blurred.delete(); thresh.delete(); 
        kernel.delete(); dilated.delete(); contours.delete(); hierarchy.delete();

        resolve(detectedRegions);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

/**
 * Detects table lines using OpenCV.js morphological operations
 */
export async function detectLines(imageSrc: string): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        if (!window.cv) {
          throw new Error('OpenCV.js not loaded');
        }
        const cv = window.cv;
        const src = cv.imread(img);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        const binary = new cv.Mat();
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Define kernels for horizontal and vertical lines
        const horizontalSize = Math.floor(binary.cols / 30);
        const horizontalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horizontalSize, 1));
        const verticalSize = Math.floor(binary.rows / 30);
        const verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, verticalSize));

        // Extract horizontal lines
        const horizontal = new cv.Mat();
        cv.erode(binary, horizontal, horizontalStructure);
        cv.dilate(horizontal, horizontal, horizontalStructure);

        // Extract vertical lines
        const vertical = new cv.Mat();
        cv.erode(binary, vertical, verticalStructure);
        cv.dilate(vertical, vertical, verticalStructure);

        // Find positions by averaging white pixels
        const vPositions: number[] = [];
        const hPositions: number[] = [];

        // Simplified line detection: look for peaks in the projections
        for (let j = 0; j < vertical.cols; j++) {
          let count = 0;
          for (let i = 0; i < vertical.rows; i++) {
            if (vertical.ucharPtr(i, j)[0] > 128) count++;
          }
          if (count > vertical.rows * 0.7) vPositions.push((j / vertical.cols) * 100);
        }

        for (let i = 0; i < horizontal.rows; i++) {
          let count = 0;
          for (let j = 0; j < horizontal.cols; j++) {
            if (horizontal.ucharPtr(i, j)[0] > 128) count++;
          }
          if (count > horizontal.cols * 0.7) hPositions.push((i / horizontal.rows) * 100);
        }

        // Clean up duplicates (lines very close to each other)
        const filterLines = (lines: number[]) => {
          return lines.filter((pos, idx) => {
            if (idx === 0) return true;
            return Math.abs(pos - lines[idx - 1]) > 2;
          });
        };

        const vLines: TableLine[] = filterLines(vPositions.sort((a, b) => a - b)).map((p, i) => ({
          id: `v-${i}`, type: 'vertical', position: p
        }));
        const hLines: TableLine[] = filterLines(hPositions.sort((a, b) => a - b)).map((p, i) => ({
          id: `h-${i}`, type: 'horizontal', position: p
        }));

        src.delete(); gray.delete(); binary.delete(); horizontal.delete(); vertical.delete();
        horizontalStructure.delete(); verticalStructure.delete();

        resolve({ vLines, hLines });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

/**
 * Process cell-by-cell OCR using Tesseract.js
 */
export async function processTable(
  imageSrc: string, 
  vLines: TableLine[], 
  hLines: TableLine[], 
  language: string,
  onProgress?: (progress: number) => void
): Promise<{ headers: string[], rows: string[][] }> {
  const worker = await createWorker(language);
  
  const img = new Image();
  img.src = imageSrc;
  await new Promise(resolve => img.onload = resolve);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  // Add boundaries if missing
  const vCoords = [0, ...vLines.map(l => l.position).sort((a, b) => a - b), 100];
  const hCoords = [0, ...hLines.map(l => l.position).sort((a, b) => a - b), 100];

  const results: string[][] = [];
  const totalCells = (vCoords.length - 1) * (hCoords.length - 1);
  let processedCells = 0;

  for (let i = 0; i < hCoords.length - 1; i++) {
    const row: string[] = [];
    for (let j = 0; j < vCoords.length - 1; j++) {
      const x = (vCoords[j] / 100) * img.width;
      const y = (hCoords[i] / 100) * img.height;
      const w = ((vCoords[j + 1] - vCoords[j]) / 100) * img.width;
      const h = ((hCoords[i + 1] - hCoords[i]) / 100) * img.height;

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      const { data: { text } } = await worker.recognize(canvas);
      row.push(text.trim());
      
      processedCells++;
      if (onProgress) onProgress(processedCells / totalCells);
    }
    results.push(row);
  }

  await worker.terminate();

  return {
    headers: results[0] || [],
    rows: results.length > 1 ? results.slice(1) : []
  };
}
