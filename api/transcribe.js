// /api/transcribe.js
import { OpenAI } from "openai";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  console.log("REQ METHOD:", req.method);
  console.log("HEADERS:", req.headers);
  console.log("API KEY EXISTS:", !!process.env.OPENAI_API_KEY);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read raw audio buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    console.log("AUDIO BYTES:", buffer.length);

    if (buffer.length === 0) {
      return res.status(400).json({ error: "No audio received" });
    }

    // Use correct Node.js header access
    const contentType = req.headers["content-type"] || "audio/webm";

    // Construct File object for OpenAI
    const audioFile = new File([buffer], "audio.webm", { type: contentType });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-transcribe"
    });

    return res.status(200).json({ transcript: result.text });
  } catch (err) {
    console.error("TRANSCRIBE ERROR:", err);
    return res.status(500).json({ error: err.message || "Transcription failed" });
  }
}
