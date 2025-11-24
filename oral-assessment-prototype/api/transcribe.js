// /api/transcribe.js
import { OpenAI } from "openai";

export const config = {
  api: {
    bodyParser: false, // REQUIRED for file uploads
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read raw buffer from request
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const audioBuffer = Buffer.concat(buffers);

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // IMPORTANT: Whisper transcription using GPT-4o-transcribe
    const transcription = await openai.audio.transcriptions.create({
      file: audioBuffer,
      model: "gpt-4o-transcribe",
      filename: "audio.webm",
    });

    return res.status(200).json({
      transcript: transcription.text,
    });
  } catch (err) {
    console.error("TRANSCRIBE ERROR:", err);
    return res.status(500).json({ error: err.message || "Transcription failed" });
  }
}
