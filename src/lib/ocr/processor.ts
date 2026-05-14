
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
 * Detects grid lines within multiple regions.
 */
export async function detectLinesInRegions(imageSrc: string, regions: TableRegion[]): Promise<TableRegion[]> {
  const updatedRegions: TableRegion[] = [];
  const worker = await createWorker('eng');
  
  for (const region of regions) {
    try {
      const { vLines, hLines } = await detectLinesInSingleRegion(imageSrc, region, worker);
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
 * Groups lines that are within a certain threshold and averages their positions.
 */
function mergeCloseLines(lines: TableLine[], threshold: number): TableLine[] {
  if (lines.length === 0) return [];
  
  // Sort by position
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const merged: TableLine[] = [];
  
  let currentGroup: TableLine[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const line = sorted[i];
    const lastInGroup = currentGroup[currentGroup.length - 1];
    
    // Check distance between current line and the last line in the group
    if (line.position - lastInGroup.position < threshold) {
      currentGroup.push(line);
    } else {
      // Average the positions in the current group
      const avgPos = currentGroup.reduce((acc, l) => acc + l.position, 0) / currentGroup.length;
      merged.push({
        id: currentGroup[0].id,
        type: currentGroup[0].type,
        position: avgPos
      });
      currentGroup = [line];
    }
  }
  
  // Merge final group
  const avgPos = currentGroup.reduce((acc, l) => acc + l.position, 0) / currentGroup.length;
  merged.push({
    id: currentGroup[0].id,
    type: currentGroup[0].type,
    position: avgPos
  });
  
  return merged;
}

/**
 * Detects grid lines using a hybrid approach:
 * 1. OpenCV Morphological Analysis (Wired Lines)
 * 2. Tesseract Layout Analysis (Wireless Lines via text block clustering)
 * 3. Whitespace Gap Detection (Fallback for empty/sparse areas)
 */
export async function detectLinesInSingleRegion(
  imageSrc: string, 
  region: TableRegion, 
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

        // Deskew attempt with safety check
        if (cv.findNonZero && cv.minAreaRect) {
          const threshForSkew = new cv.Mat();
          cv.threshold(gray, threshForSkew, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
          const points = new cv.Mat();
          try {
            cv.findNonZero(threshForSkew, points);
            if (!points.empty()) {
              const box = cv.minAreaRect(points);
              let angle = box.angle;
              if (angle < -45) angle = angle + 90;
              if (Math.abs(angle) > 0.4) {
                const center = new cv.Point(gray.cols / 2, gray.rows / 2);
                const M = cv.getRotationMatrix2D(center, angle, 1.0);
                cv.warpAffine(gray, gray, M, new cv.Size(gray.cols, gray.rows), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
                M.delete();
              }
            }
          } catch (e) { console.warn("Deskewing skip:", e); }
          threshForSkew.delete(); points.delete();
        }

        const thresh = new cv.Mat();
        cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        let vLines: TableLine[] = [];
        let hLines: TableLine[] = [];

        // --- 1. Morphological Wired Detection ---
        const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(2, Math.floor(h / 25))));
        const vMat = new cv.Mat();
        cv.erode(thresh, vMat, vKernel);
        cv.dilate(vMat, vMat, vKernel);
        for (let j = 0; j < vMat.cols; j++) {
          let count = 0;
          for (let i = 0; i < vMat.rows; i++) if (vMat.ucharAt(i, j) > 0) count++;
          if (count > h * 0.45) {
            const pos = (j / vMat.cols) * 100;
            vLines.push({ id: `wired-v-${Math.random().toString(36).substr(2, 9)}`, type: 'vertical', position: pos });
          }
        }

        const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(2, Math.floor(w / 25)), 1));
        const hMat = new cv.Mat();
        cv.erode(thresh, hMat, hKernel);
        cv.dilate(hMat, hMat, hKernel);
        for (let i = 0; i < hMat.rows; i++) {
          let count = 0;
          for (let j = 0; j < hMat.cols; j++) if (hMat.ucharAt(i, j) > 0) count++;
          if (count > w * 0.45) {
            const pos = (i / hMat.rows) * 100;
            hLines.push({ id: `wired-h-${Math.random().toString(36).substr(2, 9)}`, type: 'horizontal', position: pos });
          }
        }

        // --- 2. Tesseract Layout Pass (Wireless Extraction) ---
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        cv.imshow(tempCanvas, gray);
        
        const worker = existingWorker || await createWorker('eng');
        const { data } = await worker.recognize(tempCanvas);
        const wordBoxes = data.words.map((w: any) => w.bbox);

        if (wordBoxes.length > 0) {
          // Vertical Wireless
          const xOccupancy = new Array(w).fill(false);
          wordBoxes.forEach((box: any) => {
            for (let i = box.x0; i < box.x1; i++) if (i >= 0 && i < w) xOccupancy[i] = true;
          });
          const vGaps = findGapsInOccupancy(xOccupancy, Math.max(1, Math.floor(w * 0.002)));
          vGaps.forEach(gapCenter => {
            const pos = (gapCenter / w) * 100;
            vLines.push({ id: `layout-v-${Math.random().toString(36).substr(2, 9)}`, type: 'vertical', position: pos });
          });

          // Horizontal Wireless (Rows) - Clustering Logic
          const sortedWords = [...wordBoxes].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
          const rows: any[][] = [];
          if (sortedWords.length > 0) {
            let currentCluster = [sortedWords[0]];
            for (let i = 1; i < sortedWords.length; i++) {
              const word = sortedWords[i];
              const prevWord = currentCluster[currentCluster.length - 1];
              const wordH = word.y1 - word.y0;
              const overlap = Math.min(word.y1, prevWord.y1) - Math.max(word.y0, prevWord.y0);
              const verticalDist = Math.abs((word.y0 + word.y1) / 2 - (prevWord.y0 + prevWord.y1) / 2);
              if (overlap > wordH * 0.3 || verticalDist < wordH * 0.5) {
                currentCluster.push(word);
              } else {
                rows.push(currentCluster);
                currentCluster = [word];
              }
            }
            rows.push(currentCluster);
          }

          for (let i = 0; i < rows.length - 1; i++) {
            const upperY1 = Math.max(...rows[i].map(w => w.y1));
            const lowerY0 = Math.min(...rows[i + 1].map(w => w.y0));
            const boundaryY = (upperY1 + lowerY0) / 2;
            const pos = (boundaryY / h) * 100;
            hLines.push({ id: `layout-h-${Math.random().toString(36).substr(2, 9)}`, type: 'horizontal', position: pos });
          }
        }

        // --- 3. Pure Whitespace Fallback ---
        const yOccupancy = new Array(h).fill(false);
        for (let i = 0; i < h; i++) {
          let count = 0;
          for (let j = 0; j < w; j++) if (thresh.ucharAt(i, j) > 0) count++;
          if (count > w * 0.005) yOccupancy[i] = true;
        }
        const hGaps = findGapsInOccupancy(yOccupancy, 1);
        hGaps.forEach(gapCenter => {
          const pos = (gapCenter / h) * 100;
          hLines.push({ id: `ws-h-${Math.random().toString(36).substr(2, 9)}`, type: 'horizontal', position: pos });
        });

        // --- 4. Final Merging and Cleaning ---
        // Threshold: merge lines within 1.2% of each other
        vLines = mergeCloseLines(vLines, 1.2);
        hLines = mergeCloseLines(hLines, 1.2);

        // Keep lines away from extreme edges
        vLines = vLines.filter(l => l.position > 0.5 && l.position < 99.5);
        hLines = hLines.filter(l => l.position > 0.5 && l.position < 99.5);

        // Cleanup OpenCV
        src.delete(); roi.delete(); gray.delete(); thresh.delete(); 
        vKernel.delete(); vMat.delete(); hKernel.delete(); hMat.delete();
        if (!existingWorker) await worker.terminate();

        vLines.sort((a, b) => a.position - b.position);
        hLines.sort((a, b) => a.position - b.position);

        resolve({ vLines, hLines });
      } catch (err) {
        console.error("Hybrid line detection error:", err);
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
 * Advanced image pre-processing for a region mat using OpenCV.
 */
function preprocessMatForOcr(cv: any, src: any, options?: PreprocessingOptions): any {
  try {
    const opts = options || { 
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

    if (opts.deskew) {
      if (cv.findNonZero && cv.minAreaRect) {
        try {
          const threshForSkew = new cv.Mat();
          cv.threshold(current, threshForSkew, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
          const points = new cv.Mat();
          cv.findNonZero(threshForSkew, points);
          if (!points.empty()) {
            const box = cv.minAreaRect(points);
            let angle = box.angle;
            if (angle < -45) angle = angle + 90;
            if (Math.abs(angle) > 0.3) {
              const center = new cv.Point(current.cols / 2, current.rows / 2);
              const M = cv.getRotationMatrix2D(center, angle, 1.0);
              const deskewed = new cv.Mat();
              cv.warpAffine(current, deskewed, M, new cv.Size(current.cols, current.rows), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
              current.delete(); current = deskewed;
              M.delete();
            }
          }
          threshForSkew.delete(); points.delete();
        } catch (e) { console.warn("Deskew fail:", e); }
      }
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
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
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
      const ctx = canvas.getContext('2d');
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
      if (ctx) {
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        if (options.binarize) preprocessCanvasForOcr(ctx, w, h, options);
        resolve(canvas.toDataURL());
      } else resolve(imageSrc);
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

    const rows: string[][] = [];
    for (let i = 0; i < hCoords.length - 1; i++) {
      const row: string[] = [];
      for (let j = 0; j < vCoords.length - 1; j++) {
        let x = (vCoords[j] / 100) * tempCanvas.width;
        let y = (hCoords[i] / 100) * tempCanvas.height;
        let w = ((vCoords[j + 1] - vCoords[j]) / 100) * tempCanvas.width;
        let h = ((hCoords[i + 1] - hCoords[i]) / 100) * tempCanvas.height;
        if (w > 1 && h > 1) {
          canvas.width = w; canvas.height = h;
          ctx.drawImage(tempCanvas, x, y, w, h, 0, 0, w, h);
          let text = "";
          if (isTesseract) {
            const result = await worker.recognize(canvas);
            text = result.data.text.trim();
          } else {
            const apiUrl = engineConfig.aiConfig.apiUrl;
            const isLocal = apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1');
            if (isLocal) {
              try {
                const response = await fetch(apiUrl.startsWith('http') ? apiUrl : 'http://' + apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${engineConfig.aiConfig.apiKey}` },
                  body: JSON.stringify({ model: engineConfig.aiConfig.model, messages: [{ role: 'user', content: [{ type: 'text', text: engineConfig.aiConfig.systemPrompt }, { type: 'image_url', image_url: { url: canvas.toDataURL('image/jpeg') } }] }], max_tokens: 1000 })
                });
                const data = await response.json();
                text = (data.choices?.[0]?.message?.content || data.output?.text || "").trim();
              } catch (err) { text = "[LOCAL AI ERROR: Check CORS/Connection]"; }
            } else {
              try { text = await callAiEngineAction(canvas.toDataURL('image/jpeg'), engineConfig.aiConfig.apiUrl, engineConfig.aiConfig.apiKey, engineConfig.aiConfig.model, engineConfig.aiConfig.systemPrompt); } catch (err) { text = "[SERVER ERROR]"; }
            }
          }
          row.push(text);
        } else row.push("");
        processedCells++;
        if (onProgress) onProgress(processedCells / totalCells);
      }
      rows.push(row);
    }
    allResults.push({ id: region.id, tableName: region.name, headers: rows[0] || [], rows: rows });
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
