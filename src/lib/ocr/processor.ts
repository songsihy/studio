
'use client';

import { createWorker } from 'tesseract.js';
import { TableLine, TableRegion, ExtractedTable, PreprocessingOptions, OcrEngineConfig } from '@/lib/ocr-types';
import { callAiEngineAction } from '@/app/actions/ai-ocr';

declare global {
  interface Window {
    cv: any;
  }
}

/**
 * Detects potential table regions in an image using OpenCV.js contour detection.
 */
export async function detectTableRegions(imageSrc: string): Promise<TableRegion[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        if (!window.cv || !window.cv.imread) {
          console.warn('OpenCV.js not loaded. Skipping auto-detection.');
          resolve([]);
          return;
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
              horizontalLines: [],
              preprocessing: {
                binarize: true,
                deskew: true,
                denoise: true,
                thresholdMethod: 'global',
                thresholdValue: 128,
                thresholdBlockSize: 31,
                thresholdC: 2,
                thresholdMaxValue: 255,
                adaptiveMethod: 'gaussian',
                thresholdType: 'binary'
              }
            });
          }
        }

        src.delete(); gray.delete(); blurred.delete(); thresh.delete(); 
        kernel.delete(); dilated.delete(); contours.delete(); hierarchy.delete();

        resolve(detectedRegions);
      } catch (err) {
        console.error("Region detection error:", err);
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = imageSrc;
  });
}

/**
 * Detects grid lines within multiple regions using specified language context.
 */
export async function detectLinesInRegions(imageSrc: string, regions: TableRegion[], language: string = 'eng'): Promise<TableRegion[]> {
  const updatedRegions: TableRegion[] = [];
  const worker = await createWorker(language);
  
  for (const region of regions) {
    try {
      const { vLines, hLines } = await detectLinesInSingleRegion(imageSrc, region, language, worker);
      updatedRegions.push({
        ...region,
        verticalLines: vLines,
        horizontalLines: hLines
      });
    } catch (e) {
      console.warn("Line detection failed for region", region.id, e);
      updatedRegions.push(region);
    }
  }
  
  await worker.terminate();
  return updatedRegions;
}

/**
 * Consolidates clustered lines into a single logical line.
 * Prioritizes physical Wired lines over Wireless guesses.
 * Within a cluster, favors the rightmost line if no wired lines exist.
 */
function mergeCloseLines(lines: TableLine[], threshold: number): TableLine[] {
  if (lines.length === 0) return [];
  
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const merged: TableLine[] = [];
  
  let currentGroup: TableLine[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const line = sorted[i];
    const lastInGroup = currentGroup[currentGroup.length - 1];
    
    if (line.position - lastInGroup.position < threshold) {
      currentGroup.push(line);
    } else {
      merged.push(selectBestInGroup(currentGroup));
      currentGroup = [line];
    }
  }
  
  merged.push(selectBestInGroup(currentGroup));
  
  return merged;
}

function selectBestInGroup(group: TableLine[]): TableLine {
  // If any line in the cluster is a Wired line (starts with 'w-'), we MUST reserve it.
  const wiredLines = group.filter(l => l.id.startsWith('w-'));
  if (wiredLines.length > 0) {
    // Favor the rightmost physical border if multiple exist in the cluster
    return wiredLines[wiredLines.length - 1];
  }
  // Otherwise, drop redundant left lines and pick the rightmost wireless guess
  return group[group.length - 1];
}

/**
 * Detects grid lines using a hybrid layout-aware approach.
 */
