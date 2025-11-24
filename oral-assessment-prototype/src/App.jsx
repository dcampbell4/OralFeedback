import React, { useEffect, useRef, useState } from "react";

/**
 * App.jsx
 * Frontend for Oral Assessment Prototype (Vite + React)
 *
 * This front-end:
 *  - records audio (MediaRecorder)
 *  - displays timer + simple audio analysis (volume/pitch estimate)
 *  - uploads audio to POST /api/transcribe (serverless) for Whisper transcription
 *  - shows transcript, automated feedback, narrative feedback
 *  - requests 4 probing questions from POST /api/questions
 *
 * Notes:
 *  - Deploy on Vercel for serverless functions to work.
 *  - Make sure OPENAI_API_KEY is set in Vercel env vars.
 */

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Small academic seed-list (language & literature). Backend may expand this further.
const SEED_ACADEMIC_WORDS = [
  "metaphor","simile","imagery","symbolism","tone","syntax","diction","motif","theme",
  "persona","narrative","voice","irony","oxymoron","juxtaposition","alliteration","assonance",
  "sibilance","enjambment","caesura","stanza","structure","form","context","connotation",
  "foregrounding","lexis","discourse","semantic","mood","rhythm","meter","prosody","register","attitude"
];

export default function App() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // audio analysis
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const volHistoryRef = useRef([]);
  const pitchHistoryRef = useRef([]);

  useEffect(() => {
    // initial seed list (frontend copy only)
    // We keep a runtime Set so dynamic expansion is possible in session
    window.__ACADEMIC_SET__ = new Set(SEED_ACADEMIC_WORDS);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) try { audioCtxRef.current.close(); } catch (e) {}
    };
  }, []);

  async function startRecording() {
    try {
      setPermissionDenied(false);

      if (!window.isSecureContext) {
        setPermissionDenied(true);
        alert("Microphone access requires HTTPS or localhost. Preview sandboxes often block microphone.");
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionDenied(true);
        alert("getUserMedia is not available in this environment.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        void uploadAndTranscribe(blob);
      };

      // Web Audio setup
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);

      mr.start();
      setRecording(true);
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= 600) { // 10 minutes cap
            stopRecording();
            return 600;
          }
          return s + 1;
        });
      }, 1000);

      volHistoryRef.current = [];
      pitchHistoryRef.current = [];
      analyzeLoop();
    } catch (err) {
      console.error("startRecording error", err);
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setPermissionDenied(true);
        alert("Microphone access blocked. Enable permissions in your browser or use file upload.");
      } else {
        alert("Could not access microphone. Check browser permissions.");
      }
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch (e) {}
    }
  }

  function analyzeLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const size = analyser.fftSize;
    const buffer = new Float32Array(size);
    analyser.getFloatTimeDomainData(buffer);

    // RMS volume
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);
    volHistoryRef.current.push(rms);
    if (volHistoryRef.current.length > 300) volHistoryRef.current.shift();

    // very light pitch estimate (autocorrelation-like simple)
    const pitch = lightPitchEstimate(buffer, audioCtxRef.current ? audioCtxRef.current.sampleRate : 44100);
    if (pitch) {
      pitchHistoryRef.current.push(pitch);
      if (pitchHistoryRef.current.length > 300) pitchHistoryRef.current.shift();
    }

    rafRef.current = requestAnimationFrame(analyzeLoop);
  }

  function lightPitchEstimate(buf, sr) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return null;
    let best = -1; let bestCorr = 0;
    for (let off = 10; off < Math.min(500, SIZE - 2); off++) {
      let corr = 0;
      for (let i = 0; i < SIZE - off; i++) corr += Math.abs(buf[i] - buf[i + off]);
      corr = 1 - corr / (SIZE - off);
      if (corr > bestCorr) { bestCorr = corr; best = off; }
    }
    if (bestCorr > 0.5 && best > 0) return Math.round(sr / best);
    return null;
  }

  async function uploadAndTranscribe(blobOrFile) {
    setUploading(true);
    setTranscript("");
    setAnalysis(null);
    setQuestions([]);

    try {
      const form = new FormData();
      // blobOrFile may be a File (from upload) or Blob (from recorder)
      form.append("file", blobOrFile, "speech.webm");

      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error("Transcription failed");
      const j = await res.json();
      const text = j.transcript || j.text || "";
      setTranscript(text);

      const fb = analyzeTranscript(text);
      setAnalysis(fb);

      const qRes = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text })
      });
      if (qRes.ok) {
        const qj = await qRes.json();
        setQuestions(Array.isArray(qj.questions) ? qj.questions : (Array.isArray(qj) ? qj : []));
      }
    } catch (err) {
      console.error(err);
      alert("Upload/transcribe error: " + (err && err.message ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }

  // simple transcript analyzer (front-end)
  function analyzeTranscript(text) {
    if (!text || !text.trim()) return null;
    const normalized = text.replace(/\n/g, " ").trim();
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const wordCount = tokens.length;

    // filler words - quick list
    const FILLER_WORDS = ["um","uh","like","you know","so","actually","basically","right","i mean","well"];
    const lowered = normalized.toLowerCase();
    let fillerCount = 0;
    for (const fw of FILLER_WORDS) {
      if (fw.includes(" ")) {
        const re = new RegExp(fw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), "gi");
        fillerCount += (lowered.match(re) || []).length;
      } else {
        for (const t of tokens) if (t.toLowerCase() === fw) fillerCount++;
      }
    }

    // dynamic expansion heuristic (session-only)
    const set = window.__ACADEMIC_SET__ || new Set(SEED_ACADEMIC_WORDS);
    for (const tRaw of tokens) {
      const t = tRaw.toLowerCase().replace(/[^a-z\-]/g, "");
      if (!set.has(t) && /^[a-z\-]{6,30}$/.test(t)) {
        set.add(t);
      }
    }
    window.__ACADEMIC_SET__ = set;
    let academicMatches = 0;
    for (const t of tokens) if (set.has(t.toLowerCase())) academicMatches++;

    const uniq = new Set(tokens.map(t => t.toLowerCase()));
    const ttr = uniq.size / Math.max(1, wordCount);

    const sentences = normalized.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    const avgSentenceLen = sentences.length ? (sentences.reduce((acc, s) => acc + s.split(/\s+/).filter(Boolean).length, 0) / sentences.length) : 0;

    const syllables = tokens.reduce((acc, w) => {
      const cleaned = w.toLowerCase().replace(/[^a-z]/g, "");
      const m = cleaned.match(/[aeiouy]{1,2}/g);
      let syll = m ? m.length : 0;
      if (cleaned.endsWith("e")) syll = Math.max(1, syll - 1);
      return acc + Math.max(1, syll);
    }, 0);

    const wordsPerSentence = wordCount / Math.max(1, sentences.length);
    const flesch = Math.max(0, 206.835 - 1.015 * wordsPerSentence - 84.6 * (syllables / Math.max(1, wordCount)));

    return {
      wordCount,
      fillerCount,
      fillerRate: fillerCount / Math.max(1, wordCount),
      academicMatches,
      ttr,
      avgSentenceLen,
      flesch: Math.round(flesch),
      pitchMean: Math.round(mean(pitchHistoryRef.current) || 0),
      volumeMean: Math.round(mean(volHistoryRef.current) * 1000) / 1000,
      wordsPerMinute: Math.round(wordCount / Math.max(1, seconds / 60 || 1))
    };
  }

  // small internal tests you can run from UI
  function runInternalTests() {
    const s1 = "Um, I think the data indicates a significant trend. Like, it suggests a method to analyze variables.";
    const s2 = "Well, actually, the theory suggests an approach. Um, it's significant.";
    const r1 = analyzeTranscript(s1);
    const r2 = analyzeTranscript(s2);
    console.log("Internal tests", r1, r2);
    alert("Internal tests run. Check console.");
    return [r1, r2];
  }

  return (
    <div style={{ padding: 32, fontFamily: "system-ui, Arial", background: "#f7faff", minHeight: "100vh" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", background: "white", padding: 24, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,40,92,0.06)" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0b3d91", marginBottom: 8 }}>Oral Assessment Prototype</h1>
        <p style={{ color: "#444", marginTop: 0 }}>Record a 10-minute practice speech and get immediate automated feedback.</p>

        <div style={{ marginTop: 12 }}>
          <button onClick={startRecording} disabled={recording} style={{ marginRight: 8, padding: "12px 20px", borderRadius: 12, border: "none", background: recording ? "#7faef8" : "#0b63e0", color: "white", cursor: recording ? "not-allowed" : "pointer", fontSize: 15 }}>Start Recording</button>
        <button onClick={stopRecording} disabled={!recording} style={{ padding: "12px 20px", borderRadius: 12, border: "none", background: !recording ? "#999" : "#e00b0b", color: "white", cursor: !recording ? "not-allowed" : "pointer", fontSize: 15 }}>Stop Recording</button>
        <span style={{ marginLeft: 20, fontSize: 18 }}>Timer: {formatTime(seconds)}</span>
        </div>

        {permissionDenied ? (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #f00", background: "#fff6f6" }}>
            <strong>Microphone blocked.</strong>
            <p>Please allow microphone access in your browser or use the upload fallback below.</p>
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 600, color: "#0b3d91" }}>Upload audio file (optional alternative to recording):</label>
          <input type="file" accept="audio/*" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #0b63e0", background: "white", cursor: "pointer" }} onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            setAudioUrl(URL.createObjectURL(f));
            await uploadAndTranscribe(f);
          }} />
        </div>

        <div style={{ marginTop: 12 }}>
          <button style={{ padding: "12px 20px", borderRadius: 12, background: "#0b63e0", border: "none", color: "white", cursor: "pointer", fontSize: 15 }} onClick={() => {
            setTranscript("Um, I think the data indicates a significant trend. Like, it suggests a method to analyze variables.");
            setAnalysis(analyzeTranscript("Um, I think the data indicates a significant trend. Like, it suggests a method to analyze variables."));
          }}>Use sample transcript</button>

        <button style={{ marginLeft: 12, padding: "10px 18px", borderRadius: 12, background: "#0b63e0", border: "none", color: "white", cursor: "pointer", fontSize: 14 }} onClick={() => { runInternalTests(); }}>Run internal tests</button>
        </div>

        <div style={{ marginTop: 16 }}>
          {audioUrl ? <audio src={audioUrl} controls style={{ display: "block", marginTop: 8 }} /> : null}
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>Transcript</h3>
          {uploading ? <div>Uploading & transcribing...</div> : <pre style={{ whiteSpace: "pre-wrap" }}>{transcript || "(No transcript yet)"}</pre>}
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>Automated Feedback</h3>
          {analysis ? (
            <div>
              <div>
                <div style={{ color: analysis.wordCount > 0 ? '#222' : '#999' }}>Words: {analysis.wordCount}</div>
                <div style={{ color: analysis.fillerRate <= 0.08 ? 'green' : analysis.fillerRate <= 0.12 ? 'orange' : 'red' }}>
                  Filler words: {analysis.fillerCount} (rate: {(analysis.fillerRate * 100).toFixed(2)}%)
                </div>
                <div style={{ color: analysis.academicMatches >= 3 && analysis.academicMatches <= 10 ? 'green' : analysis.academicMatches <= 15 ? 'orange' : 'red' }}>
                  Academic word matches: {analysis.academicMatches}
                </div>
                <div style={{ color: analysis.ttr >= 0.45 && analysis.ttr <= 0.7 ? 'green' : analysis.ttr <= 0.8 ? 'orange' : 'red' }}>
                  Type-token ratio: {analysis.ttr.toFixed(3)}
                </div>
                <div style={{ color: analysis.avgSentenceLen >= 12 && analysis.avgSentenceLen <= 18 ? 'green' : analysis.avgSentenceLen <= 24 ? 'orange' : 'red' }}>
                  Avg sentence length: {analysis.avgSentenceLen.toFixed(1)} words
                </div>
                <div style={{ color: analysis.flesch >= 50 && analysis.flesch <= 70 ? 'green' : analysis.flesch <= 80 ? 'orange' : 'red' }}>
                  Flesch reading ease (approx): {analysis.flesch}
                </div>
                <div style={{ color: '#444' }}>Estimated pitch mean (Hz): {analysis.pitchMean}</div>
                <div style={{ color: '#444' }}>Estimated volume mean (RMS): {analysis.volumeMean}</div>
                <div style={{ color: analysis.wordsPerMinute >= 130 && analysis.wordsPerMinute <= 165 ? 'green' : analysis.wordsPerMinute <= 180 ? 'orange' : 'red' }}>
                  Words per minute (approx): {analysis.wordsPerMinute}
                </div>
              </div>
              <div style={{ marginTop: 16, padding: 12, background: '#fafafa', border: '1px solid #ddd' }}>
                <h4>Narrative Feedback</h4>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{/* narrative inserted below */ analysis ? (function(){ /* reuse same generator in frontend for narrative feedback */ 
                    // small inline generator to avoid separate import
                    const fb = [];
                    if (analysis.fillerRate <= 0.08) fb.push("Your speech demonstrates excellent control over filler words.");
                    else if (analysis.fillerRate <= 0.12) fb.push("You use filler words occasionally; reducing them slightly would help polish.");
                    else fb.push("Filler use is high; practice pauses instead of fillers.");
                    if (analysis.academicMatches >= 4 && analysis.academicMatches <= 10) fb.push("Your academic vocabulary reads natural and appropriate.");
                    else if (analysis.academicMatches <= 15) fb.push("Your vocabulary is adequate though could be broadened.");
                    else fb.push("You rely heavily on academic terminology; consider balancing with accessible phrasing.");
                    return fb.join("\\n\\n");
                })() : "(No narrative yet)"} </pre>
              </div>
            </div>
          ) : (
            <div>(No feedback yet)</div>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>AI Probing Questions</h3>
          {questions.length ? (
            <ol>
              {questions.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          ) : (
            <div>(No questions yet)</div>
          )}
        </div>

        <div style={{ marginTop: 24, color: "#666" }}>
          <small>Notes: /api/transcribe and /api/questions are serverless functions. Set OPENAI_API_KEY in Vercel env vars. If you want to include your glossary PDF in the backend, note its path: /mnt/data/english-lang-and-lit-glossary-of-terms.pdf</small>
        </div>
      </div>
    </div>
  );
}
