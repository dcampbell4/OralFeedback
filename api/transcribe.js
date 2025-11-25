import { OpenAI } from "openai";

export const config = { runtime: "nodejs" };

export default async function handler(req) {
  console.log("REQ METHOD:", req.method);
  console.log("CONTENT TYPE:", req.headers.get("content-type"));
  console.log("API KEY EXISTS:", !!process.env.OPENAI_API_KEY);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405
    });
  }

  try {
    const arrayBuffer = await req.arrayBuffer();
    console.log("AUDIO BYTES:", arrayBuffer.byteLength);

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: "No audio received" }), {
        status: 400
      });
    }

    const audioFile = new File([arrayBuffer], "audio.webm", {
      type: req.headers.get("content-type") || "audio/webm"
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-transcribe"
    });

    return new Response(JSON.stringify({ transcript: result.text }), {
      status: 200
    });

  } catch (err) {
    console.error("TRANSCRIBE ERROR:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    });
  }
}
