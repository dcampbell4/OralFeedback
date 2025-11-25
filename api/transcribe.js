// /api/transcribe.js
import { OpenAI } from "openai";

// Vercel Modern Functions use this format
export const config = {
  runtime: "nodejs"
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }), 
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Read binary audio from request
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return new Response(
        JSON.stringify({ error: "No audio provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert ArrayBuffer → File (OpenAI SDK requires File or Blob)
    const audioFile = new File([arrayBuffer], "audio.webm", {
      type: "audio/webm"
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-transcribe"
    });

    return new Response(
      JSON.stringify({ transcript: result.text }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("TRANSCRIBE ERROR:", error);
    return new Response(
      JSON.stringify({ error: "Transcription failed", detail: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
