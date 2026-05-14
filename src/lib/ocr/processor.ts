
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
                binarize: false,
                deskew: false,
                denoise: false,
                thresholdMethod: 'global',
                thresholdValue: 128,
                thresholdBlockSize: 31,
                thresholdC: 2,
                thresholdMaxValue: 255,
                adaptiveMethod: 'gaussian',
                thresholdType: 'binary',
                showTextBoxes: false
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
export async function detectLinesInRegions(imageSrc: string, regions: TableRegion[], language: string = 'eng+chi_tra'): Promise<TableRegion[]> {
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
 * Rule: "Reserve the wired line first" & "Drop the left lines".
 */
function mergeCloseLines(lines: TableLine[], threshold: number): TableLine[] {
  if (lines.length === 0) return [];
  
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const merged: TableLine[] = [];
  
  if (sorted.length === 0) return [];

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
  // Priority: 1. Reserve Wired lines first (physical borders).
  // Priority: 2. In any cluster, drop the left lines and keep the rightmost one.
  const wired = group.filter(l => l.id.startsWith('w-'));
  if (wired.length > 0) {
    // If multiple wired lines, pick the rightmost one per "Drop-Left" instruction
    return wired[wired.length - 1];
  }
  // Otherwise pick the rightmost wireless guess
  return group[group.length - 1];
}

/**
 * Detects grid lines using a hybrid layout-aware approach.
 */
export async function detectLinesInSingleRegion(
  imageSrc: string, 
  region: TableRegion, 
  language: string = 'eng+chi_tra',
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

        // 2. Wireless Pass (Layout analysis with Tesseract)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        cv.imshow(tempCanvas, gray);
        const worker = existingWorker || await createWorker(language);
        const { data } = await worker.recognize(tempCanvas);
        const wordBoxes = data.words.map((word: any) => word.bbox);

        // Occupancy analysis for columns with word dilation to prevent cutting through words
        const xOccupancy = new Array(w).fill(false);
        wordBoxes.forEach((box: any) => {
          const charHeightEstimate = box.y1 - box.y0;
          const hDilation = charHeightEstimate * 0.6; // Connect nearby chars horizontally
          const startX = Math.floor(box.x0 - hDilation);
          const endX = Math.ceil(box.x1 + hDilation);
          for (let i = startX; i < endX; i++) if (i >= 0 && i < w) xOccupancy[i] = true;
        });
        
        const vGapThreshold = Math.max(1, Math.floor(w * 0.015)); 
        findGapsInOccupancy(xOccupancy, vGapThreshold).forEach(gap => {
          wirelessV.push({ id: `wl-v-${gap}`, type: 'vertical', position: (gap / w) * 100 });
        });

        // Row clustering for rows
        const sortedWords = [...wordBoxes].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
        const rows: any[][] = [];
        if (sortedWords.length > 0) {
          let cluster = [sortedWords[0]];
          for (let i = 1; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            const prev = cluster[cluster.length - 1];
            const wordH = word.y1 - word.y0;
            const overlap = Math.min(word.y1, prev.y1) - Math.max(word.y0, prev.y0);
            if (overlap > wordH * 0.35) cluster.push(word);
            else { rows.push(cluster); cluster = [word]; }
          }
          rows.push(cluster);
        }
        
        for (let i = 0; i < rows.length - 1; i++) {
          const upper = Math.max(...rows[i].map(w => w.y1));
          const lower = Math.min(...rows[i+1].map(w => w.y0));
          wirelessH.push({ id: `wl-h-${i}`, type: 'horizontal', position: ((upper + lower) / 2 / h) * 100 });
        }

        // 3. Fusion & Pruning
        // Merge lines within 1.5% threshold using "Wired-First" and "Drop-Left" logic
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
  return gaps;
}

/**
 * Pre-processing for OCR engines.
 * Goal: Pure black text on white background.
 */
function preprocessMatForOcr(cv: any, src: any, options?: PreprocessingOptions): any {
  try {
    const opts = options || { 
      binarize: false, deskew: false, denoise: false, thresholdMethod: 'global', thresholdValue: 128, 
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
      current.delete(); 
      current = binary;
    }

    return current;
  } catch (e) {
    console.error("Preprocessing Error:", e);
    return src.clone();
  }
}

export async function getPreprocessedPreview(imageSrc: string, region: TableRegion, options: PreprocessingOptions, language: string = 'eng+chi_tra'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const x = (region.x / 100) * img.width;
      const y = (region.y / 100) * img.height;
      const w = (region.width / 100) * img.width;
      const h = (region.height / 100) * img.height;
      if (w <= 0 || h <= 0) { resolve(imageSrc); return; }
      canvas.width = w; canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageSrc); return; }

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
            
            // Visualization of detected text boxes if requested
            if (options.showTextBoxes) {
              const worker = await createWorker(language);
              const { data } = await worker.recognize(canvas);
              ctx.strokeStyle = '#ef4444'; 
              ctx.lineWidth = 1.5;
              data.words.forEach((word: any) => {
                ctx.strokeRect(word.bbox.x0, word.bbox.y0, word.bbox.x1 - word.bbox.x0, word.bbox.y1 - word.bbox.y0);
              });
              await worker.terminate();
            }

            const dataUrl = canvas.toDataURL();
            src.delete(); regionMat.delete(); processedMat.delete();
            resolve(dataUrl); return;
          }
          src.delete();
        } catch (e) { console.error(e); }
      }
      
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL());
    };
    img.src = imageSrc;
  });
}

