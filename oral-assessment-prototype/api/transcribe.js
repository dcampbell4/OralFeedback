// api/transcribe.js
import fetch from "node-fetch";
import FormData from "form-data";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // In Vercel edge-like environment, the body isn't automatically parsed into form-data.
    // We'll access the raw body via the node incoming message and reconstruct a FormData to send to OpenAI.
    // If using Vercel Serverless (Node), you can access req.body if you use multer — but multer isn't included by default.
    // Simpler approach: stream the incoming request into the OpenAI endpoint directly.
    // NOTE: This approach works in environments where req is a Node IncomingMessage (serverless).
    // If this doesn't work in your environment, replace this handler with a multer-based approach.

    // Read the incoming raw buffer
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const raw = Buffer.concat(buffers);

    // We'll forward the raw multipart body to OpenAI, but OpenAI requires proper multipart headers.
    // Easiest reliable way: re-create form-data containing the file from the raw buffer.
    // For demonstration, try to attach it as 'file' with content-type audio/webm
    const form = new FormData();
    form.append("file", raw, { filename: "speech.webm", contentType: "audio/webm" });
    // specify model/language as needed
    // As of OpenAI API: POST https://api.openai.com/v1/audio/transcriptions
    const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        // NOTE: DO NOT set content-type here; form-data sets it.
      },
      body: form
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text();
      console.error("OpenAI transcription error:", openaiRes.status, txt);
      return res.status(500).json({ error: "Transcription API error", details: txt });
    }

    const parsed = await openaiRes.json();
    // OpenAI returns { text: "..." } in some versions; adjust as necessary
    const transcript = parsed.text || parsed.transcript || parsed.data || (parsed?.choices && parsed.choices[0]?.text) || "";

    return res.status(200).json({ transcript });
  } catch (err) {
    console.error("transcribe handler error:", err);
    return res.status(500).json({ error: err.message || "Transcription failed" });
  }
}
