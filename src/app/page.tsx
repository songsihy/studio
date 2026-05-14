
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Table as TableIcon, 
  Settings, 
  ChevronRight, 
  ChevronLeft, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ScanSearch, 
  Files, 
  Grid3X3, 
  Cpu,
  Bot,
  Globe,
  Key,
  MessageSquare,
  Zap,
  PenTool
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
  TableLine,
  PreprocessingOptions,
  OcrEngineConfig,
  ExtractionStrategy
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
];

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['eng', 'chi_tra']);
  const [progress, setProgress] = useState(0);
  const [allExtractedData, setAllExtractedData] = useState<ExtractedTable[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCvLoaded, setIsCvLoaded] = useState(false);
  
  const [engineConfig, setEngineConfig] = useState<OcrEngineConfig>({
    type: 'tesseract',
    aiConfig: {
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o',
      systemPrompt: 'Extract only the text content from this table cell. If empty, return an empty string.'
    }
  });

  const { toast } = useToast();
  const autoDetectedPages = useRef<Set<string>>(new Set());
  const currentPage = pages[currentPageIndex];

  useEffect(() => {
    const checkCv = setInterval(() => {
      if (typeof window !== 'undefined' && window.cv && window.cv.imread) {
        setIsCvLoaded(true);
        clearInterval(checkCv);
      }
    }, 500);
    return () => clearInterval(checkCv);
  }, []);

  const updateCurrentPageRegions = useCallback((newRegions: TableRegion[]) => {
    setPages(prev => prev.map((p, idx) => 
      idx === currentPageIndex ? { ...p, tableRegions: newRegions } : p
    ));
  }, [currentPageIndex]);

  const autoDetectRegions = useCallback(async (imageSrc: string) => {
    if (!imageSrc || !isCvLoaded) return;
    setIsDetecting(true);
    try {
      const detected = await detectTableRegions(imageSrc);
      updateCurrentPageRegions(detected);
    } catch (err) {
    } finally {
      setIsDetecting(false);
    }
  }, [isCvLoaded, updateCurrentPageRegions]);

  useEffect(() => {
    if (isCvLoaded && status === 'selecting-tables' && currentPage && (currentPage.tableRegions?.length || 0) === 0) {
      if (!autoDetectedPages.current.has(currentPage.id)) {
        autoDetectedPages.current.add(currentPage.id);
        autoDetectRegions(currentPage.originalImage);
      }
    }
  }, [isCvLoaded, status, currentPage?.id, autoDetectRegions]);

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
          const imgData = await new Promise<string>((res) => {
            reader.onload = (e) => res(e.target?.result as string);
            reader.readAsDataURL(file);
          });
          allPageImages.push(imgData);
        }
      }
      setPages(allPageImages.map((img, idx) => ({
        id: `page-${idx}-${Date.now()}`,
        originalImage: img,
        tableRegions: []
      })));
      setCurrentPageIndex(0);
      autoDetectedPages.current.clear();
      setStatus('selecting-tables');
    } catch (err) {
      setStatus('error');
    }
  };

  const handlePageSelect = (index: number) => {
    if (index === currentPageIndex) return;
    setCurrentPageIndex(index);
  };

  const proceedToRefine = async () => {
    setStatus('detecting');
    try {
      const updatedPages = [...pages];
      const langStr = selectedLangs.join('+');
      for (let i = 0; i < updatedPages.length; i++) {
        const page = updatedPages[i];
        if (page.tableRegions.length > 0) {
          const regionsWithLines = await detectLinesInRegions(page.originalImage, page.tableRegions, langStr);
          updatedPages[i] = { ...page, tableRegions: regionsWithLines };
        }
      }
      setPages(updatedPages);
      setStatus('refining');
    } catch (err) {
      setStatus('refining');
    }
  };

  const runOCR = async () => {
    if (engineConfig.type === 'ai' && !engineConfig.aiConfig.apiKey) {
      toast({ variant: "destructive", title: "API Configuration Missing" });
      return;
    }
    setStatus('ocr-processing');
    setProgress(0);
    try {
      let finalResults: ExtractedTable[] = [];
      const totalRegions = pages.reduce((acc, p) => acc + p.tableRegions.length, 0);
      let processedRegions = 0;
      const langString = selectedLangs.join('+');

      for (const page of pages) {
        if (page.tableRegions.length > 0) {
          const pageResults = await processTablesOnPage(page.originalImage, page.tableRegions, langString, engineConfig);
          finalResults = [...finalResults, ...pageResults];
          processedRegions += page.tableRegions.length;
          setProgress(Math.floor((processedRegions / totalRegions) * 100));
        }
      }
      setAllExtractedData(finalResults);
      setStatus('completed');
    } catch (error) {
      setStatus('error');
    }
  };

  const goBack = () => {
    if (status === 'selecting-tables') reset();
    else if (status === 'refining') setStatus('selecting-tables');
    else if (status === 'completed') setStatus('refining');
  };

  const updateRegionLines = (id: string, vLines: TableLine[], hLines: TableLine[]) => {
    setPages(prev => prev.map(p => ({
      ...p,
      tableRegions: p.tableRegions.map(r => r.id === id ? { ...r, verticalLines: vLines, horizontalLines: hLines } : r)
    })));
  };

  const updateRegionPreprocessing = (id: string, options: PreprocessingOptions) => {
    setPages(prev => prev.map(p => ({
      ...p,
      tableRegions: p.tableRegions.map(r => r.id === id ? { ...r, preprocessing: options } : r)
    })));
  };

  const updateRegionStrategy = (id: string, strategy: ExtractionStrategy) => {
    setPages(prev => prev.map(p => ({
      ...p,
      tableRegions: p.tableRegions.map(r => r.id === id ? { ...r, extractionStrategy: strategy } : r)
    })));
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
    setCurrentPageIndex(0);
    autoDetectedPages.current.clear();
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {!isCvLoaded && (
        <Alert className="mb-6 bg-primary/10 border-primary/20 text-primary"><AlertDescription className="text-xs font-medium">Initializing Vision Engine...</AlertDescription></Alert>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg"><TableIcon size={28} /></div>
          <div><h1 className="text-3xl font-bold tracking-tight">TableScan Pro</h1><p className="text-sm text-muted-foreground font-medium">Layout-Aware OCR</p></div>
        </div>
        
        <div className="flex items-center gap-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 gap-2 bg-card shadow-sm">
                <Settings size={18} /> Engine Settings
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="end">
              <Tabs defaultValue={engineConfig.type} onValueChange={(v) => setEngineConfig(p => ({ ...p, type: v as any }))}>
                <TabsList className="w-full h-12">
                  <TabsTrigger value="tesseract" className="flex-1 gap-2"><Cpu size={14} /> Tesseract</TabsTrigger>
                  <TabsTrigger value="scribe" className="flex-1 gap-2"><PenTool size={14} /> Scribe</TabsTrigger>
                  <TabsTrigger value="ai" className="flex-1 gap-2"><Bot size={14} /> AI</TabsTrigger>
                </TabsList>
                <TabsContent value="tesseract" className="p-4 space-y-4">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Languages</Label>
                  <ScrollArea className="h-48 border rounded-md p-3">
                    {SUPPORTED_LANGS.map(lang => (
                      <div key={lang.id} className="flex items-center space-x-2 mb-2">
                        <Checkbox id={lang.id} checked={selectedLangs.includes(lang.id)} onCheckedChange={() => setSelectedLangs(p => p.includes(lang.id) ? p.filter(l => l !== lang.id) : [...p, lang.id])} />
                        <Label htmlFor={lang.id} className="text-sm font-medium">{lang.label}</Label>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="scribe" className="p-4 space-y-4">
                  <div className="p-4 bg-muted/30 rounded-lg text-center space-y-2">
                    <PenTool size={24} className="mx-auto text-primary" />
                    <p className="text-xs font-medium">Scribe.js Engine</p>
                    <p className="text-[10px] text-muted-foreground italic">Powerful local layout recognition optimized for multi-language tables.</p>
                  </div>
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Languages</Label>
                  <ScrollArea className="h-32 border rounded-md p-3">
                    {SUPPORTED_LANGS.slice(0, 5).map(lang => (
                      <div key={lang.id} className="flex items-center space-x-2 mb-2">
                        <Checkbox id={`scribe-${lang.id}`} checked={selectedLangs.includes(lang.id)} onCheckedChange={() => setSelectedLangs(p => p.includes(lang.id) ? p.filter(l => l !== lang.id) : [...p, lang.id])} />
                        <Label htmlFor={`scribe-${lang.id}`} className="text-sm font-medium">{lang.label}</Label>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="ai" className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold">API KEY</Label>
                    <Input type="password" value={engineConfig.aiConfig.apiKey} onChange={(e) => setEngineConfig(p => ({ ...p, aiConfig: { ...p.aiConfig, apiKey: e.target.value } }))} placeholder="sk-..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold">Model</Label>
                    <Input value={engineConfig.aiConfig.model} onChange={(e) => setEngineConfig(p => ({ ...p, aiConfig: { ...p.aiConfig, model: e.target.value } }))} placeholder="gpt-4o" />
                  </div>
                </TabsContent>
              </Tabs>
            </PopoverContent>
          </Popover>
          {status !== 'idle' && <Button variant="ghost" onClick={reset}><RotateCcw className="w-4 h-4 mr-2" /> Reset</Button>}
        </div>
      </header>

      <main className={cn("grid gap-8", status === 'idle' ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12")}>
        {status !== 'idle' && pages.length > 0 && (
          <aside className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 px-1 text-sm font-semibold text-muted-foreground"><Files size={16} /> Pages ({pages.length})</div>
            <ScrollArea className="h-[calc(100vh-250px)] pr-4">
              <div className="flex flex-col gap-3">
                {pages.map((page, idx) => (
                  <button key={page.id} onClick={() => handlePageSelect(idx)} className={cn("relative aspect-[3/4] rounded-lg border-2 overflow-hidden transition-all", currentPageIndex === idx ? "border-primary ring-2 ring-primary/20" : "opacity-60")}>
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
                    <CardTitle className="text-lg flex items-center gap-2"><ScanSearch className="w-5 h-5" /> Step 2: Define Tables</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => currentPage && autoDetectRegions(currentPage.originalImage)} disabled={isDetecting}>Auto-Detect</Button>
                  </CardHeader>
                  <TableSelector imageSrc={currentPage?.originalImage || null} regions={currentPage?.tableRegions || []} onRegionsChange={updateCurrentPageRegions} allPages={pages} currentPageIndex={currentPageIndex} onNavigateToPage={handlePageSelect} />
                </Card>
              )}
              {status === 'refining' && (
                <div className="space-y-8">
                  {pages.map((page, pIdx) => (
                    <React.Fragment key={page.id}>
                      {page.tableRegions.map((region, rIdx) => (
                        <LineEditor 
                          key={region.id} 
                          title={`${region.name} (Page ${pIdx + 1})`} 
                          language={selectedLangs.join('+')} 
                          imageSrc={page.originalImage} 
                          cropRect={region} 
                          vLines={region.verticalLines} 
                          hLines={region.horizontalLines} 
                          onLinesChange={(v, h) => updateRegionLines(region.id, v, h)} 
                          onPreprocessingChange={(opts) => updateRegionPreprocessing(region.id, opts)} 
                          onStrategyChange={(s) => updateRegionStrategy(region.id, s)}
                          engineType={engineConfig.type}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
              {status === 'ocr-processing' && (
                <Card className="p-12 text-center space-y-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
                  <Progress value={progress} className="h-2 max-w-md mx-auto" />
                  <p className="text-sm font-bold text-primary">{progress}% Extraction In Progress</p>
                </Card>
              )}
              {status === 'completed' && (
                <div className="space-y-8">
                  {allExtractedData.map((table) => (
                    <Card key={table.id} className="border-2 shadow-lg overflow-hidden">
                      <CardHeader className="bg-muted/30 flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">{table.tableName}</CardTitle>
                        <div className="flex gap-2">
                          {['csv', 'md', 'html'].map(fmt => <Button key={fmt} size="sm" variant="outline" className="h-7 text-[10px] uppercase font-bold" onClick={() => handleExport(table, fmt as any)}>{fmt}</Button>)}
                        </div>
                      </CardHeader>
                      <CardContent className="p-0 overflow-auto max-h-[400px]">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>{table.headers.map((h, i) => <th key={i} className="px-4 py-3 text-left border-b border-r">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {table.rows.slice(1).map((row, ri) => (
                              <tr key={ri} className="hover:bg-muted/20 border-b">
                                {row.map((cell, ci) => <td key={ci} className="px-4 py-2 border-r">{cell}</td>)}
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
          <aside className="lg:col-span-3 space-y-6">
            <Card className="bg-primary text-primary-foreground border-none">
              <CardHeader><CardTitle className="text-lg">Workflow</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { id: 'selecting-tables', label: 'Select Areas', step: 2 },
                  { id: 'refining', label: 'Refine Grids', step: 3 },
                  { id: 'ocr-processing', label: 'Extracting', step: 4 }
                ].map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold", status === s.id ? "bg-white text-primary" : "bg-white/20")}>{s.step}</div>
                    <span className={cn("text-sm", status === s.id ? "font-bold" : "opacity-60")}>{s.label}</span>
                  </div>
                ))}
                <div className="flex gap-2 mt-4 pt-4 border-t border-white/20">
                  <Button variant="outline" className="flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20" onClick={goBack}><ChevronLeft className="w-4 h-4" /></Button>
                  {status === 'selecting-tables' && <Button className="flex-1 bg-secondary text-secondary-foreground" onClick={proceedToRefine}>Next</Button>}
                  {status === 'refining' && <Button className="flex-1 bg-secondary text-secondary-foreground" onClick={runOCR}>Extract</Button>}
                </div>
              </CardContent>
            </Card>
          </aside>
        )}
      </main>
    </div>
  );
}
