"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableLine, TableRegion, PreprocessingOptions, OcrEngineType, ExtractionStrategy } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { Plus, X, Trash2, Wand2, Loader2, Sparkles, Eye, EyeOff, BoxSelect, Cpu, Bot, PenTool, Layers, Copy, Grid3X3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { detectLinesInSingleRegion, getPreprocessedPreview } from '@/lib/ocr/processor';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

interface LineEditorProps {
  imageSrc: string | null;
  cropRect: TableRegion;
  vLines: TableLine[];
  hLines: TableLine[];
  onLinesChange: (vLines: TableLine[], hLines: TableLine[]) => void;
  onPreprocessingChange?: (options: PreprocessingOptions) => void;
  onStrategyChange?: (strategy: ExtractionStrategy) => void;
  title: string;
  language?: string;
  engineType?: OcrEngineType;
}

export const LineEditor: React.FC<LineEditorProps> = ({ 
  imageSrc, 
  cropRect, 
  vLines, 
  hLines, 
  onLinesChange,
  onPreprocessingChange,
  onStrategyChange,
  title,
  language = 'eng+chi_tra',
  engineType = 'tesseract'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<{ id: string; type: 'v' | 'h' } | null>(null);
  const [addMode, setAddMode] = useState<'v' | 'h' | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number, h: number } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [showProcessedPreview, setShowProcessedPreview] = useState(false);
  const [processedImageUri, setProcessedImageUri] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const { toast } = useToast();

  const preprocessing = cropRect.preprocessing;
  const strategy = cropRect.extractionStrategy || 'single-pass';

  useEffect(() => {
    if (imageSrc) {
      const img = new Image();
      img.onload = () => setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = imageSrc;
    }
  }, [imageSrc]);

  useEffect(() => {
    if (showProcessedPreview && imageSrc) {
      updateProcessedPreview();
    } else {
      setProcessedImageUri(null);
    }
  }, [showProcessedPreview, preprocessing, imageSrc, cropRect.x, cropRect.y, cropRect.width, cropRect.height]);

  const updateProcessedPreview = async () => {
    if (!imageSrc) return;
    setIsPreviewLoading(true);
    try {
      const uri = await getPreprocessedPreview(imageSrc, cropRect, preprocessing, language);
      setProcessedImageUri(uri);
    } catch (e) {
      console.error("Preview update error:", e);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  /**
   * Copies the current view to clipboard.
   * withGrid parameter draws the red table lines on the exported image.
   */
  const copyToClipboard = async (withGrid: boolean = false) => {
    if (!imageSrc) return;
    setIsPreviewLoading(true);
    try {
      // Create a region object that includes the latest manually adjusted lines
      const regionWithCurrentLines: TableRegion = {
        ...cropRect,
        verticalLines: vLines,
        horizontalLines: hLines
      };

      // Determine options: If Preview is OFF, use a raw set of options to bypass processing.
      // If Preview is ON, use the current cleanup settings.
      const currentOpts = showProcessedPreview ? preprocessing : {
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
      } as PreprocessingOptions;

      const uri = await getPreprocessedPreview(imageSrc, regionWithCurrentLines, currentOpts, language, withGrid);
      
      const response = await fetch(uri);
      const blob = await response.blob();
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      toast({
        title: withGrid ? "Copied with Grid" : "Copied",
        description: "Image copied to clipboard.",
      });
    } catch (err) {
      console.error("Copy error:", err);
      toast({
        variant: "destructive",
        title: "Copy Failed",
        description: "Could not copy image to clipboard. Ensure site permissions are granted.",
      });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const addLine = (type: 'vertical' | 'horizontal', position: number) => {
    const newLine: TableLine = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      position
    };
    if (type === 'vertical') {
      onLinesChange([...vLines, newLine], hLines);
    } else {
      onLinesChange(vLines, [...hLines, newLine]);
    }
  };

  const removeLine = (id: string, type: 'v' | 'h') => {
    if (type === 'v') {
      onLinesChange(vLines.filter(l => l.id !== id), hLines);
    } else {
      onLinesChange(vLines, hLines.filter(l => l.id !== id));
    }
  };

  const clearLines = (type: 'v' | 'h') => {
    if (type === 'v') {
      onLinesChange([], hLines);
    } else {
      onLinesChange(vLines, []);
    }
  };

  const handleAutoGrid = async () => {
    if (!imageSrc) return;
    setIsDetecting(true);
    try {
      const { vLines: newV, hLines: newH } = await detectLinesInSingleRegion(imageSrc, cropRect, language);
      onLinesChange(newV, newH);
      toast({ title: "Grid Detected", description: `Found ${newV.length} columns and ${newH.length} rows.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Detection Failed" });
    } finally {
      setIsDetecting(false);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!addMode || !containerRef.current) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (addMode === 'v') {
      const pos = ((e.clientX - rect.left) / rect.width) * 100;
      addLine('vertical', Math.max(0, Math.min(100, pos)));
    } else {
      const pos = ((e.clientY - rect.top) / rect.height) * 100;
      addLine('horizontal', Math.max(0, Math.min(100, pos)));
    }
    setAddMode(null);
  };

  const handleMouseDown = (lineId: string, type: 'v' | 'h', e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    setActiveLine({ id: lineId, type });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeLine || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (activeLine.type === 'v') {
      const pos = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      onLinesChange(vLines.map(l => l.id === activeLine.id ? { ...l, position: pos } : l), hLines);
    } else {
      const pos = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      onLinesChange(vLines, hLines.map(l => l.id === activeLine.id ? { ...l, position: pos } : l));
    }
  };

  const handleMouseUp = () => setActiveLine(null);

  if (!imageSrc || !imgNaturalSize) return null;
  const cropAspect = (cropRect.width * imgNaturalSize.w) / (cropRect.height * imgNaturalSize.h);
  
  const getEngineIcon = () => {
    switch (engineType) {
      case 'tesseract': return Cpu;
      case 'scribe': return PenTool;
      case 'ai': return Bot;
      default: return Cpu;
    }
  };
  const EngineIcon = getEngineIcon();

  return (
    <div className="space-y-4 border rounded-xl p-4 bg-muted/10 shadow-sm">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-sm text-primary uppercase tracking-tight">{title}</h3>
          <Badge variant="secondary" className="h-6 flex items-center gap-1.5 px-2 bg-primary/10 text-primary border-primary/20">
            <EngineIcon size={10} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{engineType.toUpperCase()} Engine</span>
          </Badge>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1.5 bg-background shadow-sm" onClick={handleAutoGrid} disabled={isDetecting}>
            {isDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3 text-secondary" />}
            Auto-Grid
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-card p-1.5 rounded-lg border shadow-sm flex-1 min-w-[300px]">
          <div className="flex items-center gap-2 border-r pr-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
              <Layers size={12} className="text-primary" /> Strategy:
            </span>
            <Select value={strategy} onValueChange={(v: ExtractionStrategy) => onStrategyChange?.(v)}>
              <SelectTrigger className="h-7 text-[10px] w-32 border-none bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single-pass" className="text-[10px]">Single Pass</SelectItem>
                <SelectItem value="cell-by-cell" className="text-[10px]">Cell-by-Cell</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
              <Sparkles size={12} className="text-secondary" /> Cleanup:
            </span>
            <div className="flex gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch checked={preprocessing.binarize} onCheckedChange={(v) => onPreprocessingChange?.({...preprocessing, binarize: v})} className="scale-75" />
                <Label className="text-[10px] font-medium">Binarize</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={preprocessing.deskew} onCheckedChange={(v) => onPreprocessingChange?.({...preprocessing, deskew: v})} className="scale-75" />
                <Label className="text-[10px] font-medium">Deskew</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={preprocessing.denoise} onCheckedChange={(v) => onPreprocessingChange?.({...preprocessing, denoise: v})} className="scale-75" />
                <Label className="text-[10px] font-medium">Denoise</Label>
              </div>
            </div>
          </div>

          <div className="ml-auto flex gap-2 flex-wrap">
            <Button 
              size="sm" 
              variant={preprocessing.showTextBoxes ? "secondary" : "outline"} 
              className="h-7 text-[10px] gap-1.5" 
              onClick={() => onPreprocessingChange?.({...preprocessing, showTextBoxes: !preprocessing.showTextBoxes})}
            >
              <BoxSelect size={12} /> Blocks
            </Button>
            <Button size="sm" variant={showProcessedPreview ? "secondary" : "outline"} className="h-7 text-[10px] gap-1.5" onClick={() => setShowProcessedPreview(!showProcessedPreview)}>
              {showProcessedPreview ? <EyeOff size={12} /> : <Eye size={12} />} Preview
            </Button>
            <div className="flex gap-1 bg-card p-1 rounded-md border shadow-sm">
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2" onClick={() => copyToClipboard(false)} disabled={isPreviewLoading}>
                <Copy size={12} /> Image
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2" onClick={() => copyToClipboard(true)} disabled={isPreviewLoading}>
                <Grid3X3 size={12} /> + Grid
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 bg-card p-1 rounded-md border shadow-sm">
          <Button size="sm" variant={addMode === 'v' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'v' ? null : 'v')} className="h-8">
            <Plus className="w-4 h-4 mr-1" /> V
          </Button>
          <Button size="sm" variant="ghost" onClick={() => clearLines('v')} className="h-8 text-destructive"><Trash2 className="w-4 h-4" /></Button>
          <div className="w-px bg-border mx-1" />
          <Button size="sm" variant={addMode === 'h' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'h' ? null : 'h')} className="h-8">
            <Plus className="w-4 h-4 mr-1" /> H
          </Button>
          <Button size="sm" variant="ghost" onClick={() => clearLines('h')} className="h-8 text-destructive"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      <div 
        ref={containerRef}
        className={cn("relative border rounded-lg overflow-hidden bg-white shadow-inner mx-auto cursor-crosshair", (isDetecting || isPreviewLoading) && "opacity-70")}
        onClick={handleContainerClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ width: '100%', maxWidth: '100%', aspectRatio: `${cropAspect}`, maxHeight: '70vh' }}
      >
        {!showProcessedPreview || !processedImageUri ? (
          <img src={imageSrc} className="absolute max-w-none pointer-events-none" style={{ width: `${10000 / cropRect.width}%`, height: `${10000 / cropRect.height}%`, left: `${- (cropRect.x / cropRect.width) * 100}%`, top: `${- (cropRect.y / cropRect.height) * 100}%` }} />
        ) : (
          <img src={processedImageUri} className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
        )}

        {vLines.map(line => (
          <div key={line.id} className={cn("absolute top-0 bottom-0 w-1.5 -ml-0.75 cursor-col-resize z-20 transition-colors", activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/60")} style={{ left: `${line.position}%` }} onMouseDown={(e) => handleMouseDown(line.id, 'v', e)}>
            <button className="absolute top-1 left-1/2 -translate-x-1/2 bg-destructive text-white rounded-full p-0.5 shadow-lg" onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'v'); }}><X className="w-3 h-3" /></button>
          </div>
        ))}

        {hLines.map(line => (
          <div key={line.id} className={cn("absolute left-0 right-0 h-1.5 -mt-0.75 cursor-row-resize z-20 transition-colors", activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/60")} style={{ top: `${line.position}%` }} onMouseDown={(e) => handleMouseDown(line.id, 'h', e)}>
            <button className="absolute left-1 top-1/2 -translate-y-1/2 bg-destructive text-white rounded-full p-0.5 shadow-lg" onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'h'); }}><X className="w-3 h-3" /></button>
          </div>
        ))}
        {(isDetecting || isPreviewLoading) && <div className="absolute inset-0 flex items-center justify-center bg-black/5 z-50"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}
      </div>
    </div>
  );
};
