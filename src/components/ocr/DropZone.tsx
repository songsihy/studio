
"use client";

import React, { useState, useCallback } from 'react';
import { Upload, FileType, Image as ImageIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  isLoading?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFilesSelected, isLoading }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onFilesSelected(Array.from(e.target.files));
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative border-2 border-dashed rounded-xl p-12 transition-all duration-200 flex flex-col items-center justify-center gap-4 text-center",
        isDragging ? "border-secondary bg-secondary/5" : "border-muted-foreground/20 bg-card",
        isLoading && "opacity-50 pointer-events-none"
      )}
    >
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        <Upload size={32} />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">Upload Documents</h3>
        <p className="text-muted-foreground max-w-xs mx-auto">
          Drag and drop your PDF or images here, or click to browse files
        </p>
      </div>
      <div className="flex gap-4 mt-2">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium">
          <FileType size={14} className="text-primary" />
          <span>PDF Support</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium">
          <ImageIcon size={14} className="text-secondary" />
          <span>Images</span>
        </div>
      </div>
      <input
        type="file"
        multiple
        accept=".pdf,image/*"
        onChange={handleFileInput}
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={isLoading}
      />
      <Button variant="outline" className="mt-4" disabled={isLoading}>
        Select Files
      </Button>
    </div>
  );
};
