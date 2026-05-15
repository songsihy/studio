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
 * Offsets (removes) wired lines from the image using the detected lines as a mask.
 * This helps OCR by removing non-text structural elements.
 * 
 * CRITICAL: Only uses lines with 'w-' prefix (physical borders) to avoid masking
 * text that might sit on a virtual 'wireless' boundary.
 */
function applyWiredLineMask(cv: any, src: any, region: TableRegion): void {
  const wiredV = region.verticalLines.filter(l => l.id.startsWith('w-'));
  const wiredH = region.horizontalLines.filter(l => l.id.startsWith('w-'));

  if (!wiredV.length && !wiredH.length) return;
  
  const mask = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
  const white = new cv.Scalar(255);
  // Using a thickness that ensures the line is fully covered
  const thickness = 4; 

  wiredV.forEach(line => {
    const x = Math.floor((line.position / 100) * src.cols);
    cv.line(mask, {x: x, y: 0}, {x: x, y: src.rows}, white, thickness);
  });

  wiredH.forEach(line => {
    const y = Math.floor((line.position / 100) * src.rows);
    cv.line(mask, {x: 0, y: y}, {x: src.cols, y: y}, white, thickness);
  });

  // Set masked areas to background color (white)
  let bgColor;
  if (src.channels() === 4) bgColor = new cv.Scalar(255, 255, 255, 255);
  else if (src.channels() === 3) bgColor = new cv.Scalar(255, 255, 255);
  else bgColor = new cv.Scalar(255);

  src.setTo(bgColor, mask);
  
  mask.delete();
}

export async function detectTableRegions(imageSrc: string): Promise<TableRegion[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        if (!window.cv || !window.cv.imread) {
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
              extractionStrategy: 'single-pass',
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
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = imageSrc;
  });
}

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
  const wired = group.filter(l => l.id.startsWith('w-'));
  const candidates = wired.length > 0 ? wired : group;
  return candidates[candidates.length - 1];
}

export async function detectLinesInRegions(
  imageSrc: string, 
  regions: TableRegion[], 
  language: string = 'eng+chi_tra'
): Promise<TableRegion[]> {
  const worker = await createWorker(language);
  const results: TableRegion[] = [];
  for (const region of regions) {
    const { vLines, hLines } = await detectLinesInSingleRegion(imageSrc, region, language, worker);
    results.push({ ...region, verticalLines: vLines, horizontalLines: hLines });
  }
  await worker.terminate();
  return results;
}

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

        const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(2, Math.floor(h / 30))));
        const vMat = new cv.Mat();
        cv.erode(thresh, vMat, vKernel);
        cv.dilate(vMat, vMat, vKernel);
        for (let j = 0; j < vMat.cols; j++) {
          let count = 0;
          for (let i = 0; i < vMat.rows; i++) if (vMat.ucharAt(i, j) > 0) count++;
          if (count > h * 0.35) wiredV.push({ id: `w-v-${j}`, type: 'vertical', position: (j / vMat.cols) * 100 });
        }

        const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(2, Math.floor(w / 30)), 1));
        const hMat = new cv.Mat();
        cv.erode(thresh, hMat, hKernel);
        cv.dilate(hMat, hMat, hKernel);
        for (let i = 0; i < hMat.rows; i++) {
          let count = 0;
          for (let j = 0; j < hMat.cols; j++) if (hMat.ucharAt(i, j) > 0) count++;
          if (count > w * 0.35) wiredH.push({ id: `w-h-${i}`, type: 'horizontal', position: (i / hMat.rows) * 100 });
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        cv.imshow(tempCanvas, gray);
        const worker = existingWorker || await createWorker(language);
        const { data } = await worker.recognize(tempCanvas);

        const xOccupancy = new Array(w).fill(false);
        data.words.forEach((word: any) => {
          const charH = word.bbox.y1 - word.bbox.y0;
          const dilation = charH * 1.5; 
          const startX = Math.floor(word.bbox.x0 - dilation);
          const endX = Math.ceil(word.bbox.x1 + dilation);
          for (let i = startX; i < endX; i++) if (i >= 0 && i < w) xOccupancy[i] = true;
        });
        
        const vGapThreshold = Math.max(3, Math.floor(w * 0.015)); 
        findGapsInOccupancy(xOccupancy, vGapThreshold).forEach(gap => {
          wirelessV.push({ id: `wl-v-${gap}`, type: 'vertical', position: (gap / w) * 100 });
        });

        const sortedWords = [...data.words].map(w => w.bbox).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
        const rowClusters: any[][] = [];
        if (sortedWords.length > 0) {
          let cluster = [sortedWords[0]];
          for (let i = 1; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            const prev = cluster[cluster.length - 1];
            const overlap = Math.min(word.y1, prev.y1) - Math.max(word.y0, prev.y0);
            if (overlap > (word.y1 - word.y0) * 0.4) cluster.push(word);
            else { rowClusters.push(cluster); cluster = [word]; }
          }
          rowClusters.push(cluster);
        }
        
        for (let i = 0; i < rowClusters.length - 1; i++) {
          const upper = Math.max(...rowClusters[i].map(w => w.y1));
          const lower = Math.min(...rowClusters[i+1].map(w => w.y0));
          wirelessH.push({ id: `wl-h-${i}`, type: 'horizontal', position: ((upper + lower) / 2 / h) * 100 });
        }

        const finalV = mergeCloseLines([...wiredV, ...wirelessV], 1.5);
        const finalH = mergeCloseLines([...wiredH, ...wirelessH], 1.5);

        src.delete(); roi.delete(); gray.delete(); thresh.delete(); 
        vKernel.delete(); vMat.delete(); hKernel.delete(); hMat.delete();
        if (!existingWorker) await worker.terminate();
        resolve({ vLines: finalV, hLines: finalH });
      } catch (err) {
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
        if (i - start >= minWidth) gaps.push(start + (i - start) / 2);
        start = -1;
      }
    }
  }
  return gaps;
}

