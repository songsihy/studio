"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableLine } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LineEditorProps {
  imageSrc: string | null;
  vLines: TableLine[];
  hLines: TableLine[];
  onLinesChange: (vLines: TableLine[], hLines: TableLine[]) => void;
}

export const LineEditor: React.FC<LineEditorProps> = ({ imageSrc, vLines, hLines, onLinesChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<{ id: string; type: 'v' | 'h' } | null>(null);

  const addLine = (type: 'vertical' | 'horizontal') => {
    const newLine: TableLine = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      position: 50
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

  const handleMouseDown = (lineId: string, type: 'v' | 'h') => {
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
      <div className="flex justify-between items-center bg-card p-3 rounded-lg border shadow-sm">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addLine('vertical')}>
            <Plus className="w-4 h-4 mr-1" /> Vertical Line
          </Button>
          <Button size="sm" variant="outline" onClick={() => addLine('horizontal')}>
            <Plus className="w-4 h-4 mr-1" /> Horizontal Line
          </Button>
        </div>
        <div className="text-xs text-muted-foreground italic">
          Drag lines to adjust cell boundaries
        </div>
      </div>

      <div 
        ref={containerRef}
        className="relative border rounded-xl overflow-hidden bg-white select-none flex items-center justify-center"
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
                  "absolute top-0 bottom-0 w-1.5 -ml-0.75 cursor-col-resize group z-20",
                  activeLine?.id === line.id ? "bg-primary" : "bg-primary/20 hover:bg-primary/50"
                )}
                style={{ left: `${line.position}%` }}
                onMouseDown={() => handleMouseDown(line.id, 'v')}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="destructive" className="h-6 w-6 rounded-full" onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'v'); }}>
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
                  "absolute left-0 right-0 h-1.5 -mt-0.75 cursor-row-resize group z-20",
                  activeLine?.id === line.id ? "bg-primary" : "bg-primary/20 hover:bg-primary/50"
                )}
                style={{ top: `${line.position}%` }}
                onMouseDown={() => handleMouseDown(line.id, 'h')}
              >
                <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="destructive" className="h-6 w-6 rounded-full" onClick={(e) => { e.stopPropagation(); removeLine(line.id, 'h'); }}>
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
