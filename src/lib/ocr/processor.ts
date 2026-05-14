
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
 * Detects grid lines within a single region using both morphological analysis (wired)
 * and projection analysis (wireless/whitespace).
 */
export async function detectLinesInSingleRegion(imageSrc: string, region: TableRegion): Promise<{ vLines: TableLine[], hLines: TableLine[] }> {
  return new Promise((resolve) => {
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

        // --- 0. Quick Deskew for detection accuracy (Safe Check) ---
        const threshForSkew = new cv.Mat();
        cv.threshold(gray, threshForSkew, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        
        let detectionGray = gray.clone();
        if (cv.findNonZero) {
          try {
            const points = new cv.Mat();
            cv.findNonZero(threshForSkew, points);
            if (!points.empty()) {
              const box = cv.minAreaRect(points);
              let angle = box.angle;
              if (angle < -45) angle = angle + 90;
              if (Math.abs(angle) > 0.5) {
                const center = new cv.Point(gray.cols / 2, gray.rows / 2);
                const M = cv.getRotationMatrix2D(center, angle, 1.0);
                cv.warpAffine(gray, detectionGray, M, new cv.Size(gray.cols, gray.rows), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
                M.delete();
              }
            }
            points.delete();
          } catch (e) {
            console.warn("Deskew failed:", e);
          }
        }
        threshForSkew.delete();
        
        const thresh = new cv.Mat();
        cv.adaptiveThreshold(detectionGray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // --- 1. Morphological Detection (Wired Lines) ---
        const vLines: TableLine[] = [];
        const vKernelSize = Math.max(2, Math.floor(h / 30)); 
        const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vKernelSize));
        const vMat = new cv.Mat();
        cv.erode(thresh, vMat, vKernel);
        cv.dilate(vMat, vMat, vKernel);
        
        for (let j = 0; j < vMat.cols; j++) {
          let count = 0;
          for (let i = 0; i < vMat.rows; i++) {
            if (vMat.ucharAt(i, j) > 0) count++;
          }
          if (count > h * 0.4) { 
            const pos = (j / vMat.cols) * 100;
            if (vLines.length === 0 || Math.abs(vLines[vLines.length - 1].position - pos) > 1.5) {
              vLines.push({ id: `wired-v-${Math.random().toString(36).substr(2, 9)}`, type: 'vertical', position: pos });
            }
          }
        }

        const hLines: TableLine[] = [];
        const hKernelSize = Math.max(2, Math.floor(w / 30));
        const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hKernelSize, 1));
        const hMat = new cv.Mat();
        cv.erode(thresh, hMat, hKernel);
        cv.dilate(hMat, hMat, hKernel);

        for (let i = 0; i < hMat.rows; i++) {
          let count = 0;
          for (let j = 0; j < hMat.cols; j++) {
            if (hMat.ucharAt(i, j) > 0) count++;
          }
          if (count > w * 0.4) {
            const pos = (i / hMat.rows) * 100;
            if (hLines.length === 0 || Math.abs(hLines[hLines.length - 1].position - pos) > 1.5) {
              hLines.push({ id: `wired-h-${Math.random().toString(36).substr(2, 9)}`, type: 'horizontal', position: pos });
            }
          }
        }

        // --- 2. Directional Smearing & Projection Analysis (Wireless Detection) ---
        
        // 2a. Horizontal Projection (Finding Rows)
        const hSmeared = new cv.Mat();
        const hSmearKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 5));
        cv.dilate(thresh, hSmeared, hSmearKernel);

        const hProjection = new Array(hSmeared.rows).fill(0);
        for (let i = 0; i < hSmeared.rows; i++) {
          for (let j = 0; j < hSmeared.cols; j++) {
            if (hSmeared.ucharAt(i, j) > 0) hProjection[i]++;
          }
        }

        const smoothedH = smoothArray(hProjection, 3);
        const hGapThreshold = hSmeared.cols * 0.015; 
        const hMinWidth = Math.max(1, hSmeared.rows * 0.003);     
        
        const hGaps = findGaps(smoothedH, hMinWidth, hGapThreshold);
        hGaps.forEach(gapCenter => {
          const pos = (gapCenter / hSmeared.rows) * 100;
          if (pos > 1 && pos < 99 && !hLines.some(l => Math.abs(l.position - pos) < 3)) {
            hLines.push({ id: `wireless-h-${Math.random().toString(36).substr(2, 9)}`, type: 'horizontal', position: pos });
          }
        });

        // Heuristic: Estimate "Font Height"
        let avgRowHeight = 10;
        if (hLines.length > 1) {
          const gaps = [];
          for (let i = 1; i < hLines.length; i++) gaps.push(hLines[i].position - hLines[i-1].position);
          avgRowHeight = (gaps.reduce((a, b) => a + b, 0) / gaps.length) * (h / 100);
        }

        // 2b. Vertical Projection (Finding Columns)
        const vSmeared = new cv.Mat();
        const smearWidth = Math.max(8, Math.floor(avgRowHeight * 1.5)); 
        const vSmearKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(smearWidth, 2));
        cv.dilate(thresh, vSmeared, vSmearKernel);

        const vProjection = new Array(vSmeared.cols).fill(0);
        for (let j = 0; j < vSmeared.cols; j++) {
          for (let i = 0; i < vSmeared.rows; i++) {
            if (vSmeared.ucharAt(i, j) > 0) vProjection[j]++;
          }
        }

        const smoothedV = smoothArray(vProjection, 3);
        const vGapThreshold = vSmeared.rows * 0.005; 
        const vMinWidth = Math.max(2, vSmeared.cols * 0.005); 
        
        const vGaps = findGaps(smoothedV, vMinWidth, vGapThreshold);
        vGaps.forEach(gapCenter => {
          const pos = (gapCenter / vSmeared.cols) * 100;
          if (pos > 3 && pos < 97 && !vLines.some(l => Math.abs(l.position - pos) < 4)) {
            vLines.push({ id: `wireless-v-${Math.random().toString(36).substr(2, 9)}`, type: 'vertical', position: pos });
          }
        });

        // Cleanup
        src.delete(); roi.delete(); gray.delete(); detectionGray.delete(); thresh.delete(); 
        vKernel.delete(); vMat.delete(); hKernel.delete(); hMat.delete();
        vSmeared.delete(); vSmearKernel.delete(); hSmeared.delete(); hSmearKernel.delete();

        vLines.sort((a, b) => a.position - b.position);
        hLines.sort((a, b) => a.position - b.position);

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
 * Smoothing helper for projection arrays
 */