export async function detectLinesInSingleRegion(
  imageSrc: string, 
  region: TableRegion, 
  language: string = 'eng',
  existingWorker?: any
): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  return new Promise(async (resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = async () => {
      try {
        if (!window.cv || !window.cv.imread) {
          resolve({ vLines: [], hLines: [] });
          return;
        }
        const cv = window.cv;
        const src = cv.imread(img);
        
        const x = Math.max(0, Math.floor((region.x / 100) * src.cols));
        const y = Math.max(0, Math.floor((region.y / 100) * src.rows));
        const w = Math.min(src.cols - x, Math.floor((region.width / 100) * src.cols));
        const h = Math.min(src.rows - y, Math.floor((region.height / 100) * src.rows));
        
        if (w <= 0 || h <= 0) {
          src.delete();
          resolve({ vLines: [], hLines: [] });
          return;
        }

        const roi = src.roi(new cv.Rect(x, y, w, h));
        const gray = new cv.Mat();
        cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY, 0);

        const thresh = new cv.Mat();
        cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        let wiredV: TableLine[] = [];
        let wiredH: TableLine[] = [];
        let wirelessV: TableLine[] = [];
        let wirelessH: TableLine[] = [];

        // 1. Wired Pass (Physical borders detection)
        const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(2, Math.floor(h / 30))));
        const vMat = new cv.Mat();
        cv.erode(thresh, vMat, vKernel);
        cv.dilate(vMat, vMat, vKernel);
        for (let j = 0; j < vMat.cols; j++) {
          let count = 0;
          for (let i = 0; i < vMat.rows; i++) if (vMat.ucharAt(i, j) > 0) count++;
          if (count > h * 0.35) {
            wiredV.push({ id: `w-v-${j}`, type: 'vertical', position: (j / vMat.cols) * 100 });
          }
        }

        const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(2, Math.floor(w / 30)), 1));
        const hMat = new cv.Mat();
        cv.erode(thresh, hMat, hKernel);
        cv.dilate(hMat, hMat, hKernel);
        for (let i = 0; i < hMat.rows; i++) {
          let count = 0;
          for (let j = 0; j < hMat.cols; j++) if (hMat.ucharAt(i, j) > 0) count++;
          if (count > w * 0.35) {
            wiredH.push({ id: `w-h-${i}`, type: 'horizontal', position: (i / hMat.rows) * 100 });
          }
        }

        // 2. Wireless Pass (Layout analysis via OCR word positions)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        cv.imshow(tempCanvas, gray);
        const worker = existingWorker || await createWorker(language);
        const { data } = await worker.recognize(tempCanvas);
        const wordBoxes = data.words.map((w: any) => w.bbox);

        // Analyze vertical gaps between word boxes
        const xOccupancy = new Array(w).fill(false);
        wordBoxes.forEach((box: any) => {
          for (let i = Math.floor(box.x0); i < Math.ceil(box.x1); i++) if (i >= 0 && i < w) xOccupancy[i] = true;
        });
        findGapsInOccupancy(xOccupancy, 1).forEach(gap => {
          wirelessV.push({ id: `wl-v-${gap}`, type: 'vertical', position: (gap / w) * 100 });
        });

        // Analyze horizontal gaps between rows (clustering words into logical lines)
        const sortedWords = [...wordBoxes].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
        const rows: any[][] = [];
        if (sortedWords.length > 0) {
          let cluster = [sortedWords[0]];
          for (let i = 1; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            const prev = cluster[cluster.length - 1];
            const wordH = word.y1 - word.y0;
            const overlap = Math.min(word.y1, prev.y1) - Math.max(word.y0, prev.y0);
            if (overlap > wordH * 0.3) cluster.push(word);
            else { rows.push(cluster); cluster = [word]; }
          }
          rows.push(cluster);
        }
        for (let i = 0; i < rows.length - 1; i++) {
          const upper = Math.max(...rows[i].map(w => w.y1));
          const lower = Math.min(...rows[i+1].map(w => w.y0));
          wirelessH.push({ id: `wl-h-${i}`, type: 'horizontal', position: ((upper + lower) / 2 / h) * 100 });
        }

        // 3. Consolidation: Mix wired and wireless into one clean grid
        // Dropping left redundant lines and reserving physical lines.
        let finalV = mergeCloseLines([...wiredV, ...wirelessV], 1.5);
        let finalH = mergeCloseLines([...wiredH, ...wirelessH], 1.5);

        src.delete(); roi.delete(); gray.delete(); thresh.delete(); 
        vKernel.delete(); vMat.delete(); hKernel.delete(); hMat.delete();
        if (!existingWorker) await worker.terminate();

        resolve({ vLines: finalV, hLines: finalH });
      } catch (err) {
        console.error("Grid detection error:", err);
        resolve({ vLines: [], hLines: [] });
      }
    };
    img.src = imageSrc;
  });
}

function findGapsInOccupancy(occupancy: boolean[], minWidth: number): number[] {
  const gaps: number[] = [];
  let start = -1;
  for (let i = 0; i < occupancy.length; i++) {
    if (!occupancy[i]) {
      if (start === -1) start = i;
    } else {
      if (start !== -1) {
        const width = i - start;
        if (width >= minWidth) gaps.push(start + width / 2);
        start = -1;
      }
    }
  }
  if (start !== -1) {
    const width = occupancy.length - start;
    if (width >= minWidth) gaps.push(start + width / 2);
  }
  return gaps;
}

