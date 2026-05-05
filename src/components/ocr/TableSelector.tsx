
"use client";

import React, { useState, useRef } from 'react';
import { TableRegion, DocumentPage } from '@/lib/ocr-types';
import { cn } from '@/lib/utils';
import { X, Plus, Loader2, ListTodo, Type, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface TableSelectorProps {
  imageSrc: string | null;
  regions: TableRegion[];
  onRegionsChange: (regions: TableRegion[]) => void;
  allPages: DocumentPage[];
  currentPageIndex: number;
  onNavigateToPage: (index: number) => void;
}

export const TableSelector: React.FC<TableSelectorProps> = ({ 
  imageSrc, 
  regions, 
  onRegionsChange,
  allPages,
  currentPageIndex,
  onNavigateToPage
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
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
        verticalLines: [],
        horizontalLines: []
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

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-4">
      {/* Table Management Panel - Global List */}
      <Card className="w-full lg:w-80 border-none shadow-none bg-muted/30">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ListTodo size={16} className="text-primary" /> All Identified Tables
            </h3>
          </div>
          
          <ScrollArea className="h-[500px] pr-2">
            <div className="space-y-6">
              {allPages.map((page, pIdx) => {
                const pageRegions = pIdx === currentPageIndex ? regions : (page.tableRegions || []);
                if (pageRegions.length === 0) return null;

                return (
                  <div key={page.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <FileText size={12} className="text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Page {pIdx + 1}
                      </span>
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px] ml-auto">
                        {pageRegions.length}
                      </Badge>
                    </div>

                    <div className="space-y-2 pl-2 border-l-2 border-muted">
                      {pageRegions.map((region, rIdx) => (
                        <div 
                          key={region.id}
                          onMouseEnter={() => pIdx === currentPageIndex && setHoveredRegionId(region.id)}
                          onMouseLeave={() => setHoveredRegionId(null)}
                          onClick={() => pIdx !== currentPageIndex && onNavigateToPage(pIdx)}
                          className={cn(
                            "p-2 rounded-md border bg-card transition-all cursor-pointer group",
                            pIdx === currentPageIndex && hoveredRegionId === region.id 
                              ? "border-primary ring-1 ring-primary/20" 
                              : "border-border hover:border-primary/50",
                            pIdx !== currentPageIndex && "opacity-80"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] font-bold text-muted-foreground">
                              {region.name}
                            </span>
                            {pIdx === currentPageIndex && (
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-4 w-4 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeRegion(region.id);
                                }}
                              >
                                <X size={10} />
                              </Button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 bg-muted/50 rounded p-1 border border-transparent focus-within:border-primary/30">
                            <Type size={10} className="text-muted-foreground" />
                            <input
                              value={region.name}
                              disabled={pIdx !== currentPageIndex}
                              onChange={(e) => updateRegionName(region.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="bg-transparent border-none text-[11px] font-semibold focus:outline-none w-full disabled:cursor-not-allowed"
                              placeholder="Name..."
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {allPages.every(p => (p.tableRegions?.length || 0) === 0) && regions.length === 0 && (
                <div className="p-10 text-center space-y-2">
                  <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                    <Plus size={20} />
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    No tables identified yet.
                  </p>
                </div>
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
            Page {currentPageIndex + 1}: Draw rectangles to define table boundaries
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
              
              {/* Existing Regions for current page */}
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
