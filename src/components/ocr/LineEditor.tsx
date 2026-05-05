
"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableLine, TableRegion, PreprocessingOptions } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { Plus, X, Trash2, Wand2, Loader2, Sparkles, Eye, EyeOff, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { detectLinesInSingleRegion, getPreprocessedPreview } from '@/lib/ocr/processor';
import { useToast } from '@/hooks/use-toast';

interface LineEditorProps {
  imageSrc: string | null;
  cropRect: TableRegion;
  vLines: TableLine[];
  hLines: TableLine[];
  onLinesChange: (vLines: TableLine[], hLines: TableLine[]) => void;
  onPreprocessingChange?: (options: PreprocessingOptions) => void;
  title: string;
}

export const LineEditor: React.FC<LineEditorProps> = ({ 
  imageSrc, 
  cropRect, 
  vLines, 
  hLines, 
  onLinesChange,
  onPreprocessingChange,
  title
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

  const preprocessing = cropRect.preprocessing || { 
    binarize: true, 
    deskew: true, 
    denoise: true,
    thresholdBlockSize: 31,
    thresholdC: 2
  };

  useEffect(() => {
    if (imageSrc) {
      const img = new Image();
      const handleLoad = () => {
        setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onload = handleLoad;
      img.src = imageSrc;
      if (img.complete) handleLoad();
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
      const uri = await getPreprocessedPreview(imageSrc, cropRect, preprocessing);
      setProcessedImageUri(uri);
    } catch (e) {
      console.error(e);
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
      const { vLines: newV, hLines: newH } = await detectLinesInSingleRegion(imageSrc, cropRect);
      onLinesChange(newV, newH);
      toast({
        title: "Grid Detected",
        description: `Automatically found ${newV.length} columns and ${newH.length} rows.`,
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Detection Failed",
        description: "Could not automatically identify grid lines for this table."
      });
    } finally {
      setIsDetecting(false);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!addMode || !containerRef.current) return;
    if ((e.target as HTMLElement).closest('button')) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (addMode === 'v') {
      const position = ((e.clientX - rect.left) / rect.width) * 100;
      addLine('vertical', Math.max(0, Math.min(100, position)));
    } else {
      const position = ((e.clientY - rect.top) / rect.height) * 100;
      addLine('horizontal', Math.max(0, Math.min(100, position)));
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
    let position = 0;

    if (activeLine.type === 'v') {
      position = ((e.clientX - rect.left) / rect.width) * 100;
      position = Math.max(0, Math.min(100, position));
      const updatedLines = vLines.map(l => l.id === activeLine.id ? { ...l, position } : l);
      onLinesChange(updatedLines, hLines);
    } else {
      position = ((e.clientY - rect.top) / rect.height) * 100;
      position = Math.max(0, Math.min(100, position));
      const updatedLines = hLines.map(l => l.id === activeLine.id ? { ...l, position } : l);
      onLinesChange(vLines, updatedLines);
    }
  };

  const handleMouseUp = () => {
    setActiveLine(null);
  };

  const togglePreprocessing = (key: keyof PreprocessingOptions) => {
    if (!onPreprocessingChange) return;
    const newOpts = { ...preprocessing, [key]: !preprocessing[key] };
    onPreprocessingChange(newOpts);
  };

  const updateThresholdOption = (key: 'thresholdBlockSize' | 'thresholdC', val: number) => {
    if (!onPreprocessingChange) return;
    const newOpts = { ...preprocessing, [key]: val };
    onPreprocessingChange(newOpts);
  };

  if (!imageSrc || !imgNaturalSize) return null;

  const cropAspect = (cropRect.width * imgNaturalSize.w) / (cropRect.height * imgNaturalSize.h);

  return (
    <div className="space-y-4 border rounded-xl p-4 bg-muted/10 shadow-sm">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-sm text-primary uppercase tracking-tight">{title}</h3>
          <Button 
            size="sm" 
            variant="outline" 
            className="h-7 text-[10px] gap-1.5 bg-background shadow-sm hover:bg-secondary/10"
            onClick={handleAutoGrid}
            disabled={isDetecting}
          >
            {isDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3 text-secondary" />}
            Auto-Grid
          </Button>
        </div>

        <div className="flex items-center gap-4 bg-card p-1.5 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 px-2 border-r pr-4">
            <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
              <Sparkles size={12} className="text-secondary" /> OCR Cleanup:
            </span>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Switch 
                  id={`binarize-${cropRect.id}`} 
                  checked={preprocessing.binarize} 
                  onCheckedChange={() => togglePreprocessing('binarize')}
                  className="scale-75"
                />
                <Label htmlFor={`binarize-${cropRect.id}`} className="text-[10px] font-medium cursor-pointer">Binarize</Label>
              </div>

              {preprocessing.binarize && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-6 w-6">
                      <Settings2 size={12} className="text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-4 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-[10px] font-bold">Block Size</Label>
                        <span className="text-[10px] text-muted-foreground">{preprocessing.thresholdBlockSize}px</span>
                      </div>
                      <Slider 
                        min={3} 
                        max={99} 
                        step={2} 
                        value={[preprocessing.thresholdBlockSize]} 
                        onValueChange={(v) => updateThresholdOption('thresholdBlockSize', v[0])}
                      />
                      <p className="text-[9px] text-muted-foreground">Local neighborhood area for threshold calculation.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-[10px] font-bold">Constant (C)</Label>
                        <span className="text-[10px] text-muted-foreground">{preprocessing.thresholdC}</span>
                      </div>
                      <Slider 
                        min={0} 
                        max={20} 
                        step={1} 
                        value={[preprocessing.thresholdC]} 
                        onValueChange={(v) => updateThresholdOption('thresholdC', v[0])}
                      />
                      <p className="text-[9px] text-muted-foreground">Value subtracted from the weighted mean.</p>
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              <div className="flex items-center gap-2">
                <Switch 
                  id={`deskew-${cropRect.id}`} 
                  checked={preprocessing.deskew} 
                  onCheckedChange={() => togglePreprocessing('deskew')}
                  className="scale-75"
                />
                <Label htmlFor={`deskew-${cropRect.id}`} className="text-[10px] font-medium cursor-pointer">Deskew</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch 
                  id={`denoise-${cropRect.id}`} 
                  checked={preprocessing.denoise} 
                  onCheckedChange={() => togglePreprocessing('denoise')}
                  className="scale-75"
                />
                <Label htmlFor={`denoise-${cropRect.id}`} className="text-[10px] font-medium cursor-pointer">Denoise</Label>
              </div>
            </div>
          </div>

          <Button 
            size="sm" 
            variant={showProcessedPreview ? "secondary" : "outline"} 
            className="h-7 text-[10px] gap-1.5"
            onClick={() => setShowProcessedPreview(!showProcessedPreview)}
          >
            {showProcessedPreview ? <EyeOff size={12} /> : <Eye size={12} />}
            Preview Cleanup
          </Button>
        </div>

        <TooltipProvider>
          <div className="flex gap-2 bg-card p-1 rounded-md border shadow-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={addMode === 'v' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'v' ? null : 'v')} className="h-8">
                  <Plus className="w-4 h-4 mr-1" /> Vertical
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add vertical grid guide</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => clearLines('v')} className="h-8 text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear all verticals</TooltipContent>
            </Tooltip>
            <div className="w-px bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={addMode === 'h' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'h' ? null : 'h')} className="h-8">
                  <Plus className="w-4 h-4 mr-1" /> Horizontal
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add horizontal grid guide</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => clearLines('h')} className="h-8 text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear all horizontals</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <div 
        ref={containerRef}
        className={cn(
          "relative border rounded-lg overflow-hidden bg-white select-none cursor-crosshair group shadow-inner mx-auto",
          addMode && "ring-2 ring-primary/20",
          (isDetecting || isPreviewLoading) && "opacity-70 grayscale-[50%]"
        )}
        onClick={handleContainerClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ 
          width: '100%',
          maxWidth: '100%',
          aspectRatio: `${cropAspect}`,
          maxHeight: '70vh',
        }}
      >
        {!showProcessedPreview || !processedImageUri ? (
          <img 
            src={imageSrc} 
            alt="Table crop"
            className="absolute max-w-none pointer-events-none"
            style={{
              width: `${10000 / cropRect.width}%`,
              height: `${10000 / cropRect.height}%`,
              left: `${- (cropRect.x / cropRect.width) * 100}%`,
              top: `${- (cropRect.y / cropRect.height) * 100}%`,
            }}
          />
        ) : (
          <img 
            src={processedImageUri} 
            alt="Processed preview"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />
        )}

        {vLines.map(line => (
          <div
            key={line.id}
            className={cn(
              "absolute top-0 bottom-0 w-1.5 -ml-0.75 cursor-col-resize group z-20 transition-colors",
              activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/60"
            )}
            style={{ left: `${line.position}%` }}
            onMouseDown={(e) => handleMouseDown(line.id, 'v', e)}
          >
            <button 
              className="absolute top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-destructive text-white rounded-full p-0.5 shadow-lg transition-opacity"
              onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'v'); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {hLines.map(line => (
          <div
            key={line.id}
            className={cn(
              "absolute left-0 right-0 h-1.5 -mt-0.75 cursor-row-resize group z-20 transition-colors",
              activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/60"
            )}
            style={{ top: `${line.position}%` }}
            onMouseDown={(e) => handleMouseDown(line.id, 'h', e)}
          >
            <button 
              className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-destructive text-white rounded-full p-0.5 shadow-lg transition-opacity"
              onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'h'); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {addMode && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-primary/5">
            <span className="bg-primary text-white text-[10px] px-3 py-1 rounded-full shadow-lg font-bold">
              Click to place {addMode === 'v' ? 'column' : 'row'} guide
            </span>
          </div>
        )}

        {(isDetecting || isPreviewLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/5 z-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
};