/**
 * Advanced image pre-processing for Tesseract OCR.
 */
function preprocessMatForOcr(cv: any, src: any, options?: PreprocessingOptions): any {
  try {
    const opts = options || { 
      binarize: true, deskew: true, denoise: true, thresholdMethod: 'global', thresholdValue: 128, 
      thresholdBlockSize: 31, thresholdC: 2, thresholdMaxValue: 255, adaptiveMethod: 'gaussian', thresholdType: 'binary'
    };
    let current = src.clone();
    
    if (current.channels() > 1) {
      let gray = new cv.Mat();
      cv.cvtColor(current, gray, cv.COLOR_RGBA2GRAY, 0);
      current.delete();
      current = gray;
    }

    if (opts.denoise) {
      const blurred = new cv.Mat();
      cv.medianBlur(current, blurred, 3);
      current.delete();
      current = blurred;
    }

    if (opts.binarize) {
      const binary = new cv.Mat();
      const thresholdType = opts.thresholdType === 'binary_inv' ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY;
      const maxValue = opts.thresholdMaxValue || 255;
      if (opts.thresholdMethod === 'global') {
        cv.threshold(current, binary, opts.thresholdValue, maxValue, thresholdType);
      } else {
        const blockSize = Math.max(3, opts.thresholdBlockSize % 2 === 0 ? opts.thresholdBlockSize + 1 : opts.thresholdBlockSize);
        cv.adaptiveThreshold(current, binary, maxValue, opts.adaptiveMethod === 'mean' ? cv.ADAPTIVE_THRESH_MEAN_C : cv.ADAPTIVE_THRESH_GAUSSIAN_C, thresholdType, blockSize, opts.thresholdC);
      }
      current.delete(); current = binary;
    }

    return current;
  } catch (e) {
    return src.clone();
  }
}

function preprocessCanvasForOcr(ctx: CanvasRenderingContext2D, width: number, height: number, options?: PreprocessingOptions) {
  if (width <= 0 || height <= 0) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const method = options?.thresholdMethod || 'global';
  const threshVal = options?.thresholdValue || 128;
  const inv = options?.thresholdType === 'binary_inv';

  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let val = method === 'global' ? (luminance > threshVal ? 255 : 0) : (luminance > 160 ? 255 : 0);
    if (inv) val = 255 - val;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

export async function getPreprocessedPreview(imageSrc: string, region: TableRegion, options: PreprocessingOptions): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const x = (region.x / 100) * img.width;
      const y = (region.y / 100) * img.height;
      const w = (region.width / 100) * img.width;
      const h = (region.height / 100) * img.height;
      if (w <= 0 || h <= 0) { resolve(imageSrc); return; }
      canvas.width = w; canvas.height = h;

      if (window.cv && window.cv.imread) {
        try {
          const cv = window.cv;
          const src = cv.imread(img);
          const tableX = Math.max(0, Math.floor(x));
          const tableY = Math.max(0, Math.floor(y));
          const tableW = Math.min(src.cols - tableX, Math.floor(w));
          const tableH = Math.min(src.rows - tableY, Math.floor(h));
          if (tableW > 0 && tableH > 0) {
            const regionMat = src.roi(new cv.Rect(tableX, tableY, tableW, tableH));
            const processedMat = preprocessMatForOcr(cv, regionMat, options);
            cv.imshow(canvas, processedMat);
            const dataUrl = canvas.toDataURL();
            src.delete(); regionMat.delete(); processedMat.delete();
            resolve(dataUrl); return;
          }
          src.delete();
        } catch (e) {}
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        if (options.binarize) preprocessCanvasForOcr(ctx, w, h, options);
        resolve(canvas.toDataURL());
      } else resolve(imageSrc);
    };
    img.src = imageSrc;
  });
}

/**
 * Process extraction for a whole page of tables using Step 3's layout hints.
 */