/**
 * Step 4 Extraction using a single-pass OCR strategy per table region.
 * Uses high-resolution upscale for maximum accuracy.
 */
export async function processTablesOnPage(
  imageSrc: string, 
  regions: TableRegion[], 
  language: string,
  engineConfig: OcrEngineConfig,
  onProgress?: (progress: number) => void
): Promise<ExtractedTable[]> {
  const img = new Image();
  img.crossOrigin = 'Anonymous';
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
    const scale = 2.5; // Upscale for better recognition

    if (useCv && srcMat) {
      try {
        let tableX = Math.max(0, Math.floor((region.x / 100) * srcMat.cols));
        let tableY = Math.max(0, Math.floor((region.y / 100) * srcMat.rows));
        let tableW = Math.min(srcMat.cols - tableX, Math.floor((region.width / 100) * srcMat.cols));
        let tableH = Math.min(srcMat.rows - tableY, Math.floor((region.height / 100) * srcMat.rows));
        
        const regionMat = srcMat.roi(new cv.Rect(tableX, tableY, tableW, tableH));
        const processedRegionMat = preprocessMatForOcr(cv, regionMat, region.preprocessing);
        
        tempCanvas.width = tableW * scale;
        tempCanvas.height = tableH * scale;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          const offscreenCanvas = document.createElement('canvas');
          cv.imshow(offscreenCanvas, processedRegionMat);
          ctx.drawImage(offscreenCanvas, 0, 0, tableW, tableH, 0, 0, tempCanvas.width, tempCanvas.height);
        }
        regionMat.delete(); processedRegionMat.delete();
      } catch (e) { fallbackToCanvas(img, region, tempCanvas, scale); }
    } else fallbackToCanvas(img, region, tempCanvas, scale);

    const vCoords = [0, ...(region.verticalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const hCoords = [0, ...(region.horizontalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const rowsCount = hCoords.length - 1;
    const colsCount = vCoords.length - 1;
    
    const tableData: string[][] = Array.from({ length: rowsCount }, () => Array(colsCount).fill(""));

    if (engineConfig.type === 'tesseract') {
      const worker = await createWorker(language);
      const { data } = await worker.recognize(tempCanvas);
      
      // Map detected words into grid cells
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
      await worker.terminate();
    } else if (engineConfig.type === 'ai') {
      const cellCanvas = document.createElement('canvas');
      const cellCtx = cellCanvas.getContext('2d');
      if (cellCtx) {
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
  return allResults;
}

function fallbackToCanvas(img: HTMLImageElement, region: TableRegion, canvas: HTMLCanvasElement, scale: number = 1.0) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const x = (region.x / 100) * img.width; const y = (region.y / 100) * img.height;
  const w = (region.width / 100) * img.width; const h = (region.height / 100) * img.height;
  canvas.width = w * scale; canvas.height = h * scale;
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
}
