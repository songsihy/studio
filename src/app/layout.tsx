import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'TableScan Pro | Intelligent Table OCR',
  description: 'Precision OCR for complex tables. Handle wired and wireless structures with ease.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased bg-background min-h-screen">
        {children}
        <Toaster />
        {/* Load OpenCV.js from CDN with afterInteractive strategy for better reliability */}
        <Script 
          src="https://docs.opencv.org/4.10.0/opencv.js" 
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
