// /api/transcribe.js
import { OpenAI } from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read raw data from request
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: "Missing audio data" });
    }

    // Convert buffer → File (required by OpenAI SDK)
    const audioFile = new File([buffer], "audio.webm", {
      type: "audio/webm",
    });

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Whisper transcription
    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-transcribe",
    });

    return res.status(200).json({
      transcript: result.text,
    });

  } catch (error) {
    console.error("TRANSCRIBE ERROR:", error);
    return res.status(500).json({
      error: "Transcription failed",
      detail: error.message,
    });
  }
}
