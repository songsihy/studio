"use client";

import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Table as TableIcon, 
  Download, 
  Settings, 
  Layers, 
  Languages, 
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DropZone } from '@/components/ocr/DropZone';
import { LineEditor } from '@/components/ocr/LineEditor';
import { 
  ProcessingStatus, 
  TableLine, 
  DocumentPage, 
  ExtractedTable 
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
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [language, setLanguage] = useState('eng');
  const [vLines, setVLines] = useState<TableLine[]>([]);
  const [hLines, setHLines] = useState<TableLine[]>([]);
  const [extractedData, setExtractedData] = useState<ExtractedTable | null>(null);
  const { toast } = useToast();

  const handleFiles = async (files: File[]) => {
    setStatus('uploading');
    // Simulated PDF/Image processing
    // In a real app, use pdf.js here to render pages
    const newPages: DocumentPage[] = await Promise.all(files.map(async (file, idx) => {
      return {
        id: `page-${idx}`,
        originalImage: URL.createObjectURL(file),
        detectedTables: [],
        verticalLines: [],
        horizontalLines: []
      };
    }));

    setPages(newPages);
    setCurrentPageIndex(0);
    setStatus('detecting');
    
    // Auto-detect table logic (Simulated OpenCV call)
    setTimeout(() => {
      const initialVLines: TableLine[] = [
        { id: 'v1', type: 'vertical', position: 10 },
        { id: 'v2', type: 'vertical', position: 40 },
        { id: 'v3', type: 'vertical', position: 70 },
        { id: 'v4', type: 'vertical', position: 90 },
      ];
      const initialHLines: TableLine[] = [
        { id: 'h1', type: 'horizontal', position: 15 },
        { id: 'h2', type: 'horizontal', position: 35 },
        { id: 'h3', type: 'horizontal', position: 55 },
        { id: 'h4', type: 'horizontal', position: 75 },
      ];
      setVLines(initialVLines);
      setHLines(initialHLines);
      setStatus('refining');
      toast({
        title: "Table Detected",
        description: "Review and adjust the grid lines for maximum accuracy.",
      });
    }, 1500);
  };

  const runOCR = async () => {
    setStatus('ocr-processing');
    // Simulated Tesseract.js call per cell
    setTimeout(() => {
      const mockRows = [
        ['Date', 'Transaction', 'Amount', 'Status'],
        ['2023-01-01', 'Server Subscription', '$120.00', 'Paid'],
        ['2023-01-05', 'Domain Renewal', '$20.00', 'Pending'],
        ['2023-01-12', 'Cloud Storage', '$5.00', 'Paid'],
        ['2023-01-20', 'Support Plan', '$45.00', 'Paid'],
      ];
      setExtractedData({ id: 'table-1', rows: mockRows, headers: mockRows[0] });
      setStatus('completed');
      toast({
        title: "Extraction Complete",
        description: "Table data has been extracted successfully.",
      });
    }, 2500);
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
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <TableIcon size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">TableScan Pro</h1>
            <p className="text-sm text-muted-foreground font-medium">Precision OCR & Data Extraction</p>
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

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          {status === 'idle' ? (
            <DropZone onFilesSelected={handleFiles} isLoading={status !== 'idle' && status !== 'error'} />
          ) : (
            <Card className="border-2 shadow-xl overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <FileText className="text-primary w-5 h-5" />
                    <CardTitle className="text-lg">Document Editor</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className={status === 'refining' ? "text-primary animate-pulse" : ""}>
                      {status === 'detecting' && 'Detecting Tables...'}
                      {status === 'refining' && 'Refining Boundaries'}
                      {status === 'ocr-processing' && 'Processing OCR...'}
                      {status === 'completed' && 'Processing Complete'}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <LineEditor 
                  imageSrc={pages[currentPageIndex]?.originalImage || null} 
                  vLines={vLines} 
                  hLines={hLines}
                  onLinesChange={(v, h) => { setVLines(v); setHLines(h); }}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6">
          <Card className="border-none shadow-lg bg-primary text-primary-foreground">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Settings size={22} /> Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${status !== 'idle' ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                    {status !== 'idle' ? <CheckCircle2 size={16} /> : '1'}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Upload Document</p>
                    <p className="text-xs text-primary-foreground/70">Single/Multi PDF or Image files</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${status === 'refining' || status === 'ocr-processing' || status === 'completed' ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                    {status === 'ocr-processing' || status === 'completed' ? <CheckCircle2 size={16} /> : '2'}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Detect & Guide</p>
                    <p className="text-xs text-primary-foreground/70">Automatic grid detection & manual refining</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${status === 'completed' ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                    {status === 'completed' ? <CheckCircle2 size={16} /> : '3'}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Extract Data</p>
                    <p className="text-xs text-primary-foreground/70">Run multi-language OCR on table cells</p>
                  </div>
                </div>
              </div>

              {status === 'refining' && (
                <Button 
                  className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 text-lg rounded-xl shadow-lg"
                  onClick={runOCR}
                >
                  Start OCR Extraction <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              )}
            </CardContent>
          </Card>

          {extractedData && (
            <Card className="border-none shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
              <CardHeader className="bg-secondary/10">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Download className="text-secondary w-5 h-5" /> Export Data
                </CardTitle>
                <CardDescription>Select your preferred output format</CardDescription>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-2 gap-3">
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('html')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">HTML</p>
                    <p className="text-[10px] text-muted-foreground">Web Format</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('csv')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">CSV</p>
                    <p className="text-[10px] text-muted-foreground">Spreadsheet</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('json')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">JSON</p>
                    <p className="text-[10px] text-muted-foreground">Data Structure</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('md')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">Markdown</p>
                    <p className="text-[10px] text-muted-foreground">Documentation</p>
                  </div>
                </Button>
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
              <p>• For tables with <b>wireless</b> lines, use the manual guides to mark columns based on text alignment.</p>
              <p>• Higher resolution images provide better OCR results for Chinese characters.</p>
              <p>• You can process multiple pages simultaneously and merge the results.</p>
            </CardContent>
          </Card>
        </div>
      </main>

      {extractedData && (
        <section className="mt-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <Card className="border-2 shadow-2xl">
            <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl">Extraction Preview</CardTitle>
                <CardDescription>Real-time result of the OCR processing</CardDescription>
              </div>
              <div className="flex gap-2">
                <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">
                  {language === 'eng' ? 'English' : 'Chinese'} Engine
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm shadow-sm z-30">
                  <tr>
                    {extractedData.headers.map((h, i) => (
                      <th key={i} className="px-6 py-4 text-left font-bold border-b border-r last:border-r-0 uppercase tracking-wider text-xs">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {extractedData.rows.slice(1).map((row, ri) => (
                    <tr key={ri} className="hover:bg-muted/30 transition-colors">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-6 py-4 border-r last:border-r-0 whitespace-nowrap">
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
