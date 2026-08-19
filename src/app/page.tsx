
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Table as TableIcon, 
  Settings, 
  ChevronRight, 
  ChevronLeft, 
  RotateCcw, 
  CheckCircle2, 
  Loader2, 
  ScanSearch, 
  Files, 
  Grid3X3, 
  Cpu,
  Bot,
  PenTool,
  Layers,
  Sparkles,
  Key,
  Undo2,
  Redo2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Check,
  X
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
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

/**
 * Interactive Result Table component with History (Undo/Redo/Reset), 
 * Row Merging, Row Removal, and Cell Editing.
 */
function InteractiveTable({ table, onExport }: { table: ExtractedTable, onExport: (table: ExtractedTable, format: any) => void }) {
  const [data, setData] = useState<string[][]>(table.rows);
  const [history, setHistory] = useState<string[][][]>([table.rows]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ r: number, c: number } | null>(null);
  const [editValue, setEditValue] = useState("");

  const pushToHistory = (newData: string[][]) => {
    const cleanData = cleanupTable(newData);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(cleanData);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setData(cleanData);
    setSelectedRows(new Set());
  };

  const cleanupTable = (rows: string[][]) => {
    if (rows.length === 0) return rows;
    const filteredRows = rows.filter(row => row.some(cell => cell.trim().length > 0));
    if (filteredRows.length === 0) return [];
    const colCount = filteredRows[0].length;
    const emptyCols = new Set<number>();
    for (let c = 0; c < colCount; c++) {
      if (filteredRows.every(row => row[c].trim().length === 0)) emptyCols.add(c);
    }
    return filteredRows.map(row => row.filter((_, c) => !emptyCols.has(c)));
  };

  const undo = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setData(history[idx]);
      setSelectedRows(new Set());
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setData(history[idx]);
      setSelectedRows(new Set());
    }
  };

  const reset = () => {
    setData(table.rows);
    setHistory([table.rows]);
    setHistoryIndex(0);
    setSelectedRows(new Set());
  };

  const handleEditStart = (r: number, c: number, val: string) => {
    setEditingCell({ r, c });
    setEditValue(val);
  };

  const handleEditCommit = () => {
    if (!editingCell) return;
    const newData = data.map((row, ri) => 
      ri === editingCell.r ? row.map((cell, ci) => ci === editingCell.c ? editValue : cell) : row
    );
    pushToHistory(newData);
    setEditingCell(null);
  };

  const mergeSelected = () => {
    if (selectedRows.size < 2) return;
    const sortedIndices = Array.from(selectedRows).sort((a, b) => a - b);
    const firstIdx = sortedIndices[0];
    const newData = [...data];
    const mergedRow = [...newData[firstIdx]];
    
    for (let i = 1; i < sortedIndices.length; i++) {
      const currentIdx = sortedIndices[i];
      newData[currentIdx].forEach((val, ci) => {
        if (val.trim()) mergedRow[ci] = (mergedRow[ci] + " " + val).trim();
      });
    }
    
    newData[firstIdx] = mergedRow;
    const finalData = newData.filter((_, idx) => idx === firstIdx || !selectedRows.has(idx));
    pushToHistory(finalData);
  };

  const removeSelectedRows = () => {
    if (selectedRows.size === 0) return;
    const newData = data.filter((_, idx) => !selectedRows.has(idx));
    pushToHistory(newData);
  };

  const removeColumn = (colIdx: number) => {
    const newData = data.map(row => row.filter((_, ci) => ci !== colIdx));
    pushToHistory(newData);
  };

  const mergeColumnUp = (colIdx: number) => {
    const newData = [...data];
    for (let i = 1; i < newData.length; i++) {
      if (!newData[i-1][colIdx].trim() && newData[i][colIdx].trim()) {
        newData[i-1][colIdx] = newData[i][colIdx];
        newData[i][colIdx] = "";
      }
    }
    pushToHistory(newData);
  };

  const mergeColumnDown = (colIdx: number) => {
    const newData = [...data];
    for (let i = newData.length - 2; i >= 0; i--) {
      if (!newData[i+1][colIdx].trim() && newData[i][colIdx].trim()) {
        newData[i+1][colIdx] = newData[i][colIdx];
        newData[i][colIdx] = "";
      }
    }
    pushToHistory(newData);
  };

  const toggleRow = (idx: number) => {
    const next = new Set(selectedRows);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedRows(next);
  };

  if (data.length === 0) return null;

  return (
    <Card className="border-2 shadow-lg overflow-hidden">
      <CardHeader className="bg-muted/30 flex flex-col md:flex-row md:items-center justify-between border-b p-4 gap-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider">{table.tableName}</CardTitle>
          <div className="flex bg-background border rounded-lg p-1 shadow-sm">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={undo} disabled={historyIndex === 0} title="Undo">
              <Undo2 size={14} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={redo} disabled={historyIndex === history.length - 1} title="Redo">
              <Redo2 size={14} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={reset} title="Reset">
              <RotateCcw size={14} />
            </Button>
          </div>
          <div className="flex gap-2">
            {selectedRows.size > 1 && (
              <Button size="sm" variant="secondary" className="h-7 text-[10px] font-bold bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" onClick={mergeSelected}>
                MERGE {selectedRows.size} ROWS
              </Button>
            )}
            {selectedRows.size > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold text-destructive border-destructive/20 hover:bg-destructive/10" onClick={removeSelectedRows}>
                DELETE {selectedRows.size} ROWS
              </Button>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {['csv', 'md', 'html'].map(fmt => (
            <Button key={fmt} size="sm" variant="outline" className="h-7 text-[10px] uppercase font-bold" onClick={() => onExport({ ...table, rows: data, headers: data[0] }, fmt as any)}>
              {fmt}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-auto max-h-[600px]">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              <th className="w-10 px-2 py-3 border-b border-r bg-muted/80"></th>
              {data[0].map((_, ci) => (
                <th key={ci} className="px-2 py-2 border-b border-r group min-w-[120px]">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase truncate">Col {ci + 1}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeColumn(ci)} title="Remove Column">
                        <Trash2 size={10} />
                      </Button>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="outline" size="icon" className="h-6 flex-1 text-[9px]" onClick={() => mergeColumnUp(ci)} title="Merge Up">
                        <ArrowUp size={10} className="mr-0.5" /> UP
                      </Button>
                      <Button variant="outline" size="icon" className="h-6 flex-1 text-[9px]" onClick={() => mergeColumnDown(ci)} title="Merge Down">
                        <ArrowDown size={10} className="mr-0.5" /> DN
                      </Button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri} className={cn(
                "hover:bg-primary/5 transition-colors border-b",
                selectedRows.has(ri) && "bg-primary/10"
              )}>
                <td className="w-10 px-2 py-2 border-r text-center bg-muted/10">
                  <Checkbox checked={selectedRows.has(ri)} onCheckedChange={() => toggleRow(ri)} className="scale-75" />
                </td>
                {row.map((cell, ci) => (
                  <td 
                    key={ci} 
                    className="px-4 py-2 border-r text-foreground/80 relative min-w-[120px]"
                    onDoubleClick={() => handleEditStart(ri, ci, cell)}
                  >
                    {editingCell?.r === ri && editingCell?.c === ci ? (
                      <div className="absolute inset-0 z-20 bg-background flex items-center p-1">
                        <Input 
                          autoFocus 
                          value={editValue} 
                          onChange={(e) => setEditValue(e.target.value)} 
                          onBlur={handleEditCommit}
                          onKeyDown={(e) => e.key === 'Enter' && handleEditCommit()}
                          className="h-full text-xs"
                        />
                      </div>
                    ) : (
                      <div className="truncate max-w-[300px]" title={cell}>{cell || <span className="text-muted-foreground/30 italic text-[10px]">empty</span>}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

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
      console.error(err);
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
      toast({ variant: "destructive", title: "API Configuration Missing", description: "Please enter your API Key in Step 2 settings." });
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
        <Alert className="mb-6 bg-primary/10 border-primary/20 text-primary">
          <AlertDescription className="text-xs font-medium flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Initializing Vision Engine...
          </AlertDescription>
        </Alert>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg"><TableIcon size={28} /></div>
          <div><h1 className="text-3xl font-bold tracking-tight">TableScan Pro</h1><p className="text-sm text-muted-foreground font-medium">Layout-Aware OCR</p></div>
        </div>
        
        <div className="flex items-center gap-4">
          {status !== 'idle' && (
            <Button variant="ghost" onClick={reset} className="text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> Start Over
            </Button>
          )}
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
          {status === 'idle' || status === 'uploading' ? (
            <DropZone onFilesSelected={handleFiles} isLoading={status === 'uploading'} />
          ) : (
            <div className="space-y-6">
              {status === 'selecting-tables' && (
                <div className="space-y-6">
                  <Card className="border-2 shadow-sm overflow-hidden">
                    <CardHeader className="bg-muted/30 border-b py-4">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
                        <Settings className="w-4 h-4 text-primary" /> 1. OCR Engine Settings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Tabs defaultValue={engineConfig.type} onValueChange={(v) => setEngineConfig(p => ({ ...p, type: v as any }))}>
                        <TabsList className="w-full h-12 rounded-none border-b bg-transparent">
                          <TabsTrigger value="tesseract" className="flex-1 gap-2 data-[state=active]:bg-primary/5 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><Cpu size={14} /> Tesseract.js</TabsTrigger>
                          <TabsTrigger value="scribe" className="flex-1 gap-2 data-[state=active]:bg-primary/5 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><PenTool size={14} /> Scribe (Optimized)</TabsTrigger>
                          <TabsTrigger value="ai" className="flex-1 gap-2 data-[state=active]:bg-primary/5 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><Bot size={14} /> AI Engine</TabsTrigger>
                        </TabsList>
                        <TabsContent value="tesseract" className="p-6 space-y-4 m-0">
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <Label className="text-[10px] font-bold uppercase text-muted-foreground">Recognition Languages</Label>
                              <ScrollArea className="h-40 border rounded-lg p-3 bg-muted/20">
                                {SUPPORTED_LANGS.map(lang => (
                                  <div key={lang.id} className="flex items-center space-x-2 mb-2">
                                    <Checkbox id={lang.id} checked={selectedLangs.includes(lang.id)} onCheckedChange={() => setSelectedLangs(p => p.includes(lang.id) ? p.filter(l => l !== lang.id) : [...p, lang.id])} />
                                    <Label htmlFor={lang.id} className="text-xs font-medium cursor-pointer">{lang.label}</Label>
                                  </div>
                                ))}
                              </ScrollArea>
                            </div>
                            <div className="space-y-4">
                              <div className="p-4 rounded-xl border bg-primary/5 space-y-2">
                                <h4 className="text-xs font-bold text-primary">Tesseract Engine</h4>
                                <p className="text-[10px] leading-relaxed text-muted-foreground">Standard high-performance OCR. Optimized for multi-language tables with layout awareness.</p>
                              </div>
                            </div>
                          </div>
                        </TabsContent>
                        <TabsContent value="scribe" className="p-6 space-y-4 m-0">
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <Label className="text-[10px] font-bold uppercase text-muted-foreground">Languages</Label>
                              <ScrollArea className="h-40 border rounded-lg p-3 bg-muted/20">
                                {SUPPORTED_LANGS.slice(0, 5).map(lang => (
                                  <div key={lang.id} className="flex items-center space-x-2 mb-2">
                                    <Checkbox id={`scribe-${lang.id}`} checked={selectedLangs.includes(lang.id)} onCheckedChange={() => setSelectedLangs(p => p.includes(lang.id) ? p.filter(l => l !== lang.id) : [...p, lang.id])} />
                                    <Label htmlFor={`scribe-${lang.id}`} className="text-xs font-medium cursor-pointer">{lang.label}</Label>
                                  </div>
                                ))}
                              </ScrollArea>
                            </div>
                            <div className="space-y-4">
                              <div className="p-4 rounded-xl border bg-primary/5 space-y-2">
                                <h4 className="text-xs font-bold text-primary">Scribe Logic</h4>
                                <p className="text-[10px] leading-relaxed text-muted-foreground">Specialized layout analysis that prioritizes vertical text flow and mixed character sets.</p>
                              </div>
                            </div>
                          </div>
                        </TabsContent>
                        <TabsContent value="ai" className="p-6 space-y-4 m-0">
                          <div className="space-y-4 max-w-md">
                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold flex items-center gap-1"><Key size={10} /> API KEY</Label>
                              <Input type="password" value={engineConfig.aiConfig.apiKey} onChange={(e) => setEngineConfig(p => ({ ...p, aiConfig: { ...p.aiConfig, apiKey: e.target.value } }))} placeholder="sk-..." className="h-8 text-xs" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold flex items-center gap-1"><Cpu size={10} /> Model</Label>
                              <Input value={engineConfig.aiConfig.model} onChange={(e) => setEngineConfig(p => ({ ...p, aiConfig: { ...p.aiConfig, model: e.target.value } }))} placeholder="gpt-4o" className="h-8 text-xs" />
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>

                  <Card className="border-2 shadow-xl overflow-hidden">
                    <CardHeader className="bg-muted/30 border-b py-4 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
                        <ScanSearch className="w-4 h-4 text-primary" /> 2. Define Table Regions
                      </CardTitle>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] font-bold" onClick={() => currentPage && autoDetectRegions(currentPage.originalImage)} disabled={isDetecting}>
                        {isDetecting ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
                        AUTO-DETECT TABLES
                      </Button>
                    </CardHeader>
                    <TableSelector 
                      imageSrc={currentPage?.originalImage || null} 
                      regions={currentPage?.tableRegions || []} 
                      onRegionsChange={updateCurrentPageRegions} 
                      allPages={pages} 
                      currentPageIndex={currentPageIndex} 
                      onNavigateToPage={handlePageSelect} 
                    />
                  </Card>
                </div>
              )}
              {status === 'refining' && (
                <div className="space-y-8">
                  {pages.map((page, pIdx) => (
                    <React.Fragment key={page.id}>
                      {page.tableRegions.map((region) => (
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
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-bold">Extracting Data...</p>
                    <p className="text-sm text-muted-foreground">Using {engineConfig.type.toUpperCase()} Engine to process your tables.</p>
                  </div>
                  <div className="max-w-md mx-auto space-y-2">
                    <Progress value={progress} className="h-2" />
                    <p className="text-[10px] font-bold text-primary text-right">{progress}%</p>
                  </div>
                </Card>
              )}
              {status === 'completed' && (
                <div className="space-y-8">
                  {allExtractedData.map((table) => (
                    <InteractiveTable key={table.id} table={table} onExport={handleExport} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {status !== 'idle' && (
          <aside className="lg:col-span-3 space-y-6">
            <Card className="bg-primary text-primary-foreground border-none shadow-xl overflow-hidden">
              <div className="p-6 space-y-6">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold">Workflow Progress</h3>
                  <p className="text-xs text-primary-foreground/70">Complete each step to extract data.</p>
                </div>
                
                <div className="space-y-4">
                  {[
                    { id: 'selecting-tables', label: '1. Choose Engine & Areas', icon: Grid3X3 },
                    { id: 'refining', label: '2. Refine Grid Lines', icon: Layers },
                    { id: 'ocr-processing', label: '3. Extract Data', icon: Sparkles }
                  ].map((s, idx) => {
                    const isActive = status === s.id;
                    const isDone = (status === 'refining' && idx === 0) || (status === 'ocr-processing' && idx <= 1) || (status === 'completed');
                    return (
                      <div key={s.id} className="flex items-center gap-3">
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                          isActive ? "bg-white text-primary shadow-lg scale-110" : isDone ? "bg-secondary text-secondary-foreground" : "bg-white/10"
                        )}>
                          {isDone ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                        </div>
                        <span className={cn("text-sm transition-all", isActive ? "font-bold" : "opacity-60")}>{s.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 pt-6 border-t border-white/20">
                  {status === 'selecting-tables' && (
                    <Button 
                      className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 font-bold h-11" 
                      onClick={proceedToRefine}
                      disabled={pages.every(p => p.tableRegions.length === 0)}
                    >
                      CONTINUE TO REFINE <ChevronRight className="ml-2 w-4 h-4" />
                    </Button>
                  )}
                  {status === 'refining' && (
                    <Button className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 font-bold h-11" onClick={runOCR}>
                      START EXTRACTION <ChevronRight className="ml-2 w-4 h-4" />
                    </Button>
                  )}
                  {status !== 'selecting-tables' && status !== 'ocr-processing' && (
                    <Button variant="outline" className="w-full bg-white/10 hover:bg-white/20 text-white border-white/20" onClick={goBack}>
                      <ChevronLeft className="mr-2 w-4 h-4" /> BACK
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </aside>
        )}
      </main>
    </div>
  );
}

