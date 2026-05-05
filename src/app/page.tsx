
"use client";

import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Table as TableIcon, 
  Download, 
  Settings, 
  Languages, 
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ScanSearch,
  Sparkles,
  Files
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DropZone } from '@/components/ocr/DropZone';
import { LineEditor } from '@/components/ocr/LineEditor';
import { TableSelector } from '@/components/ocr/TableSelector';
import { 
  ProcessingStatus, 
  TableLine, 
  DocumentPage, 
  ExtractedTable,
  TableRegion
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
import { detectLines, processTable, detectTableRegions } from '@/lib/ocr/processor';
import { pdfToImages } from '@/lib/ocr/pdf-loader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [language, setLanguage] = useState('eng');
  const [vLines, setVLines] = useState<TableLine[]>([]);
  const [hLines, setHLines] = useState<TableLine[]>([]);
  const [tableRegions, setTableRegions] = useState<TableRegion[]>([]);
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedTable | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const { toast } = useToast();

  // Update the parent pages array when current page edits change
  useEffect(() => {
    if (pages.length > 0 && pages[currentPageIndex]) {
      setPages(prev => prev.map((p, idx) => 
        idx === currentPageIndex 
          ? { ...p, tableRegions, verticalLines: vLines, horizontalLines: hLines }
          : p
      ));
    }
  }, [vLines, hLines, tableRegions]);

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
        tableRegions: [],
        verticalLines: [],
        horizontalLines: []
      }));

      setPages(newPages);
      setCurrentPageIndex(0);
      setTableRegions([]);
      setVLines([]);
      setHLines([]);
      setStatus('selecting-tables');
      
      // Auto-detect regions for the first page
      autoDetectRegions(allPageImages[0]);

      toast({
        title: "Documents Loaded",
        description: `Successfully processed ${newPages.length} page(s).`,
      });
    } catch (err) {
      console.error(err);
      setStatus('error');
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: "Could not process files. Ensure they are valid PDFs or images.",
      });
    }
  };

  const handlePageSelect = (index: number) => {
    if (index === currentPageIndex) return;
    
    const targetPage = pages[index];
    if (targetPage) {
      setCurrentPageIndex(index);
      setVLines(targetPage.verticalLines || []);
      setHLines(targetPage.horizontalLines || []);
      setTableRegions(targetPage.tableRegions || []);
      
      // If we are in selection mode and the new page has no regions, auto-detect
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
      console.warn("Auto-detection failed, proceed manually.", err);
    } finally {
      setIsDetecting(false);
    }
  };

  const proceedToRefine = async () => {
    const currentPage = pages[currentPageIndex];
    if (!currentPage) return;

    setStatus('detecting');
    try {
      // Pass the current identified table regions to restrict the search
      const { vLines: detectedV, hLines: detectedH } = await detectLines(currentPage.originalImage, tableRegions);
      setVLines(detectedV || []);
      setHLines(detectedH || []);
      setStatus('refining');
    } catch (err) {
      console.warn("OpenCV could not find table lines automatically:", err);
      // Fallback: Proceed to manual refinement instead of showing an error screen
      setVLines([]);
      setHLines([]);
      setStatus('refining');
      toast({
        title: "Detection Limited",
        description: "Automatic grid detection was unsuccessful in the selected regions. You can now add manual guides.",
      });
    }
  };

  const runOCR = async () => {
    const currentPage = pages[currentPageIndex];
    if (!currentPage?.originalImage) return;

    setStatus('ocr-processing');
    setProgress(0);
    
    try {
      const result = await processTable(
        currentPage.originalImage, 
        vLines, 
        hLines, 
        language,
        (p) => setProgress(Math.floor(p * 100))
      );

      setExtractedData({ 
        id: `table-${Date.now()}`, 
        rows: [result.headers, ...result.rows], 
        headers: result.headers 
      });
      
      setStatus('completed');
      toast({
        title: "OCR Complete",
        description: "Table data has been extracted locally.",
      });
    } catch (error) {
      console.error(error);
      setStatus('error');
      toast({
        variant: "destructive",
        title: "OCR Error",
        description: "Failed to recognize text in cells.",
      });
    }
  };

  const handleExport = (format: 'csv' | 'json' | 'md' | 'html') => {
    if (!extractedData) return;
    
    let content = '';
    let fileName = `table-export.${format}`;
    let type = 'text/plain';

    switch(format) {
      case 'csv': content = exportToCSV(extractedData); type = 'text/csv'; break;
      case 'json': content = exportToJSON(extractedData); type = 'application/json'; break;
      case 'md': content = exportToMarkdown(extractedData); break;
      case 'html': content = exportToHTML(extractedData); type = 'text/html'; break;
    }

    downloadFile(content, fileName, type);
  };

  const reset = () => {
    setPages([]);
    setExtractedData(null);
    setStatus('idle');
    setVLines([]);
    setHLines([]);
    setTableRegions([]);
    setCurrentPageIndex(0);
    setProgress(0);
    setIsDetecting(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <TableIcon size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">TableScan Pro</h1>
            <p className="text-sm text-muted-foreground font-medium">Professional Document OCR</p>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-card border px-3 py-2 rounded-lg shadow-sm flex-1 md:flex-none">
            <Languages size={18} className="text-muted-foreground" />
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full md:w-40 border-0 shadow-none focus:ring-0">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eng">English</SelectItem>
                <SelectItem value="chi_tra">Traditional Chinese</SelectItem>
                <SelectItem value="chi_sim">Simplified Chinese</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status !== 'idle' && (
            <Button variant="ghost" onClick={reset} className="text-muted-foreground hover:text-destructive">
              <RotateCcw className="w-4 h-4 mr-2" /> Reset
            </Button>
          )}
        </div>
      </header>

      <main className={cn(
        "grid gap-8",
        status === 'idle' ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12"
      )}>
        {/* Page Gallery Sidebar */}
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
                      "relative aspect-[3/4] rounded-lg border-2 overflow-hidden transition-all group",
                      currentPageIndex === idx 
                        ? "border-primary shadow-md ring-2 ring-primary/20" 
                        : "border-transparent hover:border-muted-foreground/30"
                    )}
                  >
                    <img 
                      src={page.originalImage} 
                      alt={`Page ${idx + 1}`} 
                      className="w-full h-full object-cover"
                    />
                    <div className={cn(
                      "absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-white",
                      currentPageIndex === idx ? "bg-primary" : ""
                    )}>
                      {idx + 1}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </aside>
        )}

        <div className={cn(
          "space-y-6",
          status === 'idle' ? "w-full" : "lg:col-span-7"
        )}>
          {status === 'idle' ? (
            <DropZone onFilesSelected={handleFiles} isLoading={status === 'uploading'} />
          ) : (
            <Card className="border-2 shadow-xl overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <FileText className="text-primary w-5 h-5" />
                    <CardTitle className="text-lg">
                      {status === 'selecting-tables' ? 'Step 2: Define Table Regions' : 'Step 3: Refine Grid Lines'}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {isDetecting && (
                      <span className="flex items-center gap-1.5 text-primary animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin" /> Detecting Tables...
                      </span>
                    )}
                    <span className={status === 'ocr-processing' ? "text-primary" : "text-muted-foreground"}>
                      {status === 'selecting-tables' && !isDetecting && 'Mark table areas'}
                      {status === 'detecting' && 'Analyzing regions...'}
                      {status === 'refining' && 'Fine-tune lines'}
                      {status === 'ocr-processing' && `OCR: ${progress}%`}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {status === 'ocr-processing' && (
                  <div className="p-4 bg-muted/20 border-b space-y-2">
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
                
                {status === 'selecting-tables' && (
                  <TableSelector 
                    imageSrc={pages[currentPageIndex]?.originalImage || null}
                    regions={tableRegions}
                    onRegionsChange={setTableRegions}
                  />
                )}

                {(status === 'refining' || status === 'ocr-processing' || status === 'completed' || status === 'detecting') && (
                  <LineEditor 
                    imageSrc={pages[currentPageIndex]?.originalImage || null} 
                    vLines={vLines} 
                    hLines={hLines}
                    onLinesChange={(v, h) => { setVLines(v); setHLines(h); }}
                  />
                )}
              </CardContent>
            </Card>
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
                    { id: 'uploading', label: 'Upload Document', desc: 'PDF or Image' },
                    { id: 'selecting-tables', label: 'Identify Tables', desc: 'Mark table areas' },
                    { id: 'refining', label: 'Line Detection', desc: 'Refine wireless lines' },
                    { id: 'ocr-processing', label: 'Tesseract OCR', desc: 'Local extraction' }
                  ].map((step, idx) => {
                    const isPast = status === 'completed' || 
                      (step.id === 'uploading' && status !== 'idle') ||
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

                {status === 'selecting-tables' && (
                  <div className="space-y-3">
                    <Button 
                      variant="outline"
                      className="w-full bg-white/10 hover:bg-white/20 border-white/20 text-white font-semibold"
                      onClick={() => autoDetectRegions(pages[currentPageIndex]?.originalImage)}
                      disabled={isDetecting}
                    >
                      <Sparkles className="mr-2 w-4 h-4" /> Re-scan Page {currentPageIndex + 1}
                    </Button>
                    <Button 
                      className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 text-lg rounded-xl shadow-lg"
                      onClick={proceedToRefine}
                      disabled={isDetecting || tableRegions.length === 0}
                    >
                      Analyze Regions <ScanSearch className="ml-2 w-5 h-5" />
                    </Button>
                    {tableRegions.length === 0 && (
                      <p className="text-[10px] text-center text-primary-foreground/60 italic">
                        Draw at least one table region to continue
                      </p>
                    )}
                  </div>
                )}

                {(status === 'refining' || status === 'error') && (
                  <Button 
                    className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 text-lg rounded-xl shadow-lg"
                    onClick={runOCR}
                  >
                    Start OCR <ChevronRight className="ml-2 w-5 h-5" />
                  </Button>
                )}
              </CardContent>
            </Card>

            {extractedData && (
              <Card className="border-none shadow-lg overflow-hidden">
                <CardHeader className="bg-secondary/10">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Download className="text-secondary w-5 h-5" /> Export Data
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 grid grid-cols-2 gap-3">
                  {['csv', 'json', 'md', 'html'].map((fmt) => (
                    <Button key={fmt} variant="outline" className="justify-start border-2 hover:border-primary" onClick={() => handleExport(fmt as any)}>
                      <span className="uppercase text-xs font-bold">{fmt}</span>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="text-muted-foreground w-5 h-5" /> Tips
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-2">
                <p>• <b>Precision:</b> Detection is now focused only on your identified regions.</p>
                <p>• <b>Multi-Page:</b> Use the left sidebar to switch between document pages.</p>
                <p>• <b>Wireless:</b> For tables without lines, add vertical/horizontal guides manually in Step 3.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {extractedData && (
        <section className="mt-12">
          <Card className="border-2 shadow-2xl">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="text-xl">Extraction Preview</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm shadow-sm z-30">
                  <tr>
                    {extractedData.headers.map((h, i) => (
                      <th key={i} className="px-6 py-4 text-left font-bold border-b border-r last:border-r-0 uppercase tracking-wider text-xs bg-muted/50">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {extractedData.rows.slice(1).map((row, ri) => (
                    <tr key={ri} className="hover:bg-muted/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-6 py-4 border-r last:border-r-0">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
