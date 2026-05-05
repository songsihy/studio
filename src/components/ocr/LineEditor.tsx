
"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableLine } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { Plus, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LineEditorProps {
  imageSrc: string | null;
  cropRect: { x: number; y: number; width: number; height: number }; // percentages
  vLines: TableLine[];
  hLines: TableLine[];
  onLinesChange: (vLines: TableLine[], hLines: TableLine[]) => void;
  title: string;
}

export const LineEditor: React.FC<LineEditorProps> = ({ 
  imageSrc, 
  cropRect, 
  vLines, 
  hLines, 
  onLinesChange,
  title
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<{ id: string; type: 'v' | 'h' } | null>(null);
  const [addMode, setAddMode] = useState<'v' | 'h' | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number, h: number } | null>(null);

  useEffect(() => {
    if (imageSrc) {
      const img = new Image();
      img.onload = () => {
        setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src = imageSrc;
    }
  }, [imageSrc]);

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

  if (!imageSrc || !imgNaturalSize) return null;

  // Calculate correct aspect ratio of the crop
  // aspectRatio = (width% * naturalWidth) / (height% * naturalHeight)
  const cropAspect = (cropRect.width * imgNaturalSize.w) / (cropRect.height * imgNaturalSize.h);

  return (
    <div className="space-y-4 border rounded-xl p-4 bg-muted/10 shadow-sm">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h3 className="font-bold text-sm text-primary uppercase tracking-tight">{title}</h3>
        <TooltipProvider>
          <div className="flex gap-2 bg-card p-1 rounded-md border shadow-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={addMode === 'v' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'v' ? null : 'v')} className="h-8">
                  <Plus className="w-4 h-4 mr-1" /> Vertical
                </Button>
              </TooltipTrigger>
              <TooltipContent>Click to add vertical guide</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => clearLines('v')} className="h-8 text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear verticals</TooltipContent>
            </Tooltip>
            <div className="w-px bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={addMode === 'h' ? "secondary" : "ghost"} onClick={() => setAddMode(addMode === 'h' ? null : 'h')} className="h-8">
                  <Plus className="w-4 h-4 mr-1" /> Horizontal
                </Button>
              </TooltipTrigger>
              <TooltipContent>Click to add horizontal guide</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => clearLines('h')} className="h-8 text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear horizontals</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <div 
        ref={containerRef}
        className={cn(
          "relative border rounded-lg overflow-hidden bg-white select-none cursor-crosshair group shadow-inner mx-auto",
          addMode && "ring-2 ring-primary/20"
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

        {/* Vertical Lines */}
        {vLines.map(line => (
          <div
            key={line.id}
            className={cn(
              "absolute top-0 bottom-0 w-1.5 -ml-0.75 cursor-col-resize group z-20",
              activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/70"
            )}
            style={{ left: `${line.position}%` }}
            onMouseDown={(e) => handleMouseDown(line.id, 'v', e)}
          >
            <button 
              className="absolute top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-destructive text-white rounded-full p-0.5 hover:scale-110 transition-all shadow-lg"
              onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'v'); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Horizontal Lines */}
        {hLines.map(line => (
          <div
            key={line.id}
            className={cn(
              "absolute left-0 right-0 h-1.5 -mt-0.75 cursor-row-resize group z-20",
              activeLine?.id === line.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/70"
            )}
            style={{ top: `${line.position}%` }}
            onMouseDown={(e) => handleMouseDown(line.id, 'h', e)}
          >
            <button 
              className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-destructive text-white rounded-full p-0.5 hover:scale-110 transition-all shadow-lg"
              onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'h'); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {addMode && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-primary/5">
            <span className="bg-primary text-white text-[10px] px-2 py-1 rounded-full shadow-lg font-bold">
              {addMode === 'v' ? 'Adding Vertical Line' : 'Adding Horizontal Line'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
