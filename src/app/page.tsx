
"use client";

import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Table as TableIcon, 
  Download, 
  Settings, 
  Languages, 
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ScanSearch,
  Sparkles,
  Files,
  Grid3X3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropZone } from '@/components/ocr/DropZone';
import { LineEditor } from '@/components/ocr/LineEditor';
import { TableSelector } from '@/components/ocr/TableSelector';
import { 
  ProcessingStatus, 
  DocumentPage, 
  ExtractedTable,
  TableRegion,
  TableLine
} from '@/lib/ocr-types';
import { useToast } from '@/hooks/use-toast';
import { 
  exportToCSV, 
  exportToJSON, 
  exportToMarkdown, 
  exportToHTML, 
  downloadFile 
} from '@/lib/ocr/exporter';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Progress } from '@/components/ui/progress';
import { detectTableRegions, processTablesOnPage, detectLinesInRegions } from '@/lib/ocr/processor';
import { pdfToImages } from '@/lib/ocr/pdf-loader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [language, setLanguage] = useState('eng');
  const [tableRegions, setTableRegions] = useState<TableRegion[]>([]);
  const [progress, setProgress] = useState(0);
  const [allExtractedData, setAllExtractedData] = useState<ExtractedTable[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const { toast } = useToast();

  const currentPage = pages[currentPageIndex];

  // Keep local tableRegions synced with the pages array
  useEffect(() => {
    if (pages.length > 0 && currentPage) {
      setPages(prev => prev.map((p, idx) => 
        idx === currentPageIndex ? { ...p, tableRegions } : p
      ));
    }
  }, [tableRegions]);

  const handleFiles = async (files: File[]) => {
    setStatus('uploading');
    try {
      const allPageImages: string[] = [];
      for (const file of files) {
        if (file.type === 'application/pdf') {
          const images = await pdfToImages(file);
          allPageImages.push(...images);
        } else {
          const reader = new FileReader();
          const imgData = await new Promise<string>((resolve) => {
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(file);
          });
          allPageImages.push(imgData);
        }
      }

      const newPages: DocumentPage[] = allPageImages.map((img, idx) => ({
        id: `page-${idx}-${Date.now()}`,
        originalImage: img,
        tableRegions: []
      }));

      setPages(newPages);
      setCurrentPageIndex(0);
      setTableRegions([]);
      setStatus('selecting-tables');
      
      autoDetectRegions(allPageImages[0]);

      toast({
        title: "Documents Loaded",
        description: `Successfully loaded ${newPages.length} page(s).`,
      });
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  const handlePageSelect = (index: number) => {
    if (index === currentPageIndex) return;
    const targetPage = pages[index];
    if (targetPage) {
      setCurrentPageIndex(index);
      setTableRegions(targetPage.tableRegions || []);
      if (status === 'selecting-tables' && targetPage.tableRegions.length === 0) {
        autoDetectRegions(targetPage.originalImage);
      }
    }
  };

  const autoDetectRegions = async (imageSrc: string) => {
    if (!imageSrc) return;
    setIsDetecting(true);
    try {
      const detected = await detectTableRegions(imageSrc);
      setTableRegions(detected);
    } catch (err) {
      console.warn("Detection failed:", err);
    } finally {
      setIsDetecting(false);
    }
  };

  const proceedToRefine = async () => {
    if (!currentPage) return;
    setStatus('detecting');
    try {
      const updatedRegions = await detectLinesInRegions(currentPage.originalImage, tableRegions);
      setTableRegions(updatedRegions);
      setStatus('refining');
    } catch (err) {
      console.warn("Grid detection limited:", err);
      setStatus('refining');
    }
  };

  const runOCR = async () => {
    if (!currentPage) return;
    setStatus('ocr-processing');
    setProgress(0);
    try {
      const results = await processTablesOnPage(
        currentPage.originalImage, 
        tableRegions, 
        language,
        (p) => setProgress(Math.floor(p * 100))
      );
      setAllExtractedData(results);
      setStatus('completed');
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  };

  const goBack = () => {
    if (status === 'selecting-tables') {
      reset();
    } else if (status === 'refining') {
      setStatus('selecting-tables');
    } else if (status === 'completed') {
      setStatus('refining');
    }
  };

  const updateRegionLines = (id: string, vLines: TableLine[], hLines: TableLine[]) => {
    setTableRegions(prev => prev.map(r => 
      r.id === id ? { ...r, verticalLines: vLines, horizontalLines: hLines } : r
    ));
  };

  const handleExport = (table: ExtractedTable, format: 'csv' | 'json' | 'md' | 'html') => {
    let content = '';
    let fileName = `${table.tableName || 'table'}.${format}`;
    let type = 'text/plain';

    switch(format) {
      case 'csv': content = exportToCSV(table); type = 'text/csv'; break;
      case 'json': content = exportToJSON(table); type = 'application/json'; break;
      case 'md': content = exportToMarkdown(table); break;
      case 'html': content = exportToHTML(table); type = 'text/html'; break;
    }
    downloadFile(content, fileName, type);
  };

  const reset = () => {
    setPages([]);
    setAllExtractedData([]);
    setStatus('idle');
    setTableRegions([]);
    setCurrentPageIndex(0);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg">
            <TableIcon size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">TableScan Pro</h1>
            <p className="text-sm text-muted-foreground font-medium">Professional Document OCR</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-card border px-3 py-2 rounded-lg shadow-sm">
            <Languages size={18} className="text-muted-foreground" />
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-40 border-0 shadow-none focus:ring-0">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eng">English</SelectItem>
                <SelectItem value="chi_tra">Chinese (Trad)</SelectItem>
                <SelectItem value="chi_sim">Chinese (Simp)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status !== 'idle' && (
            <Button variant="ghost" onClick={reset} className="text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> Reset
            </Button>
          )}
        </div>
      </header>

      <main className={cn("grid gap-8", status === 'idle' ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12")}>
        {status !== 'idle' && pages.length > 0 && (
          <aside className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 px-1 text-sm font-semibold text-muted-foreground">
              <Files size={16} /> Pages ({pages.length})
            </div>
            <ScrollArea className="h-[calc(100vh-250px)] pr-4">
              <div className="flex flex-col gap-3">
                {pages.map((page, idx) => (
                  <button
                    key={page.id}
                    onClick={() => handlePageSelect(idx)}
                    className={cn(
                      "relative aspect-[3/4] rounded-lg border-2 overflow-hidden transition-all",
                      currentPageIndex === idx ? "border-primary shadow-md ring-2 ring-primary/20" : "border-transparent opacity-60 hover:opacity-100"
                    )}
                  >
                    <img src={page.originalImage} className="w-full h-full object-cover" alt="" />
                    <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1 rounded">{idx + 1}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </aside>
        )}

        <div className={cn("space-y-6", status === 'idle' ? "w-full" : "lg:col-span-7")}>
          {status === 'idle' ? (
            <DropZone onFilesSelected={handleFiles} isLoading={status === 'uploading'} />
          ) : (
            <div className="space-y-6">
              {status === 'selecting-tables' && (
                <Card className="border-2 shadow-xl overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b py-4">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ScanSearch className="w-5 h-5 text-primary" /> Step 2: Define Table Areas
                    </CardTitle>
                  </CardHeader>
                  <TableSelector 
                    imageSrc={currentPage?.originalImage || null}
                    regions={tableRegions}
                    onRegionsChange={setTableRegions}
                  />
                </Card>
              )}

              {status === 'refining' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between bg-card border p-4 rounded-xl shadow-sm">
                    <div className="flex items-center gap-3">
                      <Grid3X3 className="text-primary w-6 h-6" />
                      <div>
                        <h2 className="font-bold text-lg">Step 3: Refine Table Grids</h2>
                        <p className="text-xs text-muted-foreground">Adjust lines for each detected table individually</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-8">
                    {tableRegions.map((region, idx) => (
                      <LineEditor 
                        key={region.id}
                        title={region.name || `Table #${idx + 1}`}
                        imageSrc={currentPage?.originalImage || null}
                        cropRect={region}
                        vLines={region.verticalLines || []}
                        hLines={region.horizontalLines || []}
                        onLinesChange={(v, h) => updateRegionLines(region.id, v, h)}
                      />
                    ))}
                    {tableRegions.length === 0 && (
                      <div className="p-12 text-center border-2 border-dashed rounded-xl bg-muted/5">
                        <p className="text-muted-foreground">No tables identified. Go back and draw regions.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {status === 'ocr-processing' && (
                <Card className="p-12 text-center space-y-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">Local OCR Processing</h3>
                    <p className="text-muted-foreground">Extracting text cell by cell using Tesseract.js</p>
                  </div>
                  <Progress value={progress} className="h-2 max-w-md mx-auto" />
                  <p className="text-sm font-bold text-primary">{progress}% Complete</p>
                </Card>
              )}

              {status === 'completed' && (
                <div className="space-y-8">
                  {allExtractedData.map((table) => (
                    <Card key={table.id} className="border-2 shadow-lg overflow-hidden">
                      <CardHeader className="bg-muted/30 border-b flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">{table.tableName}</CardTitle>
                        <div className="flex gap-2">
                          {['csv', 'json', 'md', 'html'].map(fmt => (
                            <Button key={fmt} size="sm" variant="outline" className="h-7 text-[10px] uppercase font-bold" onClick={() => handleExport(table, fmt as any)}>
                              {fmt}
                            </Button>
                          ))}
                        </div>
                      </CardHeader>
                      <CardContent className="p-0 overflow-auto max-h-[400px]">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              {table.headers.map((h, i) => (
                                <th key={i} className="px-4 py-3 text-left border-b border-r font-bold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {table.rows.slice(1).map((row, ri) => (
                              <tr key={ri} className="hover:bg-muted/20 border-b last:border-0">
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-4 py-2 border-r last:border-r-0">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {status !== 'idle' && (
          <div className="lg:col-span-3 space-y-6">
            <Card className="border-none shadow-lg bg-primary text-primary-foreground">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Settings size={22} /> Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {[
                    { id: 'selecting-tables', label: 'Identify Tables', desc: 'Mark table areas' },
                    { id: 'refining', label: 'Refine Grids', desc: 'Fine-tune guides' },
                    { id: 'ocr-processing', label: 'Local OCR', desc: 'Tesseract Engine' }
                  ].map((step, idx) => {
                    const isPast = status === 'completed' || 
                      (step.id === 'selecting-tables' && (status === 'refining' || status === 'ocr-processing')) ||
                      (step.id === 'refining' && status === 'ocr-processing');
                    const isCurrent = status === step.id || (step.id === 'refining' && status === 'detecting');

                    return (
                      <div key={step.id} className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isPast || isCurrent ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                          {isPast ? <CheckCircle2 size={16} /> : (idx + 1)}
                        </div>
                        <div className="flex-1">
                          <p className={`font-semibold text-sm ${isCurrent ? 'text-white' : 'text-primary-foreground/70'}`}>{step.label}</p>
                          <p className="text-xs text-primary-foreground/50">{step.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    {status !== 'idle' && status !== 'ocr-processing' && (
                      <Button 
                        variant="outline"
                        className="flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20 py-6 rounded-xl"
                        onClick={goBack}
                      >
                        <ChevronLeft className="mr-1 w-4 h-4" /> Back
                      </Button>
                    )}

                    {status === 'selecting-tables' && (
                      <Button 
                        className="flex-1 bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 rounded-xl shadow-lg"
                        onClick={proceedToRefine}
                        disabled={isDetecting || tableRegions.length === 0}
                      >
                        Next <ChevronRight className="ml-1 w-4 h-4" />
                      </Button>
                    )}

                    {status === 'refining' && (
                      <Button 
                        className="flex-1 bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 rounded-xl shadow-lg"
                        onClick={runOCR}
                      >
                        Process <ChevronRight className="ml-1 w-4 h-4" />
                      </Button>
                    )}

                    {status === 'completed' && (
                      <Button 
                        className="flex-1 bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 rounded-xl shadow-lg"
                        onClick={reset}
                      >
                        New File
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="text-muted-foreground w-5 h-5" /> Tips
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-3">
                <p>• <b>Step 2:</b> Draw boxes specifically around the tables. You can rename them in the left panel.</p>
                <p>• <b>Step 3:</b> Each table you marked now has its own grid. Add vertical guides to separate columns.</p>
                <p>• <b>Local:</b> All OCR processing stays on your device for maximum privacy.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
