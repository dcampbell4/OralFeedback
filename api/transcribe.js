// /api/transcribe.js
import { OpenAI } from "openai";

export const config = {
  runtime: "nodejs20.x",
  maxDuration: 60,
  memory: 1024
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Receive audio as ArrayBuffer
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: "No audio received" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Convert to File object required by OpenAI
    const audioFile = new File([arrayBuffer], "audio.webm", {
      type: "audio/webm"
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const output = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-transcribe"
    });

    return new Response(
      JSON.stringify({ transcript: output.text }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("TRANSCRIPTION ERROR:", err);
    return new Response(
      JSON.stringify({ error: "Transcription failed", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