export async function processTablesOnPage(
  imageSrc: string, 
  regions: TableRegion[], 
  language: string,
  engineConfig: OcrEngineConfig,
  onProgress?: (progress: number) => void
): Promise<ExtractedTable[]> {
  const isTesseract = engineConfig.type === 'tesseract';
  let worker: any = null;
  if (isTesseract) worker = await createWorker(language);

  const img = new Image();
  img.src = imageSrc;
  await new Promise(resolve => img.onload = resolve);
  const cv = window.cv;
  const useCv = !!(cv && cv.imread);
  let srcMat: any = null;
  if (useCv) try { srcMat = cv.imread(img); } catch (e) {}

  const allResults: ExtractedTable[] = [];
  const totalRegions = regions.length;
  let processedRegions = 0;

  for (const region of regions) {
    const tempCanvas = document.createElement('canvas');
    if (useCv && srcMat) {
      try {
        let tableX = Math.max(0, Math.floor((region.x / 100) * srcMat.cols));
        let tableY = Math.max(0, Math.floor((region.y / 100) * srcMat.rows));
        let tableW = Math.min(srcMat.cols - tableX, Math.floor((region.width / 100) * srcMat.cols));
        let tableH = Math.min(srcMat.rows - tableY, Math.floor((region.height / 100) * srcMat.rows));
        const regionMat = srcMat.roi(new cv.Rect(tableX, tableY, tableW, tableH));
        const processedRegionMat = preprocessMatForOcr(cv, regionMat, region.preprocessing);
        cv.imshow(tempCanvas, processedRegionMat);
        regionMat.delete(); processedRegionMat.delete();
      } catch (e) { fallbackToCanvas(img, region, tempCanvas, true, region.preprocessing); }
    } else fallbackToCanvas(img, region, tempCanvas, true, region.preprocessing);

    const vCoords = [0, ...(region.verticalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const hCoords = [0, ...(region.horizontalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const rowsCount = hCoords.length - 1;
    const colsCount = vCoords.length - 1;
    
    const tableData: string[][] = Array.from({ length: rowsCount }, () => Array(colsCount).fill(""));

    if (isTesseract) {
      // Single-Pass Strategy for Tesseract: Assign detected words to grid cells
      const { data } = await worker.recognize(tempCanvas);
      data.words.forEach((word: any) => {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
        const xPct = (centerX / tempCanvas.width) * 100;
        const yPct = (centerY / tempCanvas.height) * 100;

        let colIdx = vCoords.findIndex((v, i) => i < vCoords.length - 1 && xPct >= v && xPct < vCoords[i + 1]);
        let rowIdx = hCoords.findIndex((h, i) => i < hCoords.length - 1 && yPct >= h && yPct < hCoords[i + 1]);

        if (colIdx !== -1 && rowIdx !== -1) {
          tableData[rowIdx][colIdx] = (tableData[rowIdx][colIdx] + " " + word.text).trim();
        }
      });
    } else {
      // AI Engine Strategy (Per-cell for maximum instruction precision)
      const ctx = tempCanvas.getContext('2d');
      const cellCanvas = document.createElement('canvas');
      const cellCtx = cellCanvas.getContext('2d');
      if (ctx && cellCtx) {
        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < colsCount; c++) {
            let x = (vCoords[c] / 100) * tempCanvas.width;
            let y = (hCoords[r] / 100) * tempCanvas.height;
            let w = ((vCoords[c + 1] - vCoords[c]) / 100) * tempCanvas.width;
            let h = ((hCoords[r + 1] - hCoords[r]) / 100) * tempCanvas.height;
            if (w > 1 && h > 1) {
              cellCanvas.width = w; cellCanvas.height = h;
              cellCtx.drawImage(tempCanvas, x, y, w, h, 0, 0, w, h);
              try {
                tableData[r][c] = await callAiEngineAction(cellCanvas.toDataURL('image/jpeg'), engineConfig.aiConfig.apiUrl, engineConfig.aiConfig.apiKey, engineConfig.aiConfig.model, engineConfig.aiConfig.systemPrompt);
              } catch (err) { tableData[r][c] = "[AI ERROR]"; }
            }
          }
        }
      }
    }

    allResults.push({ id: region.id, tableName: region.name, headers: tableData[0] || [], rows: tableData });
    processedRegions++;
    if (onProgress) onProgress(processedRegions / totalRegions);
  }

  if (srcMat) srcMat.delete();
  if (worker) await worker.terminate();
  return allResults;
}

function fallbackToCanvas(img: HTMLImageElement, region: TableRegion, canvas: HTMLCanvasElement, preprocess: boolean = false, options?: PreprocessingOptions) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const x = (region.x / 100) * img.width; const y = (region.y / 100) * img.height;
  const w = (region.width / 100) * img.width; const h = (region.height / 100) * img.height;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  if (preprocess) preprocessCanvasForOcr(ctx, w, h, options);
}
