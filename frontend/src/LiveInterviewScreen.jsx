import { useEffect, useRef, useState } from "react";
import { HEADERS } from "./lib/api";


// ── Score ring — Premium SaaS styling ──────────────────────────
function ScoreRing({ score, size = 64 }) {
  const r = (size / 2) - 6;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = ((score || 0) / 10) * circ;
  const color = score >= 8 ? "#10b981" : score >= 6 ? "#f59e0b" : "#ef4444";
  const trackColor = "#e2e8f0";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth="5" />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.7s ease" }}
      />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        style={{ fontSize: size * 0.28 + "px", fontWeight: 800, fill: color, fontFamily: "inherit" }}>
        {score || 0}
      </text>
    </svg>
  );
}

const ensureArray = (data) => {
  if (Array.isArray(data)) return data;
  if (typeof data === "string") return data.split(",").map(item => item.trim());
  return [];
};

// ── Protects UI from raw JSON vomit if backend fails ───────────
const cleanText = (text) => {
  if (!text) return "";
  let str = String(text);
  if (str.includes("AI evaluation could not parse")) {
    return "The AI experienced a parsing error while evaluating this specific point. Please refer to the overall feedback.";
  }
  if (str.includes('{"score"')) {
    return "Evaluation detail parsing failed.";
  }
  return str;
};

// ─────────────────────────────────────────────────────────────────
export default function LiveInterviewScreen({ session, auth, API_BASE, onBack }) {
  const videoRef = useRef(null);
  const initializedRef = useRef(false);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("loading");
  const [statusText, setStatusText] = useState("Initializing camera...");
  const [questions, setQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [showManualFallback, setShowManualFallback] = useState(false);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const audioCtxRef = useRef(null);
  const gainedStreamRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [evaluation, setEvaluation] = useState(null);
  const [allResults, setAllResults] = useState([]);

  // ── THE BLACK SCREEN FIX ──
  // This ensures the camera stream reconnects to the video UI 
  // every time the component phase changes and the DOM rebuilds.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, phase]);

  function buildBoostedStream(rawStream, gainValue = 2.8) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(rawStream);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.knee.value = 10;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      const dest = ctx.createMediaStreamDestination();
      source.connect(compressor);
      compressor.connect(gain);
      gain.connect(dest);
      audioCtxRef.current = ctx;
      gainedStreamRef.current = dest.stream;
      return dest.stream;
    } catch (e) {
      console.warn("AudioContext boost failed, using raw stream:", e);
      return rawStream;
    }
  }

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function startMediaAndInterview() {
      try {
        let mediaStream;
        const audioConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        };
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraints });
        } catch (camErr) {
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
            setError("Camera access blocked. Running in audio-only mode.");
          } catch (micErr) {
            throw new Error("Could not access camera or microphone.");
          }
        }
        setStream(mediaStream);
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
        buildBoostedStream(mediaStream, 6.0);

        setStatusText("Analyzing CV and generating questions...");
        const res = await fetch(`${API_BASE}/internal/interview/questions`, {
          method: "POST", headers: HEADERS(auth.token),
          body: JSON.stringify({ session_id: session.session_id }),
        });
        if (!res.ok) throw new Error("Failed to load interview questions");
        const data = await res.json();
        setQuestions(data.questions);
        setPhase("ready");
        setStatusText("Ready when you are.");
      } catch (err) {
        setError("Setup failed: " + err.message);
        setPhase("error");
      }
    }

    startMediaAndInterview();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => { });
        audioCtxRef.current = null;
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function speakQuestion(text) {
    setStatusText("AI is speaking...");
    setIsPlaying(true);
    setError("");
    if (recognitionRef.current) {
      recognitionRef.current._stop ? recognitionRef.current._stop() : (() => { try { recognitionRef.current.stop(); } catch (_) { } })();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    if (!('speechSynthesis' in window)) {
      setError("Speech synthesis not supported. Please use Chrome.");
      setIsPlaying(false);
      return;
    }
    window.speechSynthesis.cancel();
    await new Promise(resolve => setTimeout(resolve, 150));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.onend = () => { setIsPlaying(false); setStatusText("Listening for your answer..."); };
    utterance.onerror = (speechErr) => {
      if (speechErr.error === "interrupted") return;
      setError("Speech error: " + speechErr.error);
      setIsPlaying(false);
    };
    window.speechSynthesis.speak(utterance);
  }

const getBestAudioMimeType = () => {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  return "";
};

const startBrowserRecognition = () => {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRec) {
    console.warn("Browser speech recognition not supported.");
    return;
  }

  try {
    let finalTranscript = "";

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += text + " ";
        } else {
          interimTranscript += text;
        }
      }

      const combined = (finalTranscript + interimTranscript).trim();

      if (combined) {
        transcriptRef.current = combined;
        setTranscript(combined);
      }
    };

    recognition.onerror = (e) => {
      console.warn("Browser STT error:", e.error);
    };

    recognition.onend = () => {
      // Do not restart here. MediaRecorder is the backup.
    };

    recognition.start();
    recognitionRef.current = recognition;
  } catch (err) {
    console.warn("Could not start browser recognition:", err);
  }
};


