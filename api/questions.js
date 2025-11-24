// api/questions.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await (async () => {
      if (req.headers["content-type"] && req.headers["content-type"].includes("application/json")) {
        return req.body;
      } else {
        // some Vercel runtimes parse JSON automatically; fallback:
        const text = await new Promise((resolve, reject) => {
          let s = "";
          req.on("data", (c) => s += c);
          req.on("end", () => resolve(s));
          req.on("error", reject);
        });
        return text ? JSON.parse(text) : {};
      }
    })();

    const transcript = (body && body.transcript) ? body.transcript : "";

    const prompt = `You are an academic oral assessment assistant. Given the transcript below, write 4 concise probing or clarifying questions that would help a listener evaluate or dig deeper into the speaker's points. Keep questions short.

Transcript:
"${transcript.replace(/\\"/g, '"')}"`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text();
      console.error("OpenAI questions error:", openaiRes.status, txt);
      return res.status(500).json({ error: "Question generation API error", details: txt });
    }

    const json = await openaiRes.json();
    const text = json.choices?.[0]?.message?.content || json.choices?.[0]?.text || "";

    const questions = text
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^\d+\.?\s*/, "").trim())
      .slice(0, 4);

    return res.status(200).json({ questions });
  } catch (err) {
    console.error("questions handler error:", err);
    return res.status(500).json({ error: err.message || "Question generation failed" });
  }
}