function smoothArray(data: number[], windowSize: number): number[] {
  const result = [];
  const halfWindow = Math.floor(windowSize / 2);
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < data.length) {
        sum += data[j];
        count++;
      }
    }
    result.push(sum / count);
  }
  return result;
}

/**
 * Helper to find gaps (zero or low density) in a projection array.
 */
function findGaps(projection: number[], minWidth: number, threshold: number): number[] {
  const gaps: number[] = [];
  let gapStart = -1;
  
  for (let i = 0; i < projection.length; i++) {
    if (projection[i] <= threshold) {
      if (gapStart === -1) gapStart = i;
    } else {
      if (gapStart !== -1) {
        const gapWidth = i - gapStart;
        if (gapWidth >= minWidth) {
          gaps.push(gapStart + gapWidth / 2);
        }
        gapStart = -1;
      }
    }
  }
  
  if (gapStart !== -1) {
    const gapWidth = projection.length - gapStart;
    if (gapWidth >= minWidth) {
      gaps.push(gapStart + gapWidth / 2);
    }
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

    if (opts.deskew && cv.findNonZero) {
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
            current.delete();
            current = deskewed;
            M.delete();
          }
        }
        threshForSkew.delete();
        points.delete();
      } catch (e) {
        console.warn("Deskew skip:", e);
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
 * Basic Canvas-based pre-processing fallback
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

/**
 * Main function to process all tables on a document page.
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
            const apiUrl = engineConfig.aiConfig.apiUrl;
            const isLocal = apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1') || apiUrl.includes('.local');
            
            if (isLocal) {
              try {
                const imageUri = canvas.toDataURL('image/jpeg');
                const base64Image = imageUri.split(',')[1];
                
                let targetUrl = apiUrl;
                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                  targetUrl = 'http://' + targetUrl;
                }

                const response = await fetch(targetUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${engineConfig.aiConfig.apiKey}`
                  },
                  body: JSON.stringify({
                    model: engineConfig.aiConfig.model,
                    messages: [
                      {
                        role: 'user',
                        content: [
                          { type: 'text', text: engineConfig.aiConfig.systemPrompt },
                          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                      }
                    ],
                    max_tokens: 1000
                  })
                });

                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`Local AI API error (${response.status}): ${errorText || response.statusText}`);
                }

                const data = await response.json();
                text = (data.choices?.[0]?.message?.content || data.output?.text || "").trim();
              } catch (err) {
                console.error("Local AI Fetch error:", err);
                if (err instanceof TypeError && err.message.includes('fetch')) {
                  text = "[CORS ERROR: Your local AI server is blocking this request. Start your server with CORS enabled (e.g., OLLAMA_ORIGINS=\"*\" or --cors for llama.cpp)]";
                } else {
                  text = `[ERROR: ${err instanceof Error ? err.message : String(err)}]`;
                }
              }
            } else {
              try {
                text = await callAiEngineAction(
                  canvas.toDataURL('image/jpeg'), 
                  engineConfig.aiConfig.apiUrl,
                  engineConfig.aiConfig.apiKey,
                  engineConfig.aiConfig.model,
                  engineConfig.aiConfig.systemPrompt
                );
              } catch (err) {
                text = `[SERVER ACTION ERROR: ${err instanceof Error ? err.message : String(err)}]`;
              }
            }
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
