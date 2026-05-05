
"use client";

import React, { useState } from 'react';
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
  Loader2
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
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Progress } from '@/components/ui/progress';
import { detectLines, processTable } from '@/lib/ocr/processor';

export default function TableScanPro() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [language, setLanguage] = useState('eng');
  const [vLines, setVLines] = useState<TableLine[]>([]);
  const [hLines, setHLines] = useState<TableLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedTable | null>(null);
  const { toast } = useToast();

  const handleFiles = async (files: File[]) => {
    setStatus('uploading');
    
    try {
      const newPages: DocumentPage[] = await Promise.all(files.map(async (file, idx) => {
        return new Promise<DocumentPage>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({
              id: `page-${idx}-${Date.now()}`,
              originalImage: e.target?.result as string,
              detectedTables: [],
              verticalLines: [],
              horizontalLines: []
            });
          };
          reader.readAsDataURL(file);
        });
      }));

      setPages(newPages);
      setCurrentPageIndex(0);
      setStatus('detecting');
      
      // OpenCV Detection
      const firstPage = newPages[0];
      if (firstPage) {
        const { vLines: detectedV, hLines: detectedH } = await detectLines(firstPage.originalImage);
        setVLines(detectedV);
        setHLines(detectedH);
      }
      
      setStatus('refining');
      toast({
        title: "Table Detected",
        description: "OpenCV has identified potential grid lines. Adjust them if necessary.",
      });
    } catch (err) {
      console.error(err);
      setStatus('error');
      toast({
        variant: "destructive",
        title: "Processing Failed",
        description: "Could not detect table structure. Please ensure the image is clear.",
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
        description: "Table data has been extracted using Tesseract.js.",
      });
    } catch (error) {
      console.error(error);
      setStatus('error');
      toast({
        variant: "destructive",
        title: "OCR Error",
        description: "Failed to recognize text in cells. Check your language selection.",
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
    setProgress(0);
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
            <p className="text-sm text-muted-foreground font-medium">Local Computer Vision & OCR</p>
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
                <SelectItem value="spa">Spanish</SelectItem>
                <SelectItem value="fra">French</SelectItem>
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
            <DropZone onFilesSelected={handleFiles} isLoading={status === 'uploading'} />
          ) : (
            <Card className="border-2 shadow-xl overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <FileText className="text-primary w-5 h-5" />
                    <CardTitle className="text-lg">Document Preview</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className={status === 'ocr-processing' ? "text-primary" : "text-muted-foreground"}>
                      {status === 'detecting' && 'Detecting lines with OpenCV...'}
                      {status === 'refining' && 'Ready for OCR'}
                      {status === 'ocr-processing' && `OCR in Progress: ${progress}%`}
                      {status === 'completed' && 'Processing Complete'}
                      {status === 'error' && 'An Error Occurred'}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {status === 'ocr-processing' && (
                  <div className="p-4 bg-muted/20 border-b space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Tesseract Engine Processing Cells...</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
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
                    <p className="text-xs text-primary-foreground/70">Images for local processing</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${status === 'refining' || status === 'ocr-processing' || status === 'completed' ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                    {status === 'ocr-processing' || status === 'completed' ? <CheckCircle2 size={16} /> : '2'}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Line Detection</p>
                    <p className="text-xs text-primary-foreground/70">OpenCV finds table structure</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${status === 'completed' ? 'bg-secondary text-secondary-foreground' : 'bg-primary-foreground/20 text-white'}`}>
                    {status === 'completed' ? <CheckCircle2 size={16} /> : '3'}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Tesseract OCR</p>
                    <p className="text-xs text-primary-foreground/70">Extract text from each cell</p>
                  </div>
                </div>
              </div>

              {(status === 'refining' || status === 'error') && (
                <Button 
                  className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold py-6 text-lg rounded-xl shadow-lg"
                  onClick={runOCR}
                >
                  Process Table Now <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              )}
              {status === 'ocr-processing' && (
                <Button disabled className="w-full py-6 text-lg rounded-xl bg-secondary/50">
                  <Loader2 className="mr-2 animate-spin" />
                  <span>OCR Working...</span>
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
                <CardDescription>Get your structured results</CardDescription>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-2 gap-3">
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('html')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">HTML</p>
                    <p className="text-[10px] text-muted-foreground">Web View</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('csv')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">CSV</p>
                    <p className="text-[10px] text-muted-foreground">Excel/Sheets</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('json')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">JSON</p>
                    <p className="text-[10px] text-muted-foreground">Developer API</p>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3 px-4 border-2 hover:border-primary hover:bg-primary/5" onClick={() => handleExport('md')}>
                  <div className="text-left">
                    <p className="font-bold text-sm">Markdown</p>
                    <p className="text-[10px] text-muted-foreground">Wiki/Docs</p>
                  </div>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card className="border-none shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="text-muted-foreground w-5 h-5" /> Precision Tips
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>• <b>Line Tuning:</b> OpenCV finds main lines, but you can manually add/move lines for wireless tables.</p>
              <p>• <b>Language:</b> Select the correct language to load specific Tesseract training data.</p>
              <p>• <b>Performance:</b> OCR runs cell-by-cell. For large tables, this may take a few moments.</p>
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
                <CardDescription>Processed locally with Tesseract.js</CardDescription>
              </div>
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
