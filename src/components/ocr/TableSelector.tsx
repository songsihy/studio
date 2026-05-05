
"use client";

import React, { useState, useRef } from 'react';
import { TableRegion } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { X, Plus, Loader2, ListTodo, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent drawing if clicking on a UI button or input
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;

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
        name: `table_${regions.length + 1}`,
        x: Math.min(startPos.x, currentPos.x),
        y: Math.min(startPos.y, currentPos.y),
        width,
        height,
      };
      onRegionsChange([...regions, newRegion]);
    }
  };

  const updateRegionName = (id: string, name: string) => {
    onRegionsChange(regions.map(r => r.id === id ? { ...r, name } : r));
  };

  const removeRegion = (id: string) => {
    onRegionsChange(regions.filter(r => r.id !== id));
  };

  const clearAll = () => {
    onRegionsChange([]);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-4">
      {/* Table Management Panel */}
      <Card className="w-full lg:w-72 border-none shadow-none bg-muted/30">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ListTodo size={16} className="text-primary" /> Identified Tables
            </h3>
            {regions.length > 0 && (
              <Button size="icon" variant="ghost" onClick={clearAll} className="h-6 w-6 text-destructive">
                <X size={14} />
              </Button>
            )}
          </div>
          
          <ScrollArea className="h-[400px] pr-2">
            <div className="space-y-3">
              {regions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-10">
                  No tables identified. Draw rectangles on the document.
                </p>
              ) : (
                regions.map((region, idx) => (
                  <div 
                    key={region.id}
                    onMouseEnter={() => setHoveredRegionId(region.id)}
                    onMouseLeave={() => setHoveredRegionId(null)}
                    className={cn(
                      "p-3 rounded-lg border bg-card transition-all",
                      hoveredRegionId === region.id ? "border-primary ring-1 ring-primary/20" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        Table #{idx + 1}
                      </span>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRegion(region.id)}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 bg-muted/50 rounded p-1.5 border border-transparent focus-within:border-primary/30 transition-colors">
                      <Type size={12} className="text-muted-foreground shrink-0" />
                      <input
                        value={region.name}
                        onChange={(e) => updateRegionName(region.id, e.target.value)}
                        className="bg-transparent border-none text-xs font-semibold focus:outline-none w-full"
                        placeholder="Table name..."
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Preview and Canvas */}
      <div className="flex-1 space-y-4">
        <div className="flex justify-between items-center bg-card p-2 px-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <Plus className="w-3 h-3 text-primary" />
            Click and drag on the image to define table boundaries
          </div>
        </div>

        <div 
          ref={containerRef}
          className="relative border rounded-xl overflow-hidden bg-white shadow-inner select-none cursor-crosshair flex items-center justify-center"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ minHeight: '500px' }}
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
                  onMouseEnter={() => setHoveredRegionId(region.id)}
                  onMouseLeave={() => setHoveredRegionId(null)}
                  className={cn(
                    "absolute border-2 transition-all duration-200",
                    hoveredRegionId === region.id 
                      ? "border-primary bg-primary/20 z-40" 
                      : "border-primary/60 bg-primary/5 z-30"
                  )}
                  style={{
                    left: `${region.x}%`,
                    top: `${region.y}%`,
                    width: `${region.width}%`,
                    height: `${region.height}%`,
                  }}
                >
                  <div className={cn(
                    "absolute -top-6 left-0 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-t-sm whitespace-nowrap shadow-sm transition-opacity",
                    hoveredRegionId === region.id ? "opacity-100" : "opacity-0"
                  )}>
                    {region.name}
                  </div>
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                    <Button 
                      size="icon" 
                      variant="destructive" 
                      className="h-6 w-6 rounded-full shadow-lg" 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        removeRegion(region.id); 
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Current Drawing Selection */}
              {isDrawing && (
                <div
                  className="absolute border-2 border-dashed border-secondary bg-secondary/10 z-50"
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
              <p className="text-sm">Loading document preview...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
