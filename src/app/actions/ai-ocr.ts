'use server';

/**
 * @fileOverview Server-side proxy for AI OCR requests to bypass CORS.
 */

export async function callAiEngineAction(
  imageUri: string, 
  apiUrl: string, 
  apiKey: string, 
  model: string, 
  systemPrompt: string
): Promise<string> {
  try {
    const base64Image = imageUri.split(',')[1] || imageUri;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: systemPrompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 150
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI Engine error: ${err}`);
    }

    const data = await response.json();
    // Support common OpenAI-style response format
    const content = data.choices?.[0]?.message?.content || data.output?.text || "";
    return content.trim();
  } catch (error) {
    console.error("Server-side AI OCR Error:", error);
    throw new Error(error instanceof Error ? error.message : "Internal Server Error during AI OCR");
  }
}
