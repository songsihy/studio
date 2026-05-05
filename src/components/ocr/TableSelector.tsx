
"use client";

import React, { useState, useRef, useEffect } from 'react';
import { TableRegion } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { X, MousePointer2, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TableSelectorProps {
  imageSrc: string | null;
  regions: TableRegion[];
  onRegionsChange: (regions: TableRegion[]) => void;
}

export const TableSelector: React.FC<TableSelectorProps> = ({ imageSrc, regions, onRegionsChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setStartPos({ x, y });
    setCurrentPos({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setCurrentPos({ x, y });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const width = Math.abs(currentPos.x - startPos.x);
    const height = Math.abs(currentPos.y - startPos.y);

    if (width > 2 && height > 2) {
      const newRegion: TableRegion = {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.min(startPos.x, currentPos.x),
        y: Math.min(startPos.y, currentPos.y),
        width,
        height,
      };
      onRegionsChange([...regions, newRegion]);
    }
  };

  const removeRegion = (id: string) => {
    onRegionsChange(regions.filter(r => r.id !== id));
  };

  const clearAll = () => {
    onRegionsChange([]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center bg-card p-3 rounded-lg border shadow-sm">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={clearAll} className="h-8 text-destructive">
            <X className="w-4 h-4 mr-1" /> Clear All
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          <Plus className="w-3 h-3" />
          Click and drag to define table regions
        </div>
      </div>

      <div 
        ref={containerRef}
        className="relative border rounded-xl overflow-hidden bg-white select-none cursor-crosshair flex items-center justify-center"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ minHeight: '400px' }}
      >
        {imageSrc ? (
          <>
            <img 
              src={imageSrc} 
              alt="Document" 
              className="w-full h-auto block pointer-events-none"
            />
            
            {/* Existing Regions */}
            {regions.map(region => (
              <div
                key={region.id}
                className="absolute border-2 border-primary bg-primary/10 group"
                style={{
                  left: `${region.x}%`,
                  top: `${region.y}%`,
                  width: `${region.width}%`,
                  height: `${region.height}%`,
                }}
              >
                <div className="absolute -top-3 -right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button 
                    size="icon" 
                    variant="destructive" 
                    className="h-6 w-6 rounded-full shadow-lg" 
                    onClick={(e) => { e.stopPropagation(); removeRegion(region.id); }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            {/* Current Drawing Selection */}
            {isDrawing && (
              <div
                className="absolute border-2 border-dashed border-secondary bg-secondary/5"
                style={{
                  left: `${Math.min(startPos.x, currentPos.x)}%`,
                  top: `${Math.min(startPos.y, currentPos.y)}%`,
                  width: `${Math.abs(currentPos.x - startPos.x)}%`,
                  height: `${Math.abs(currentPos.y - startPos.y)}%`,
                }}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading document...</p>
          </div>
        )}
      </div>
    </div>
  );
};
