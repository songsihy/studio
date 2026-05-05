
import { createWorker } from 'tesseract.js';
import { TableLine, TableRegion, ExtractedTable } from '@/lib/ocr-types';

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

        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        
        const thresh = new cv.Mat();
        cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        const dilated = new cv.Mat();
        cv.dilate(thresh, dilated, kernel);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const detectedRegions: TableRegion[] = [];
        const minArea = (src.cols * src.rows) * 0.005; 

        for (let i = 0; i < contours.size(); ++i) {
          const cnt = contours.get(i);
          const rect = cv.boundingRect(cnt);
          const area = rect.width * rect.height;

          if (area > minArea) {
            detectedRegions.push({
              id: `auto-${Math.random().toString(36).substr(2, 9)}`,
              name: `table_${detectedRegions.length + 1}`,
              x: (rect.x / src.cols) * 100,
              y: (rect.y / src.rows) * 100,
              width: (rect.width / src.cols) * 100,
              height: (rect.height / src.rows) * 100,
              verticalLines: [],
              horizontalLines: []
            });
          }
        }

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
 * Core logic to detect lines in a single ROI
 */
async function detectLinesForRoi(cv: any, binary: any, region: TableRegion): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  let x = Math.floor((region.x / 100) * binary.cols);
  let y = Math.floor((region.y / 100) * binary.rows);
  let w = Math.floor((region.width / 100) * binary.cols);
  let h = Math.floor((region.height / 100) * binary.rows);

  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(binary.cols - x, w);
  h = Math.min(binary.rows - y, h);

  const vPositions: number[] = [];
  const hPositions: number[] = [];

  if (w > 0 && h > 0) {
    const rect = new cv.Rect(x, y, w, h);
    const roi = binary.roi(rect);
    
    const horizontalSize = Math.max(2, Math.floor(w / 30));
    const horizontalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horizontalSize, 1));
    const verticalSize = Math.max(2, Math.floor(h / 30));
    const verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, verticalSize));

    const horizontal = new cv.Mat();
    cv.erode(roi, horizontal, horizontalStructure);
    cv.dilate(horizontal, horizontal, horizontalStructure);

    const vertical = new cv.Mat();
    cv.erode(roi, vertical, verticalStructure);
    cv.dilate(vertical, vertical, verticalStructure);

    for (let j = 0; j < vertical.cols; j++) {
      let count = 0;
      for (let i = 0; i < vertical.rows; i++) {
        if (vertical.ucharAt(i, j) > 128) count++;
      }
      if (count > vertical.rows * 0.5) vPositions.push((j / w) * 100);
    }

    for (let i = 0; i < horizontal.rows; i++) {
      let count = 0;
      for (let j = 0; j < horizontal.cols; j++) {
        if (horizontal.ucharAt(i, j) > 128) count++;
      }
      if (count > horizontal.cols * 0.5) hPositions.push((i / h) * 100);
    }

    horizontal.delete(); vertical.delete(); roi.delete();
    horizontalStructure.delete(); verticalStructure.delete();
  }

  const filter = (lines: number[]) => {
    const unique = Array.from(new Set(lines)).sort((a, b) => a - b);
    return unique.filter((pos, idx) => idx === 0 || Math.abs(pos - unique[idx - 1]) > 2);
  };

  return {
    vLines: filter(vPositions).map((p, i) => ({ id: `v-${i}-${Date.now()}`, type: 'vertical', position: p })),
    hLines: filter(hPositions).map((p, i) => ({ id: `h-${i}-${Date.now()}`, type: 'horizontal', position: p }))
  };
}

/**
 * Detects lines within specific table regions.
 */
export async function detectLinesInRegions(imageSrc: string, regions: TableRegion[]): Promise<TableRegion[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = async () => {
      try {
        if (!window.cv) throw new Error('OpenCV.js not loaded');
        const cv = window.cv;
        const src = cv.imread(img);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        const binary = new cv.Mat();
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 11, 2);

        const updatedRegions = [];
        for (const region of regions) {
          const { vLines, hLines } = await detectLinesForRoi(cv, binary, region);
          updatedRegions.push({
            ...region,
            verticalLines: vLines,
            horizontalLines: hLines
          });
        }

        src.delete(); gray.delete(); binary.delete();
        resolve(updatedRegions);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

/**
 * Detects lines in a single region (used for refinement).
 */
export async function detectLinesInSingleRegion(imageSrc: string, region: TableRegion): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = async () => {
      try {
        if (!window.cv) throw new Error('OpenCV.js not loaded');
        const cv = window.cv;
        const src = cv.imread(img);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        const binary = new cv.Mat();
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 11, 2);

        const lines = await detectLinesForRoi(cv, binary, region);

        src.delete(); gray.delete(); binary.delete();
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

/**
 * Process all tables on a page using Tesseract.js
 */
export async function processTablesOnPage(
  imageSrc: string, 
  regions: TableRegion[], 
  language: string,
  onProgress?: (progress: number) => void
): Promise<ExtractedTable[]> {
  const worker = await createWorker(language);
  
  const img = new Image();
  img.src = imageSrc;
  await new Promise(resolve => img.onload = resolve);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  const allResults: ExtractedTable[] = [];
  const totalCells = regions.reduce((acc, r) => {
    const vCount = (r.verticalLines?.length || 0) + 1;
    const hCount = (r.horizontalLines?.length || 0) + 1;
    return acc + (vCount * hCount);
  }, 0);
  
  let processedCells = 0;

  for (const region of regions) {
    const vCoords = [0, ...(region.verticalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const hCoords = [0, ...(region.horizontalLines || []).map(l => l.position).sort((a, b) => a - b), 100];

    const tableX = (region.x / 100) * img.width;
    const tableY = (region.y / 100) * img.height;
    const tableW = (region.width / 100) * img.width;
    const tableH = (region.height / 100) * img.height;

    const rows: string[][] = [];

    for (let i = 0; i < hCoords.length - 1; i++) {
      const row: string[] = [];
      for (let j = 0; j < vCoords.length - 1; j++) {
        const x = tableX + (vCoords[j] / 100) * tableW;
        const y = tableY + (hCoords[i] / 100) * tableH;
        const w = ((vCoords[j + 1] - vCoords[j]) / 100) * tableW;
        const h = ((hCoords[i + 1] - hCoords[i]) / 100) * tableH;

        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          const { data: { text } } = await worker.recognize(canvas);
          row.push(text.trim());
        } else {
          row.push("");
        }
        
        processedCells++;
        if (onProgress) onProgress(processedCells / totalCells);
      }
      rows.push(row);
    }

    allResults.push({
      id: region.id,
      tableName: region.name,
      headers: rows[0] || [],
      rows: rows
    });
  }

  await worker.terminate();
  return allResults;
}
