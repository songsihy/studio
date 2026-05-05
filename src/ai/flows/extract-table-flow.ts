'use server';
/**
 * @fileOverview A flow for extracting table data from images.
 * 
 * - extractTable: Function to process an image and return structured table data.
 * - ExtractTableInput: Schema for image URI and language preference.
 * - ExtractTableOutput: Schema for headers and rows.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractTableInputSchema = z.object({
  imageUri: z.string().describe("The image of the document containing a table as a data URI that includes a MIME type and use Base64 encoding."),
  language: z.string().optional().default('eng'),
});
export type ExtractTableInput = z.infer<typeof ExtractTableInputSchema>;

const ExtractTableOutputSchema = z.object({
  headers: z.array(z.string()).describe("The column headers of the table."),
  rows: z.array(z.array(z.string())).describe("The data rows of the table."),
});
export type ExtractTableOutput = z.infer<typeof ExtractTableOutputSchema>;

export async function extractTable(input: ExtractTableInput): Promise<ExtractTableOutput> {
  return extractTableFlow(input);
}

const extractTableFlow = ai.defineFlow(
  {
    name: 'extractTableFlow',
    inputSchema: ExtractTableInputSchema,
    outputSchema: ExtractTableOutputSchema,
  },
  async (input) => {
    const { output } = await ai.generate({
      prompt: [
        { media: { url: input.imageUri } },
        { text: `You are an expert OCR engine. Extract all table data from this image. 
                 Be precise with numbers and text. 
                 Language: ${input.language}. 
                 Return the result as a structured table with headers and rows.` },
      ],
      output: { schema: ExtractTableOutputSchema },
    });

    if (!output) {
      throw new Error('Failed to extract table data from the document.');
    }

    return output;
  }
);
