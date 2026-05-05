'use client';

import { createWorker } from 'tesseract.js';
import { TableLine, TableRegion, ExtractedTable, PreprocessingOptions, OcrEngineConfig } from '@/lib/ocr-types';

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
  for (const region of regions) {
    try {
      const { vLines, hLines } = await detectLinesInSingleRegion(imageSrc, region);
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
  return updatedRegions;
}

/**
 * Detects grid lines within a single region using morphological operations.
 */
export async function detectLinesInSingleRegion(imageSrc: string, region: TableRegion): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        if (!window.cv || !window.cv.imread) {
          resolve({ vLines: [], hLines: [] });
          return;
        }
        const cv = window.cv;
        const src = cv.imread(img);
        
        // Crop to region
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

        // Detect Vertical Lines
        const vLines: TableLine[] = [];
        const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.floor(h / 20)));
        const vMat = new cv.Mat();
        cv.erode(thresh, vMat, vKernel);
        cv.dilate(vMat, vMat, vKernel);
        
        // Find vertical projections
        for (let j = 0; j < vMat.cols; j++) {
          let count = 0;
          for (let i = 0; i < vMat.rows; i++) {
            if (vMat.ucharAt(i, j) > 0) count++;
          }
          if (count > h * 0.7) { // Found a strong vertical line
            const pos = (j / vMat.cols) * 100;
            // Debounce/Merge close lines
            if (vLines.length === 0 || Math.abs(vLines[vLines.length - 1].position - pos) > 2) {
              vLines.push({ id: Math.random().toString(36).substr(2, 9), type: 'vertical', position: pos });
            }
          }
        }

        // Detect Horizontal Lines
        const hLines: TableLine[] = [];
        const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.floor(w / 20), 1));
        const hMat = new cv.Mat();
        cv.erode(thresh, hMat, hKernel);
        cv.dilate(hMat, hMat, hKernel);

        for (let i = 0; i < hMat.rows; i++) {
          let count = 0;
          for (let j = 0; j < hMat.cols; j++) {
            if (hMat.ucharAt(i, j) > 0) count++;
          }
          if (count > w * 0.7) { // Found a strong horizontal line
            const pos = (i / hMat.rows) * 100;
            if (hLines.length === 0 || Math.abs(hLines[hLines.length - 1].position - pos) > 2) {
              hLines.push({ id: Math.random().toString(36).substr(2, 9), type: 'horizontal', position: pos });
            }
          }
        }

        src.delete(); roi.delete(); gray.delete(); thresh.delete(); 
        vKernel.delete(); vMat.delete(); hKernel.delete(); hMat.delete();

        resolve({ vLines, hLines });
      } catch (err) {
        console.error("Line detection error:", err);
        resolve({ vLines: [], hLines: [] });
      }
    };
    img.onerror = () => resolve({ vLines: [], hLines: [] });
    img.src = imageSrc;
  });
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
          current.delete();
          current = deskewed;
          M.delete();
        }
      }
      threshForSkew.delete();
      points.delete();
    }

    if (opts.binarize) {
      const binary = new cv.Mat();
      const thresholdType = opts.thresholdType === 'binary_inv' ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY;
      const maxValue = opts.thresholdMaxValue || 255;

      if (opts.thresholdMethod === 'global') {
        cv.threshold(current, binary, opts.thresholdValue, maxValue, thresholdType);
      } else {
        const blockSize = Math.max(3, opts.thresholdBlockSize % 2 === 0 ? opts.thresholdBlockSize + 1 : opts.thresholdBlockSize);
        const adaptiveMethod = opts.adaptiveMethod === 'mean' ? cv.ADAPTIVE_THRESH_MEAN_C : cv.ADAPTIVE_THRESH_GAUSSIAN_C;

        cv.adaptiveThreshold(
          current, 
          binary, 
          maxValue, 
          adaptiveMethod, 
          thresholdType, 
          blockSize, 
          opts.thresholdC
        );
      }
      current.delete();
      current = binary;
    }

    return current;
  } catch (e) {
    console.warn("Preprocessing failed, returning clone", e);
    return src.clone();
  }
}

/**
 * Basic Canvas-based pre-processing
 */