function preprocessMatForOcr(cv: any, src: any, options?: PreprocessingOptions): any {
  const opts = options || { binarize: false, deskew: false, denoise: false, thresholdMethod: 'global', thresholdValue: 128, thresholdBlockSize: 31, thresholdC: 2, thresholdMaxValue: 255, adaptiveMethod: 'gaussian', thresholdType: 'binary' };
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
      const bSize = Math.max(3, opts.thresholdBlockSize % 2 === 0 ? opts.thresholdBlockSize + 1 : opts.thresholdBlockSize);
      cv.adaptiveThreshold(current, binary, maxValue, opts.adaptiveMethod === 'mean' ? cv.ADAPTIVE_THRESH_MEAN_C : cv.ADAPTIVE_THRESH_GAUSSIAN_C, thresholdType, bSize, opts.thresholdC);
    }
    current.delete(); 
    current = binary;
  }
  return current;
}

export async function getPreprocessedPreview(imageSrc: string, region: TableRegion, options: PreprocessingOptions, language: string = 'eng+chi_tra'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = async () => {
      const canvas = document.createElement('canvas');
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
          const roi = src.roi(new cv.Rect((region.x / 100) * src.cols, (region.y / 100) * src.rows, (region.width / 100) * src.cols, (region.height / 100) * src.rows));
          
          // Determine if we are requesting a "raw" preview (e.g. for Copy button when preview is off)
          const isRaw = !options.binarize && !options.denoise && !options.deskew && !options.showTextBoxes;

          if (isRaw) {
            cv.imshow(canvas, roi);
            const dataUrl = canvas.toDataURL();
            src.delete(); roi.delete();
            resolve(dataUrl); return;
          }

          // Apply masking and processing for visual preview when cleanup is active
          applyWiredLineMask(cv, roi, region);
          const processed = preprocessMatForOcr(cv, roi, options);
          cv.imshow(canvas, processed);
          
          if (options.showTextBoxes) {
            const worker = await createWorker(language);
            const { data } = await worker.recognize(canvas);
            ctx.strokeStyle = '#22E1CC';
            ctx.lineWidth = 2;
            data.words.forEach((word: any) => {
              ctx.strokeRect(word.bbox.x0, word.bbox.y0, word.bbox.x1 - word.bbox.x0, word.bbox.y1 - word.bbox.y0);
            });
            await worker.terminate();
          }

          const dataUrl = canvas.toDataURL();
          src.delete(); roi.delete(); processed.delete();
          resolve(dataUrl); return;
        } catch (e) {
          console.error("Preview render error:", e);
        }
      }
      ctx.drawImage(img, (region.x / 100) * img.width, (region.y / 100) * img.height, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL());
    };
    img.src = imageSrc;
  });
}

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
  if (useCv) srcMat = cv.imread(img);
  const allResults: ExtractedTable[] = [];
  const totalRegions = regions.length;
  let processedRegionsCount = 0;

  for (const region of regions) {
    const scale = 2.5; 
    const vCoords = [0, ...(region.verticalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const hCoords = [0, ...(region.horizontalLines || []).map(l => l.position).sort((a, b) => a - b), 100];
    const rowsCount = hCoords.length - 1;
    const colsCount = vCoords.length - 1;
    const tableData: string[][] = Array.from({ length: rowsCount }, () => Array(colsCount).fill(""));
    const worker = await createWorker(language);

    if (region.extractionStrategy === 'single-pass' || engineConfig.type === 'ai') {
      const regionCanvas = document.createElement('canvas');
      if (useCv && srcMat) {
        const tableX = Math.max(0, Math.floor((region.x / 100) * srcMat.cols));
        const tableY = Math.max(0, Math.floor((region.y / 100) * srcMat.rows));
        const tableW = Math.floor((region.width / 100) * srcMat.cols);
        const tableH = Math.floor((region.height / 100) * srcMat.rows);
        const roi = srcMat.roi(new cv.Rect(tableX, tableY, tableW, tableH));
        
        applyWiredLineMask(cv, roi, region);

        const processed = preprocessMatForOcr(cv, roi, region.preprocessing);
        regionCanvas.width = tableW * scale; regionCanvas.height = tableH * scale;
        const ctx = regionCanvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        const offscreen = document.createElement('canvas');
        cv.imshow(offscreen, processed);
        ctx.drawImage(offscreen, 0, 0, tableW, tableH, 0, 0, regionCanvas.width, regionCanvas.height);
        roi.delete(); processed.delete();
      } else {
        fallbackToCanvas(img, region, regionCanvas, scale);
      }

      if (engineConfig.type === 'ai') {
        const cellCanvas = document.createElement('canvas');
        const cellCtx = cellCanvas.getContext('2d')!;
        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < colsCount; c++) {
            const x = (vCoords[c] / 100) * regionCanvas.width;
            const y = (hCoords[r] / 100) * regionCanvas.height;
            const w = ((vCoords[c+1] - vCoords[c]) / 100) * regionCanvas.width;
            const h = ((hCoords[r+1] - hCoords[r]) / 100) * regionCanvas.height;
            cellCanvas.width = w; cellCanvas.height = h;
            cellCtx.drawImage(regionCanvas, x, y, w, h, 0, 0, w, h);
            try {
              tableData[r][c] = await callAiEngineAction(cellCanvas.toDataURL('image/jpeg'), engineConfig.aiConfig.apiUrl, engineConfig.aiConfig.apiKey, engineConfig.aiConfig.model, engineConfig.aiConfig.systemPrompt);
            } catch (err) { tableData[r][c] = "[AI ERROR]"; }
          }
        }
      } else {
        const { data } = await worker.recognize(regionCanvas);
        data.words.forEach((word: any) => {
          const xPct = ((word.bbox.x0 + word.bbox.x1) / 2 / regionCanvas.width) * 100;
          const yPct = ((word.bbox.y0 + word.bbox.y1) / 2 / regionCanvas.height) * 100;
          const colIdx = vCoords.findIndex((v, i) => i < colsCount && xPct >= v && xPct < vCoords[i + 1]);
          const rowIdx = hCoords.findIndex((h, i) => i < rowsCount && yPct >= h && yPct < hCoords[i + 1]);
          if (colIdx !== -1 && rowIdx !== -1) tableData[rowIdx][colIdx] = (tableData[rowIdx][colIdx] + " " + word.text).trim();
        });

        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < colsCount; c++) {
            if (!tableData[r][c].trim()) {
              const cellCanvas = document.createElement('canvas');
              const x = (vCoords[c] / 100) * regionCanvas.width;
              const y = (hCoords[r] / 100) * regionCanvas.height;
              const w = ((vCoords[c+1] - vCoords[c]) / 100) * regionCanvas.width;
              const h = ((hCoords[r+1] - hCoords[r]) / 100) * regionCanvas.height;
              if (w > 2 && h > 2) {
                cellCanvas.width = w; cellCanvas.height = h;
                const cellCtx = cellCanvas.getContext('2d')!;
                cellCtx.drawImage(regionCanvas, x, y, w, h, 0, 0, w, h);
                const { data: cellData } = await worker.recognize(cellCanvas);
                tableData[r][c] = cellData.text.trim();
              }
            }
          }
        }
      }
    } else {
      let tableRoi: any = null;
      if (useCv && srcMat) {
        const tx = Math.max(0, Math.floor((region.x / 100) * srcMat.cols));
        const ty = Math.max(0, Math.floor((region.y / 100) * srcMat.rows));
        const tw = Math.floor((region.width / 100) * srcMat.cols);
        const th = Math.floor((region.height / 100) * srcMat.rows);
        tableRoi = srcMat.roi(new cv.Rect(tx, ty, tw, th));
        applyWiredLineMask(cv, tableRoi, region);
      }

      for (let r = 0; r < rowsCount; r++) {
        for (let c = 0; c < colsCount; c++) {
          const cellCanvas = document.createElement('canvas');
          const padding = 0.05; 
          const xStart = Math.max(0, vCoords[c] - (vCoords[c+1] - vCoords[c]) * padding);
          const xEnd = Math.min(100, vCoords[c+1] + (vCoords[c+1] - vCoords[c]) * padding);
          const yStart = Math.max(0, hCoords[r] - (hCoords[r+1] - hCoords[r]) * padding);
          const yEnd = Math.min(100, hCoords[r+1] + (hCoords[r+1] - hCoords[r]) * padding);
          
          if (useCv && tableRoi) {
            const cellX = Math.max(0, Math.floor((xStart / 100) * tableRoi.cols));
            const cellY = Math.max(0, Math.floor((yStart / 100) * tableRoi.rows));
            const cellW = Math.floor(((xEnd - xStart) / 100) * tableRoi.cols);
            const cellH = Math.floor(((yEnd - yStart) / 100) * tableRoi.rows);
            
            if (cellW > 0 && cellH > 0) {
              const cellRoi = tableRoi.roi(new cv.Rect(cellX, cellY, cellW, cellH));
              const processed = preprocessMatForOcr(cv, cellRoi, region.preprocessing);
              cellCanvas.width = cellW * scale; cellCanvas.height = cellH * scale;
              const ctx = cellCanvas.getContext('2d')!;
              const offscreen = document.createElement('canvas');
              cv.imshow(offscreen, processed);
              ctx.drawImage(offscreen, 0, 0, cellW, cellH, 0, 0, cellCanvas.width, cellCanvas.height);
              cellRoi.delete(); processed.delete();
            }
          } else { 
            const absRegion = { x: region.x + (xStart / 100) * region.width, y: region.y + (yStart / 100) * region.height, width: ((xEnd - xStart) / 100) * region.width, height: ((yEnd - yStart) / 100) * region.height };
            fallbackToCanvas(img, absRegion as any, cellCanvas, scale); 
          }
          
          if (cellCanvas.width > 0 && cellCanvas.height > 0) {
            const { data } = await worker.recognize(cellCanvas);
            tableData[r][c] = data.text.trim();
          }
        }
      }
      if (tableRoi) tableRoi.delete();
    }
    await worker.terminate();
    
    const finalData = cleanupTable(tableData);
    allResults.push({ id: region.id, tableName: region.name, headers: finalData[0] || [], rows: finalData });
    processedRegionsCount++;
    if (onProgress) onProgress(processedRegionsCount / totalRegions);
  }
  if (srcMat) srcMat.delete();
  return allResults;
}

export function cleanupTable(data: string[][]): string[][] {
  if (data.length === 0) return data;
  const filteredRows = data.filter(row => row.some(cell => cell.trim().length > 0));
  if (filteredRows.length === 0) return [];
  const colCount = filteredRows[0].length;
  const emptyCols = new Set<number>();
  for (let c = 0; c < colCount; c++) {
    if (filteredRows.every(row => row[c].trim().length === 0)) emptyCols.add(c);
  }
  return filteredRows.map(row => row.filter((_, c) => !emptyCols.has(c)));
}

function fallbackToCanvas(img: HTMLImageElement, region: TableRegion, canvas: HTMLCanvasElement, scale: number = 1.0) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const x = (region.x / 100) * img.width; const y = (region.y / 100) * img.height;
  const w = (region.width / 100) * img.width; const h = (region.height / 100) * img.height;
  canvas.width = w * scale; canvas.height = h * scale;
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
}