const toggleRecording = async () => {
  if (isRecording) {
    setStatusText("Stopping recording...");
    setIsRecording(false);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    return;
  }

  try {
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    let recordStream = gainedStreamRef.current;

    if (!recordStream || recordStream.getAudioTracks().length === 0) {
      recordStream = stream;
    }

    if (!recordStream || recordStream.getAudioTracks().length === 0) {
      setError("Microphone stream is not ready. Exit live interview and start again.");
      return;
    }

    if (!window.MediaRecorder) {
      setError("MediaRecorder is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    audioChunksRef.current = [];
    transcriptRef.current = "";
    setTranscript("");
    setManualAnswer("");
    setShowManualFallback(false);
    setError("");
    setStatusText("Recording... speak normally.");

    // Browser transcript starts immediately.
    startBrowserRecognition();

    const mimeType = getBestAudioMimeType();

    const recorder = new MediaRecorder(
      recordStream,
      mimeType ? { mimeType } : undefined
    );

    mediaRecorderRef.current = recorder;

    recorder.onstart = () => {
      console.log("Recording started");
      setStatusText("Recording... speak normally.");
    };

    recorder.ondataavailable = (event) => {
      console.log("Audio chunk:", event.data.size);

      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error("Recorder error:", event);
      setError("Recording failed. Please try again.");
      setIsRecording(false);
      setStatusText("Recording failed.");
    };

    recorder.onstop = async () => {
      try {
        const browserText = transcriptRef.current.trim();

        // FAST PATH: if browser captured anything, submit instantly.
        if (browserText.length >= 2) {
          setStatusText("Answer captured. Evaluating...");
          await submitAnswerWithText(browserText);
          return;
        }

        // BACKUP PATH: use Hugging Face only if browser STT failed.
        setStatusText("Browser did not catch speech. Trying backup transcription...");

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType || "audio/webm"
        });

        console.log("Final audio blob size:", audioBlob.size);

        if (audioBlob.size < 3000) {
          setError("Recording was too short or empty. You can type your answer below.");
          setShowManualFallback(true);
          setStatusText("Type your answer manually.");
          return;
        }

        const formData = new FormData();
        formData.append("audio", audioBlob, `answer-${Date.now()}.webm`);

        const controller = new AbortController();

        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 90000);

        const res = await fetch(`${API_BASE}/internal/interview/transcribe`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "ngrok-skip-browser-warning": "true",
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || "Transcription failed.");
        }

        const text = (data.text || "").trim();

        if (!text) {
          setError("No speech detected. You can type your answer below.");
          setShowManualFallback(true);
          setStatusText("Type your answer manually.");
          return;
        }

        transcriptRef.current = text;
        setTranscript(text);
        setStatusText("Answer captured. Evaluating...");

        await submitAnswerWithText(text);

      } catch (err) {
        console.error("Transcription error:", err);

        setError("Automatic transcription failed. Type your answer below and submit it.");
        setManualAnswer(transcriptRef.current || "");
        setShowManualFallback(true);
        setStatusText("Type your answer manually.");
      }
    };

    recorder.start(1000);
    setIsRecording(true);

  } catch (err) {
    console.error("Recording start error:", err);
    setError("Could not start recording. Please check microphone permissions.");
    setStatusText("Could not start recording.");
    setIsRecording(false);
  }
};
  


  async function submitAnswerWithText(text) {
    if (!text || !text.trim()) {
      setError("No speech detected. Please speak before submitting.");
      return;
    }
    setPhase("evaluating"); setError("");
    try {
      const q = questions[currentQIndex];
      const res = await fetch(`${API_BASE}/internal/interview/evaluate`, {
        method: "POST", headers: HEADERS(auth.token),
        body: JSON.stringify({
          session_id: session.session_id,
          question: q.question,
          question_type: q.type,
          expected_skills: ensureArray(q.expected_skills),
          user_answer: text.trim()
        }),
      });
      if (!res.ok) throw new Error("Evaluation failed.");
      const data = await res.json();
      setEvaluation(data);
      setAllResults(prev => [...prev, { question: q, answer: text.trim(), evaluation: data }]);
      setPhase("result");
    } catch (ex) { setError(ex.message); setPhase("speaking"); }
  }

  function nextQuestion() {
    if (currentQIndex + 1 >= questions.length) setPhase("done");
    else {
      const nextIdx = currentQIndex + 1;
      transcriptRef.current = "";
      setCurrentQIndex(nextIdx); setTranscript(""); setEvaluation(null); setPhase("speaking");
      speakQuestion(questions[nextIdx].question);
    }
  }

  const q = questions[currentQIndex];
  const overallScore = allResults.length
    ? Math.round(allResults.reduce((s, r) => s + (r.evaluation?.score || 0), 0) / allResults.length * 10) / 10
    : null;

  const progress = questions.length > 0
    ? ((phase === "result" ? currentQIndex + 1 : currentQIndex) / questions.length) * 100
    : 0;

  // ── Loading / evaluating ─────────────────────────────────────────
  if (phase === "loading" || phase === "evaluating") return (
    <div className="liv-shell">
      <div className="liv-center">
        <div className="liv-spinner" />
        <p className="liv-spinner-label">
          {phase === "loading" ? "Setting up your live session…" : "Evaluating your response…"}
        </p>
      </div>
    </div>
  );

  // ── Error (no questions loaded) ──────────────────────────────────
  if (phase === "error" && questions.length === 0) return (
    <div className="liv-shell">
      <div className="liv-center">
        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Setup failed</div>
        <p style={{ fontSize: "0.9rem", color: "#64748b", maxWidth: 360 }}>{error}</p>
        <button className="ghost-btn" style={{ marginTop: 16 }} onClick={onBack}>← Go back</button>
      </div>
    </div>
  );

  // ── Done / summary ───────────────────────────────────────────────
  if (phase === "done") return (
    <div className="liv-shell" style={{ overflowY: "auto", padding: "40px 20px" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", width: "100%" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", padding: "24px", background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", margin: "0 0 4px 0", color: "#0f172a" }}>Interview Complete 🎉</h2>
            <p style={{ margin: 0, color: "#64748b" }}>{allResults.length} questions answered</p>
          </div>
          {overallScore !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>Overall</div>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>Average Score</div>
              </div>
              <ScoreRing score={overallScore} size={64} />
            </div>
          )}
        </div>

        {/* Mapped Summary Results */}
        {allResults.map((r, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", marginBottom: "24px", boxShadow: "0 2px 10px rgba(0,0,0,0.02)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid #f1f5f9" }}>
              <div>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Q{i + 1} · {r.question?.type}
                </span>
                <h3 style={{ margin: "8px 0 0 0", fontSize: "1.1rem", fontWeight: 600, color: "#0f172a", lineHeight: 1.4 }}>
                  {r.question?.question}
                </h3>
              </div>
              <ScoreRing score={r.evaluation?.score || 0} size={54} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "24px" }}>
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "20px" }}>
                <h5 style={{ margin: "0 0 12px 0", fontSize: "0.85rem", fontWeight: 700, color: "#166534", textTransform: "uppercase" }}>Strengths</h5>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {ensureArray(r.evaluation?.strengths).map((s, j) => (
                    <li key={j} style={{ fontSize: "0.9rem", color: "#15803d", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                      <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span> <span>{cleanText(s)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", padding: "20px" }}>
                <h5 style={{ margin: "0 0 12px 0", fontSize: "0.85rem", fontWeight: 700, color: "#b45309", textTransform: "uppercase" }}>Areas to Improve</h5>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {ensureArray(r.evaluation?.weaknesses).map((w, j) => (
                    <li key={j} style={{ fontSize: "0.9rem", color: "#b45309", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                      <span style={{ color: "#f59e0b", flexShrink: 0 }}>△</span> <span>{cleanText(w)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "16px" }}>
              <strong style={{ fontSize: "0.8rem", color: "#64748b", display: "block", marginBottom: "4px" }}>🎤 Your Transcript:</strong>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#334155", fontStyle: "italic", lineHeight: 1.5 }}>"{r.answer}"</p>
            </div>

            {r.evaluation?.ideal_answer_direction && (
              <div style={{ background: "#eef2ff", padding: "16px", borderRadius: "8px", border: "1px solid #c7d2fe" }}>
                <strong style={{ fontSize: "0.8rem", color: "#4338ca", display: "block", marginBottom: "4px" }}>💡 Ideal Direction:</strong>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "#3730a3", lineHeight: 1.5 }}>{cleanText(r.evaluation.ideal_answer_direction)}</p>
              </div>
            )}
          </div>
        ))}

        <button onClick={onBack} style={{ width: "100%", background: "#0f172a", color: "white", border: "none", padding: "16px", borderRadius: "12px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", transition: "background 0.2s", marginBottom: "40px" }}>
          ← Back to Analysis
        </button>
      </div>
    </div>
  );

  // ── Main interview view ──────────────────────────────────────────
  return (
    <div className="liv-shell">
      {/* Topbar */}
      <div className="liv-topbar">
        <button className="ghost-btn" onClick={onBack}>← Exit</button>
        <div className="liv-progress-track">
          <div className="liv-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="liv-badge">Q {currentQIndex + 1} / {questions.length}</span>
        {q?.type && <span className="liv-badge" style={{ textTransform: "capitalize" }}>{q.type}</span>}
        <span className="liv-badge live"><span className="live-dot" /> Live</span>
      </div>

      <div className="liv-body">
        <div className="liv-container">

          {error && <div className="liv-notice">⚠ {error}</div>}

          {/* Core Video/Question Panels */}
          <div className="liv-panels">
            <div className="liv-q-panel">
              <div className={`liv-ai-avatar${isPlaying ? " speaking" : ""}`}>{isPlaying ? "🗣" : "🎙"}</div>
              <div className="liv-status-label">{statusText}</div>
              {questions.length > 0 && phase !== "ready" && (
                <p className="liv-q-text">"{q?.question}"</p>
              )}
              {ensureArray(q?.expected_skills).length > 0 && phase !== "ready" && (
                <div className="liv-skill-chips">
                  {ensureArray(q.expected_skills).map((s, i) => <span key={i} className="liv-skill-chip">{s}</span>)}
                </div>
              )}
            </div>

            <div className="liv-video-panel">
              <video ref={videoRef} autoPlay muted playsInline />
              <div className="liv-video-meta">
                <span className="liv-cam-label">You</span>
                {isRecording && (
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--danger)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="live-dot" /> REC
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Blocks based on Phase */}
          {phase === "ready" && (
            <div className="liv-action-card">
              <div className="liv-action-title">Ready to begin</div>
              <div className="liv-action-sub">Ensure your volume is turned up. The AI will speak the first question once you start.</div>
              <button className="liv-rec-btn start" onClick={() => { setPhase("speaking"); speakQuestion(questions[0].question); }}>
                Start Interview →
              </button>
            </div>
          )}

          {phase === "speaking" && (
            <div className="liv-action-card">
              <div className="liv-action-title">{isRecording ? "Listening…" : "Your turn"}</div>
              <div className="liv-action-sub">
                {isRecording ? "Speak normally. Click stop when finished." : "Click the button below to record your answer."}
              </div>
              <button className={`liv-rec-btn ${isRecording ? "stop" : "start"}`} onClick={toggleRecording}>
                {isRecording ? "● Stop & submit" : "Start speaking"}
              </button>
              {isRecording && (
                <div className="liv-transcript">
                  <span className="liv-transcript-label">Recording</span>
                  Speak normally. Transcript may appear while speaking. If voice fails, you can type your answer.
                </div>
              )}

              {transcript && (
                <div className="liv-transcript">
                  <span className="liv-transcript-label">Transcript</span>
                  "{transcript}"
                </div>
              )}
              {showManualFallback && (
  <div className="liv-transcript">
    <span className="liv-transcript-label">Manual answer</span>

    <textarea
      value={manualAnswer}
      onChange={(e) => setManualAnswer(e.target.value)}
      placeholder="Type your answer here if voice transcription failed..."
      style={{
        width: "100%",
        minHeight: "110px",
        marginTop: "10px",
        padding: "12px",
        borderRadius: "10px",
        border: "1px solid #d1d5db",
        fontFamily: "inherit",
        fontSize: "0.9rem",
        resize: "vertical"
      }}
    />

    <button
      className="liv-rec-btn start"
      style={{ marginTop: "12px" }}
      onClick={() => submitAnswerWithText(manualAnswer)}
      disabled={!manualAnswer.trim()}
    >
      Submit typed answer
    </button>
  </div>
)}
            </div>
          )}

          {/* THE NEW PREMIUM EVALUATION CARD */}
          {phase === "result" && evaluation && (
            <div style={{ animation: "fadeIn 0.4s ease-out", width: "100%", maxWidth: "900px", margin: "0 auto" }}>
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.04)", marginBottom: "24px" }}>

                {/* Header */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "24px", padding: "24px 32px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <ScoreRing score={evaluation?.score || 0} size={64} />
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                        Answer Score
                      </div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        {evaluation?.score || 0} <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>/ 10</span>
                      </div>
                    </div>
                  </div>

                  {ensureArray(evaluation?.missing_keywords).length > 0 && (
                    <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", alignSelf: "center", marginRight: "4px" }}>Missing Skills:</span>
                      {ensureArray(evaluation.missing_keywords).map((k, i) => (
                        <span key={i} style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", padding: "4px 10px", borderRadius: "99px", fontSize: "0.75rem", fontWeight: 600 }}>
                          {cleanText(k)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div style={{ padding: "32px" }}>
                  <div style={{ marginBottom: "28px" }}>
                    <h4 style={{ margin: "0 0 8px 0", fontSize: "1rem", fontWeight: 600, color: "#0f172a" }}>Detailed Feedback</h4>
                    <p style={{ margin: 0, fontSize: "0.95rem", color: "#475569", lineHeight: 1.6 }}>
                      {cleanText(evaluation?.detailed_feedback)}
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "28px" }}>
                    {ensureArray(evaluation?.strengths).length > 0 && (
                      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "20px" }}>
                        <h5 style={{ margin: "0 0 12px 0", fontSize: "0.85rem", fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>Strengths</h5>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                          {ensureArray(evaluation.strengths).map((s, i) => (
                            <li key={i} style={{ fontSize: "0.9rem", color: "#15803d", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: "8px" }}>
                              <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span>
                              <span>{cleanText(s)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ensureArray(evaluation?.weaknesses).length > 0 && (
                      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", padding: "20px" }}>
                        <h5 style={{ margin: "0 0 12px 0", fontSize: "0.85rem", fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.05em" }}>Areas to Improve</h5>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                          {ensureArray(evaluation.weaknesses).map((w, i) => (
                            <li key={i} style={{ fontSize: "0.9rem", color: "#b45309", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: "8px" }}>
                              <span style={{ color: "#f59e0b", flexShrink: 0 }}>△</span>
                              <span>{cleanText(w)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {evaluation?.ideal_answer_direction && (
                    <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "12px", padding: "20px" }}>
                      <h5 style={{ margin: "0 0 8px 0", fontSize: "0.85rem", fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>💡</span> Ideal Direction
                      </h5>
                      <p style={{ margin: 0, fontSize: "0.95rem", color: "#3730a3", lineHeight: 1.5 }}>
                        {cleanText(evaluation.ideal_answer_direction)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={nextQuestion}
                style={{ width: "100%", background: "#0f172a", color: "white", border: "none", padding: "16px", borderRadius: "12px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", transition: "background 0.2s", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                onMouseOver={(e) => e.target.style.background = "#1e293b"}
                onMouseOut={(e) => e.target.style.background = "#0f172a"}
              >
                {currentQIndex + 1 >= questions.length ? "View Final Summary →" : "Next Question →"}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}