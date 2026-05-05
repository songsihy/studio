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
  Grid3X3,
  Check,
  Info,
  Wand2
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from '@/components/ui/progress';
import { detectTableRegions, processTablesOnPage, detectLinesInRegions } from '@/lib/ocr/processor';
import { pdfToImages } from '@/lib/ocr/pdf-loader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

const SUPPORTED_LANGS = [
  { id: 'eng', label: 'English' },
  { id: 'chi_tra', label: 'Chinese (Traditional)' },
  { id: 'chi_sim', label: 'Chinese (Simplified)' },
  { id: 'jpn', label: 'Japanese' },
  { id: 'kor', label: 'Korean' },
  { id: 'fra', label: 'French' },
  { id: 'deu', label: 'German' },
  { id: 'spa', label: 'Spanish' },
  { id: 'ita', label: 'Italian' },
  { id: 'por', label: 'Portuguese' },
  { id: 'vie', label: 'Vietnamese' },
  { id: 'rus', label: 'Russian' },
  { id: 'ara', label: 'Arabic' },
];

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['eng']);
  const [tableRegions, setTableRegions] = useState<TableRegion[]>([]);
  const [progress, setProgress] = useState(0);
  const [allExtractedData, setAllExtractedData] = useState<ExtractedTable[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCvLoaded, setIsCvLoaded] = useState(false);
  const { toast } = useToast();

  const currentPage = pages[currentPageIndex];

  useEffect(() => {
    const checkCv = setInterval(() => {
      if (typeof window !== 'undefined' && window.cv) {
        setIsCvLoaded(true);
        clearInterval(checkCv);
      }
    }, 500);
    return () => clearInterval(checkCv);
  }, []);

  useEffect(() => {
    if (status === 'selecting-tables' && pages.length > 0 && currentPage) {
      setPages(prev => prev.map((p, idx) => 
        idx === currentPageIndex ? { ...p, tableRegions } : p
      ));
    }
  }, [tableRegions, status]);

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
      // Optional: Auto-detect if page has no regions yet
      if (status === 'selecting-tables' && (targetPage.tableRegions?.length || 0) === 0) {
        autoDetectRegions(targetPage.originalImage);
      }
    }
  };

  const autoDetectRegions = async (imageSrc: string) => {
    if (!imageSrc || !isCvLoaded) return;
    setIsDetecting(true);
    try {
      const detected = await detectTableRegions(imageSrc);
      setTableRegions(detected);
      toast({
        title: "Detection Complete",
        description: `Identified ${detected.length} potential table area(s).`,
      });
    } catch (err) {
      console.warn("Detection failed:", err);
      toast({
        variant: "destructive",
        title: "Detection Failed",
        description: "OpenCV could not automatically define table areas."
      });
    } finally {
      setIsDetecting(false);
    }
  };

  const proceedToRefine = async () => {
    setStatus('detecting');
    try {
      const updatedPages = [...pages];
      for (let i = 0; i < updatedPages.length; i++) {
        const page = updatedPages[i];
        if (page.tableRegions.length > 0) {
          const regionsWithLines = await detectLinesInRegions(page.originalImage, page.tableRegions);
          updatedPages[i] = { ...page, tableRegions: regionsWithLines };
        }
      }
      setPages(updatedPages);
      setTableRegions(updatedPages[currentPageIndex].tableRegions);
      setStatus('refining');
    } catch (err) {
      console.warn("Grid detection limited:", err);
      setStatus('refining');
    }
  };

  const runOCR = async () => {
    if (selectedLangs.length === 0) {
      toast({
        variant: "destructive",
        title: "No Language Selected",
        description: "Please select at least one language for OCR.",
      });
      return;
    }

    setStatus('ocr-processing');
    setProgress(0);
    try {
      let finalResults: ExtractedTable[] = [];
      const totalRegions = pages.reduce((acc, p) => acc + (p.tableRegions?.length || 0), 0);
      let processedRegions = 0;

      const langString = selectedLangs.join('+');

      for (const page of pages) {
        if (page.tableRegions.length > 0) {
          const pageResults = await processTablesOnPage(
            page.originalImage, 
            page.tableRegions, 
            langString,
            () => {} 
          );
          finalResults = [...finalResults, ...pageResults];
          processedRegions++;
          setProgress(Math.floor((processedRegions / totalRegions) * 100));
        }
      }
      
      setAllExtractedData(finalResults);
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
    setPages(prev => prev.map(p => ({
      ...p,
      tableRegions: p.tableRegions.map(r => 
        r.id === id ? { ...r, verticalLines: vLines, horizontalLines: hLines } : r
      )
    })));

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

  const toggleLang = (id: string) => {
    setSelectedLangs(prev => 
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {!isCvLoaded && (
        <Alert className="mb-6 bg-primary/10 border-primary/20 text-primary">
          <Info size={16} />
          <AlertDescription className="text-xs font-medium">
            OpenCV.js is initializing for advanced table analysis...
          </AlertDescription>
        </Alert>
      )}

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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2 bg-card border px-3 py-2 h-10 rounded-lg shadow-sm">
                <Languages size={18} className="text-muted-foreground" />
                <span className="text-sm font-medium">
                  {selectedLangs.length === 0 
                    ? "Select Languages" 
                    : `${selectedLangs.length} Language${selectedLangs.length > 1 ? 's' : ''}`
                  }
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
              <div className="p-4 border-b bg-muted/20">
                <h4 className="font-bold text-sm">OCR Languages</h4>
                <p className="text-[10px] text-muted-foreground">Select multiple for mixed-language tables</p>
              </div>
              <ScrollArea className="h-64">
                <div className="p-4 space-y-3">
                  {SUPPORTED_LANGS.map((lang) => (
                    <div key={lang.id} className="flex items-center space-x-3">
                      <Checkbox 
                        id={lang.id} 
                        checked={selectedLangs.includes(lang.id)}
                        onCheckedChange={() => toggleLang(lang.id)}
                      />
                      <Label htmlFor={lang.id} className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        {lang.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

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
                  <CardHeader className="bg-muted/30 border-b py-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ScanSearch className="w-5 h-5 text-primary" /> Step 2: Define Table Areas
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 bg-background shadow-sm hover:bg-secondary/10"
                      onClick={() => currentPage && autoDetectRegions(currentPage.originalImage)}
                      disabled={isDetecting || !isCvLoaded}
                    >
                      {isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4 text-secondary" />}
                      Auto-Detect
                    </Button>
                  </CardHeader>
                  <TableSelector 
                    imageSrc={currentPage?.originalImage || null}
                    regions={tableRegions}
                    onRegionsChange={setTableRegions}
                    allPages={pages}
                    currentPageIndex={currentPageIndex}
                    onNavigateToPage={handlePageSelect}
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
                        <p className="text-xs text-muted-foreground">Adjust lines for all identified tables across all pages</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-8">
                    {pages.map((page, pIdx) => (
                      <React.Fragment key={page.id}>
                        {(page.tableRegions || []).map((region, rIdx) => (
                          <LineEditor 
                            key={region.id}
                            title={`${region.name || `Table ${rIdx + 1}`} (Page ${pIdx + 1})`}
                            imageSrc={page.originalImage}
                            cropRect={region}
                            vLines={region.verticalLines || []}
                            hLines={region.horizontalLines || []}
                            onLinesChange={(v, h) => updateRegionLines(region.id, v, h)}
                          />
                        ))}
                      </React.Fragment>
                    ))}
                    {pages.every(p => (p.tableRegions?.length || 0) === 0) && (
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
                    <p className="text-xs text-primary font-bold">Languages: {selectedLangs.join(', ')}</p>
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
                        disabled={isDetecting || pages.every(p => (p.tableRegions?.length || 0) === 0 && (p.id !== currentPage?.id || tableRegions.length === 0))}
                      >
                        Next <ChevronRight className="ml-1 w-4 h-4" />
                      </Button>
                    )}

                    {status === 'refining' && (
                      <Button 
                        className="flex-1 bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 rounded-xl shadow-lg"
                        onClick={runOCR}
                        disabled={selectedLangs.length === 0}
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
                <p>• <b>Languages:</b> You can select multiple languages for mixed-content tables.</p>
                <p>• <b>Step 2:</b> Draw boxes around tables. Use "Auto-Detect" to let OpenCV suggest areas.</p>
                <p>• <b>Step 3:</b> Refine the grid lines for each table before starting the OCR process.</p>
                <p>• <b>Local:</b> All data extraction is handled locally in your browser.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