function preprocessCanvasForOcr(ctx: CanvasRenderingContext2D, width: number, height: number, options?: PreprocessingOptions) {
  if (width <= 0 || height <= 0) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const method = options?.thresholdMethod || 'global';
  const threshVal = options?.thresholdValue || 128;
  const inv = options?.thresholdType === 'binary_inv';

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    
    let val;
    if (method === 'global') {
      val = luminance > threshVal ? 255 : 0;
    } else {
      val = luminance > 160 ? 255 : 0; 
    }
    
    if (inv) val = 255 - val;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Generates a preprocessed preview data URI for a region.
 */
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

      if (w <= 0 || h <= 0) {
        resolve(imageSrc);
        return;
      }

      canvas.width = w;
      canvas.height = h;

      if (window.cv && window.cv.imread) {
        try {
          const cv = window.cv;
          const src = cv.imread(img);
          const tableX = Math.max(0, Math.floor(x));
          const tableY = Math.max(0, Math.floor(y));
          const tableW = Math.min(src.cols - tableX, Math.floor(w));
          const tableH = Math.min(src.rows - tableY, Math.floor(h));

          if (tableW > 0 && tableH > 0) {
            const regionRect = new cv.Rect(tableX, tableY, tableW, tableH);
            const regionMat = src.roi(regionRect);
            const processedMat = preprocessMatForOcr(cv, regionMat, options);
            cv.imshow(canvas, processedMat);
            const dataUrl = canvas.toDataURL();
            src.delete();
            regionMat.delete();
            processedMat.delete();
            resolve(dataUrl);
            return;
          }
          src.delete();
        } catch (e) {
          console.error("OpenCV preview failed", e);
        }
      }

      if (ctx) {
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        if (options.binarize) {
          preprocessCanvasForOcr(ctx, w, h, options);
        }
        resolve(canvas.toDataURL());
      } else {
        resolve(imageSrc);
      }
    };
    img.onerror = () => resolve(imageSrc);
    img.src = imageSrc;
  });
}

async function callAiEngine(imageUri: string, config: OcrEngineConfig): Promise<string> {
  if (config.type !== 'ai' || !config.aiConfig) throw new Error('AI Config missing');
  const { apiUrl, apiKey, model, systemPrompt } = config.aiConfig;
  
  const base64Image = imageUri.split(',')[1];

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ],
      max_tokens: 100
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI Engine error: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
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
  if (isTesseract) {
    worker = await createWorker(language);
  }

  const img = new Image();
  img.src = imageSrc;
  await new Promise(resolve => img.onload = resolve);

  const cv = window.cv;
  const useCv = !!(cv && cv.imread);
  let srcMat: any = null;
  if (useCv) {
    try { srcMat = cv.imread(img); } catch (e) { console.warn("OpenCV fail", e); }
  }

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
        const regionRect = new cv.Rect(tableX, tableY, tableW, tableH);
        const regionMat = srcMat.roi(regionRect);
        const processedRegionMat = preprocessMatForOcr(cv, regionMat, region.preprocessing);
        cv.imshow(tempCanvas, processedRegionMat);
        regionMat.delete();
        processedRegionMat.delete();
      } catch (e) {
        fallbackToCanvas(img, region, tempCanvas, true, region.preprocessing);
      }
    } else {
      fallbackToCanvas(img, region, tempCanvas, true, region.preprocessing);
    }

    const rows: string[][] = [];
    const cellPadding = 2;

    for (let i = 0; i < hCoords.length - 1; i++) {
      const row: string[] = [];
      for (let j = 0; j < vCoords.length - 1; j++) {
        let x = (vCoords[j] / 100) * tempCanvas.width - cellPadding;
        let y = (hCoords[i] / 100) * tempCanvas.height - cellPadding;
        let w = ((vCoords[j + 1] - vCoords[j]) / 100) * tempCanvas.width + (cellPadding * 2);
        let h = ((hCoords[i + 1] - hCoords[i]) / 100) * tempCanvas.height + (cellPadding * 2);
        
        x = Math.max(0, x); y = Math.max(0, y);
        w = Math.min(tempCanvas.width - x, w); h = Math.min(tempCanvas.height - y, h);

        if (w > 1 && h > 1) {
          canvas.width = w; canvas.height = h;
          ctx.drawImage(tempCanvas, x, y, w, h, 0, 0, w, h);
          
          let text = "";
          if (isTesseract) {
            const result = await worker.recognize(canvas);
            text = result.data.text.trim();
          } else {
            text = await callAiEngine(canvas.toDataURL('image/jpeg'), engineConfig);
          }
          row.push(text);
        } else {
          row.push("");
        }
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
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const x = (region.x / 100) * img.width;
  const y = (region.y / 100) * img.height;
  const w = (region.width / 100) * img.width;
  const h = (region.height / 100) * img.height;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  if (preprocess) {
    preprocessCanvasForOcr(ctx, w, h, options);
  }
}
