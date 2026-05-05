"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableLine } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { Plus, X, Loader2, Trash2, MousePointer2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LineEditorProps {
  imageSrc: string | null;
  vLines: TableLine[];
  hLines: TableLine[];
  onLinesChange: (vLines: TableLine[], hLines: TableLine[]) => void;
}

export const LineEditor: React.FC<LineEditorProps> = ({ imageSrc, vLines, hLines, onLinesChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<{ id: string; type: 'v' | 'h' } | null>(null);
  const [addMode, setAddMode] = useState<'v' | 'h' | null>(null);
  const [cvReady, setCvReady] = useState(false);

  useEffect(() => {
    const checkCV = () => {
      if (typeof window !== 'undefined' && (window as any).cv) {
        setCvReady(true);
      } else {
        setTimeout(checkCV, 500);
      }
    };
    checkCV();
  }, []);

  const addLine = (type: 'vertical' | 'horizontal', position: number = 50) => {
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

  return (
    <div className="flex flex-col gap-4">
      {!cvReady && (
        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs text-primary font-medium flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            OpenCV.js is initializing for advanced line detection...
          </AlertDescription>
        </Alert>
      )}

      <TooltipProvider>
        <div className="flex flex-wrap justify-between items-center bg-card p-3 rounded-lg border shadow-sm gap-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center bg-muted/50 p-1 rounded-md border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant={addMode === 'v' ? "secondary" : "ghost"} 
                    onClick={() => setAddMode(addMode === 'v' ? null : 'v')}
                    className="h-8"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Vertical
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Click on image to add vertical line</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" onClick={() => clearLines('v')} className="h-8 text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear all vertical lines</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center bg-muted/50 p-1 rounded-md border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant={addMode === 'h' ? "secondary" : "ghost"} 
                    onClick={() => setAddMode(addMode === 'h' ? null : 'h')}
                    className="h-8"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Horizontal
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Click on image to add horizontal line</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" onClick={() => clearLines('h')} className="h-8 text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear all horizontal lines</TooltipContent>
              </Tooltip>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <MousePointer2 className="w-3 h-3" />
            {addMode ? `Click to add ${addMode === 'v' ? 'vertical' : 'horizontal'} line` : 'Drag lines to refine grid'}
          </div>
        </div>
      </TooltipProvider>

      <div 
        ref={containerRef}
        className={cn(
          "relative border rounded-xl overflow-hidden bg-white select-none flex items-center justify-center",
          addMode && "cursor-crosshair",
          !addMode && "cursor-default"
        )}
        onClick={handleContainerClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ minHeight: '400px' }}
      >
        {imageSrc ? (
          <>
            <img 
              src={imageSrc} 
              alt="Original Document" 
              className="w-full h-auto block pointer-events-none"
            />
            
            {/* Vertical Lines */}
            {vLines.map(line => (
              <div
                key={line.id}
                className={cn(
                  "absolute top-0 bottom-0 w-2 -ml-1 cursor-col-resize group z-20",
                  activeLine?.id === line.id ? "bg-primary" : "bg-primary/25 hover:bg-primary/60"
                )}
                style={{ left: `${line.position}%` }}
                onMouseDown={(e) => handleMouseDown(line.id, 'v', e)}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  <Button 
                    size="icon" 
                    variant="destructive" 
                    className="h-5 w-5 rounded-full shadow-md" 
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'v'); }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}

            {/* Horizontal Lines */}
            {hLines.map(line => (
              <div
                key={line.id}
                className={cn(
                  "absolute left-0 right-0 h-2 -mt-1 cursor-row-resize group z-20",
                  activeLine?.id === line.id ? "bg-primary" : "bg-primary/25 hover:bg-primary/60"
                )}
                style={{ top: `${line.position}%` }}
                onMouseDown={(e) => handleMouseDown(line.id, 'h', e)}
              >
                <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  <Button 
                    size="icon" 
                    variant="destructive" 
                    className="h-5 w-5 rounded-full shadow-md" 
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'h'); }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm font-medium">Preparing document view...</p>
          </div>
        )}
      </div>
    </div>
  );
};
