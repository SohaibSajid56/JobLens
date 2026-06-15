import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { HEADERS } from "./lib/api";

// ── Score ring ───────────────────────────────────────────────────
function ScoreRing({ score, size = 64 }) {
  const safeScore = Number(score || 0);
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (safeScore / 10) * circ;
  const color = safeScore >= 8 ? "#10b981" : safeScore >= 6 ? "#f59e0b" : "#ef4444";
  const trackColor = "#e2e8f0";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth="5" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.7s ease" }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        style={{
          fontSize: size * 0.28 + "px",
          fontWeight: 800,
          fill: color,
          fontFamily: "inherit",
        }}
      >
        {safeScore}
      </text>
    </svg>
  );
}

const ensureArray = (data) => {
  if (Array.isArray(data)) return data;
  if (typeof data === "string") return data.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const cleanText = (text) => {
  if (!text) return "";
  const str = String(text);
  if (str.includes("AI evaluation could not parse")) {
    return "The AI experienced a parsing error while evaluating this specific point. Please refer to the overall feedback.";
  }
  if (str.includes('{"score"')) {
    return "Evaluation detail parsing failed.";
  }
  return str;
};

const FEMALE_VOICE_HINTS = [
  /zira/i,
  /samantha/i,
  /aria/i,
  /jenny/i,
  /female/i,
  /susan/i,
  /karen/i,
  /natasha/i,
];

const MALE_VOICE_HINTS = [
  /david/i,
  /daniel/i,
  /guy/i,
  /male/i,
  /mark/i,
  /george/i,
  /alex/i,
  /ryan/i,
];

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

function pickRandomItem(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function pickInterviewVoice(voices) {
  const englishVoices = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
  const pool = englishVoices.length ? englishVoices : voices;

  const femaleVoices = pool.filter((v) =>
    FEMALE_VOICE_HINTS.some((pattern) => pattern.test(v.name))
  );

  const maleVoices = pool.filter((v) =>
    MALE_VOICE_HINTS.some((pattern) => pattern.test(v.name))
  );

  const selectedBucket = Math.random() < 0.5 ? femaleVoices : maleVoices;

  return (
    pickRandomItem(selectedBucket) ||
    pickRandomItem(femaleVoices) ||
    pickRandomItem(maleVoices) ||
    pickRandomItem(pool)
  );
}

function getBlendScore(result, name) {
  const categories = result?.faceBlendshapes?.[0]?.categories || [];
  const item = categories.find((c) => c.categoryName === name);
  return item?.score || 0;
}

function countFillerWords(text) {
  const matches = String(text || "")
    .toLowerCase()
    .match(/\b(um|uh|umm|uhh|like|you know|basically|actually)\b/g);

  return matches ? matches.length : 0;
}

function round1(num) {
  return Math.round(Number(num || 0) * 10) / 10;
}

function DeliveryStatsStrip({ stats }) {
  if (!stats) return null;

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "12px 14px",
        borderRadius: "12px",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        fontSize: "0.85rem",
        color: "#475569",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
      }}
    >
      <span>⏱ Response: <strong>{stats.response_time_seconds}s</strong></span>
      <span>👁 Eye contact: <strong>{stats.eye_contact_percent}%</strong></span>
      <span>🗣 Fillers: <strong>{stats.filler_words}</strong></span>
      <span>⏸ Pauses: <strong>{stats.pause_count}</strong></span>
      <span>📌 Signal: <strong>{stats.live_signal_label}</strong></span>
    </div>
  );
}

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
  const [evaluation, setEvaluation] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const [liveSignal, setLiveSignal] = useState("Camera signal initializing...");
  const [deliveryStats, setDeliveryStats] = useState(null);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const audioCtxRef = useRef(null);
  const gainedStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const selectedVoiceRef = useRef(null);
  const voicesLoadedRef = useRef(false);

  const faceLandmarkerRef = useRef(null);
  const faceRafRef = useRef(null);
  const lastFaceRunAtRef = useRef(0);

  const isRecordingRef = useRef(false);
  const aiQuestionEndedAtRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const lastSpeechUpdateAtRef = useRef(null);

  const answerMetricsRef = useRef(null);
  const visualStatsRef = useRef({
    frames: 0,
    eyeContact: 0,
    lookingAway: 0,
    noFace: 0,
    tense: 0,
    smile: 0,
  });

  const q = questions[currentQIndex];

  const overallScore = allResults.length
    ? Math.round(
      (allResults.reduce((sum, result) => sum + (result.evaluation?.score || 0), 0) /
        allResults.length) *
      10
    ) / 10
    : null;

  const progress = questions.length > 0
    ? ((phase === "result" ? currentQIndex + 1 : currentQIndex) / questions.length) * 100
    : 0;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, phase]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return undefined;

    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0 && !voicesLoadedRef.current) {
        selectedVoiceRef.current = pickInterviewVoice(voices);
        voicesLoadedRef.current = true;
        console.log("Selected interview voice:", selectedVoiceRef.current?.name);
      }
    }

    loadVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", loadVoices);
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  function buildBoostedStream(rawStream, gainValue = 6.0) {
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
    } catch (err) {
      console.warn("AudioContext boost failed, using raw stream:", err);
      return rawStream;
    }
  }

  async function setupFaceLandmarker(mediaStream) {
    const hasVideo = mediaStream?.getVideoTracks?.().length > 0;
    if (!hasVideo) {
      setLiveSignal("Audio-only mode");
      return;
    }

    if (faceLandmarkerRef.current) return;

    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      faceLandmarkerRef.current = faceLandmarker;
      startFaceAnalysisLoop();
    } catch (err) {
      console.warn("FaceLandmarker setup failed:", err);
      setLiveSignal("Face analysis unavailable");
    }
  }

  function processFaceResult(result) {
    const stats = visualStatsRef.current;
    stats.frames += 1;

    const face = result?.faceLandmarks?.[0];
    if (!face) {
      stats.noFace += 1;
      setLiveSignal("Face not visible");
      return;
    }

    const nose = face[1] || face[4] || face[0];
    const lookingAtCamera =
      nose && nose.x > 0.34 && nose.x < 0.66 && nose.y > 0.22 && nose.y < 0.76;

    if (lookingAtCamera) {
      stats.eyeContact += 1;
    } else {
      stats.lookingAway += 1;
    }

    const smile =
      (getBlendScore(result, "mouthSmileLeft") + getBlendScore(result, "mouthSmileRight")) / 2;

    const tension =
      (getBlendScore(result, "browDownLeft") +
        getBlendScore(result, "browDownRight") +
        getBlendScore(result, "browInnerUp")) /
      3;

    if (smile > 0.25) stats.smile += 1;
    if (tension > 0.35) stats.tense += 1;

    const now = Date.now();
    const longPause =
      isRecordingRef.current &&
      lastSpeechUpdateAtRef.current &&
      now - lastSpeechUpdateAtRef.current > 2500;

    if (longPause) setLiveSignal("Long pause...");
    else if (!lookingAtCamera) setLiveSignal("Looking away");
    else if (tension > 0.35) setLiveSignal("Some tension");
    else setLiveSignal("Engaged");
  }

  function startFaceAnalysisLoop() {
    if (faceRafRef.current) cancelAnimationFrame(faceRafRef.current);

    const run = () => {
      const video = videoRef.current;
      const landmarker = faceLandmarkerRef.current;
      const now = performance.now();

      if (video && landmarker && video.readyState >= 2 && now - lastFaceRunAtRef.current > 300) {
        lastFaceRunAtRef.current = now;
        try {
          const result = landmarker.detectForVideo(video, now);
          processFaceResult(result);
        } catch (err) {
          console.warn("Face analysis frame failed:", err);
        }
      }

      faceRafRef.current = requestAnimationFrame(run);
    };

    faceRafRef.current = requestAnimationFrame(run);
  }

  function stopRecognition() {
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    } catch (_) {
      // Ignore browser speech-recognition stop errors.
    }

    recognitionRef.current = null;
  }

  useEffect(() => {
    if (initializedRef.current) return undefined;
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
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: audioConstraints,
          });
        } catch (camErr) {
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: audioConstraints,
            });
            setError("Camera access blocked. Running in audio-only mode.");
          } catch (micErr) {
            throw new Error("Could not access camera or microphone.");
          }
        }

        setStream(mediaStream);
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
        buildBoostedStream(mediaStream, 6.0);
        setupFaceLandmarker(mediaStream);

        setStatusText("Analyzing CV and generating questions...");
        const res = await fetch(`${API_BASE}/internal/interview/questions`, {
          method: "POST",
          headers: HEADERS(auth.token),
          body: JSON.stringify({ session_id: session.session_id }),
        });

        if (!res.ok) throw new Error("Failed to load interview questions");

        const data = await res.json();
        setQuestions(data.questions || []);
        setPhase("ready");
        setStatusText("Ready when you are.");
      } catch (err) {
        setError("Setup failed: " + err.message);
        setPhase("error");
      }
    }

    startMediaAndInterview();

    return () => {
      stopRecognition();

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch (_) {
          // Ignore recorder cleanup errors.
        }
      }

      if (faceRafRef.current) {
        cancelAnimationFrame(faceRafRef.current);
        faceRafRef.current = null;
      }

      if (faceLandmarkerRef.current) {
        try {
          faceLandmarkerRef.current.close();
        } catch (_) {
          // Ignore model cleanup errors.
        }
        faceLandmarkerRef.current = null;
      }

      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }

      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => { });
        audioCtxRef.current = null;
      }

      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function speakQuestion(text) {
    if (!text) return;

    setStatusText("AI is speaking...");
    setIsPlaying(true);
    setError("");
    stopRecognition();
    setIsRecording(false);

    if (!("speechSynthesis" in window)) {
      setError("Speech synthesis not supported. Please use Chrome.");
      setIsPlaying(false);
      return;
    }

    window.speechSynthesis.cancel();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoiceRef.current) utterance.voice = selectedVoiceRef.current;
    utterance.lang = "en-US";
    utterance.rate = 0.95;

    utterance.onend = () => {
      aiQuestionEndedAtRef.current = Date.now();
      setIsPlaying(false);
      setStatusText("Listening for your answer...");
    };

    utterance.onerror = (speechErr) => {
      if (speechErr.error === "interrupted") return;
      setError("Speech error: " + speechErr.error);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  }

  function getBestAudioMimeType() {
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
  }

  function startBrowserRecognition() {
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

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const spokenText = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            finalTranscript += spokenText + " ";
          } else {
            interimTranscript += spokenText;
          }
        }

        const combined = (finalTranscript + interimTranscript).trim();

        if (combined) {
          noteSpeechActivity();
          transcriptRef.current = combined;
          setTranscript(combined);
        }
      };

      recognition.onerror = (e) => {
        console.warn("Browser STT error:", e.error);
      };

      recognition.onend = () => {
        // Do not auto-restart. MediaRecorder backup will handle failures.
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn("Could not start browser recognition:", err);
    }
  }

  function resetDeliveryTracking() {
    answerMetricsRef.current = {
      questionEndedAt: aiQuestionEndedAtRef.current,
      recordingStartedAt: Date.now(),
      firstSpeechAt: null,
      responseLatencyMs: null,
      pauseCount: 0,
      longestPauseMs: 0,
    };

    visualStatsRef.current = {
      frames: 0,
      eyeContact: 0,
      lookingAway: 0,
      noFace: 0,
      tense: 0,
      smile: 0,
    };

    lastSpeechUpdateAtRef.current = Date.now();
    recordingStartedAtRef.current = Date.now();
    setDeliveryStats(null);
  }

  function noteSpeechActivity() {
    const now = Date.now();
    const metrics = answerMetricsRef.current;
    if (!metrics) return;

    if (!metrics.firstSpeechAt) {
      metrics.firstSpeechAt = now;
      metrics.responseLatencyMs = metrics.questionEndedAt
        ? now - metrics.questionEndedAt
        : now - metrics.recordingStartedAt;
    }

    if (lastSpeechUpdateAtRef.current) {
      const gap = now - lastSpeechUpdateAtRef.current;
      if (gap > 1800) {
        metrics.pauseCount += 1;
        metrics.longestPauseMs = Math.max(metrics.longestPauseMs, gap);
      }
    }

    lastSpeechUpdateAtRef.current = now;
  }

  function finalizeDeliveryStats(answerText) {
    const metrics = answerMetricsRef.current || {};
    const visual = visualStatsRef.current || {};

    const frames = visual.frames || 0;
    const validFaceFrames = Math.max(1, frames - (visual.noFace || 0));
    const eyeContactPercent = Math.round(((visual.eyeContact || 0) / validFaceFrames) * 100);
    const lookingAwayPercent = Math.round(((visual.lookingAway || 0) / validFaceFrames) * 100);
    const tensionPercent = Math.round(((visual.tense || 0) / validFaceFrames) * 100);
    const smilePercent = Math.round(((visual.smile || 0) / validFaceFrames) * 100);

    const responseMs =
      metrics.responseLatencyMs ??
      (recordingStartedAtRef.current && aiQuestionEndedAtRef.current
        ? recordingStartedAtRef.current - aiQuestionEndedAtRef.current
        : 0);

    let label = "Engaged";
    if (frames > 0 && (visual.noFace || 0) > frames * 0.45) label = "Face not consistently visible";
    else if (eyeContactPercent < 45) label = "Often looking away";
    else if ((metrics.longestPauseMs || 0) > 3500) label = "Long pauses detected";
    else if (tensionPercent > 45) label = "Some tension detected";

    return {
      response_time_seconds: round1(Math.max(0, responseMs) / 1000),
      eye_contact_percent: Math.max(0, Math.min(100, eyeContactPercent)),
      looking_away_percent: Math.max(0, Math.min(100, lookingAwayPercent)),
      tension_percent: Math.max(0, Math.min(100, tensionPercent)),
      smile_percent: Math.max(0, Math.min(100, smilePercent)),
      pause_count: metrics.pauseCount || 0,
      longest_pause_seconds: round1((metrics.longestPauseMs || 0) / 1000),
      filler_words: countFillerWords(answerText),
      live_signal_label: label,
    };
  }

  async function toggleRecording() {
    if (isRecording) {
      setStatusText("Stopping recording...");
      setIsRecording(false);
      stopRecognition();

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
      if (!recordStream || recordStream.getAudioTracks().length === 0) recordStream = stream;

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
      resetDeliveryTracking();
      startBrowserRecognition();

      const mimeType = getBestAudioMimeType();
      const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        console.log("Recording started");
        setStatusText("Recording... speak normally.");
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log("Audio chunk:", event.data.size);
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

          if (browserText.length >= 2) {
            setStatusText("Answer captured. Evaluating...");
            const stats = finalizeDeliveryStats(browserText);
            setDeliveryStats(stats);
            await submitAnswerWithText(browserText, stats);
            return;
          }

          setStatusText("Browser did not catch speech. Trying backup transcription...");

          const audioBlob = new Blob(audioChunksRef.current, {
            type: mimeType || "audio/webm",
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
          const timeoutId = setTimeout(() => controller.abort(), 90000);

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

          if (!res.ok) throw new Error(data.detail || "Transcription failed.");

          const backupText = (data.text || "").trim();

          if (!backupText) {
            setError("No speech detected. You can type your answer below.");
            setShowManualFallback(true);
            setStatusText("Type your answer manually.");
            return;
          }

          transcriptRef.current = backupText;
          setTranscript(backupText);
          setStatusText("Answer captured. Evaluating...");

          const stats = finalizeDeliveryStats(backupText);
          setDeliveryStats(stats);
          await submitAnswerWithText(backupText, stats);
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
  }

  async function submitAnswerWithText(answerText, statsOverride = null) {
    const cleanedAnswer = String(answerText || "").trim();

    if (!cleanedAnswer) {
      setError("No speech detected. Please speak before submitting.");
      return;
    }

    const delivery = statsOverride || finalizeDeliveryStats(cleanedAnswer);
    setDeliveryStats(delivery);
    setPhase("evaluating");
    setError("");

    try {
      const currentQuestion = questions[currentQIndex];
      const res = await fetch(`${API_BASE}/internal/interview/evaluate`, {
        method: "POST",
        headers: HEADERS(auth.token),
        body: JSON.stringify({
          session_id: session.session_id,
          question: currentQuestion.question,
          question_type: currentQuestion.type,
          expected_skills: ensureArray(currentQuestion.expected_skills),
          user_answer: cleanedAnswer,
          delivery_stats: delivery,
        }),
      });

      if (!res.ok) throw new Error("Evaluation failed.");

      const data = await res.json();
      setEvaluation(data);
      setAllResults((prev) => [
        ...prev,
        {
          question: currentQuestion,
          answer: cleanedAnswer,
          evaluation: data,
          deliveryStats: delivery,
        },
      ]);
      setPhase("result");
    } catch (ex) {
      setError(ex.message);
      setPhase("speaking");
    }
  }

  function nextQuestion() {
    if (currentQIndex + 1 >= questions.length) {
      setPhase("done");
      return;
    }

    const nextIdx = currentQIndex + 1;
    transcriptRef.current = "";
    setCurrentQIndex(nextIdx);
    setTranscript("");
    setManualAnswer("");
    setShowManualFallback(false);
    setEvaluation(null);
    setDeliveryStats(null);
    setPhase("speaking");
    speakQuestion(questions[nextIdx].question);
  }

  if (phase === "loading" || phase === "evaluating") {
    return (
      <div className="liv-shell">
        <div className="liv-center">
          <div className="liv-spinner" />
          <p className="liv-spinner-label">
            {phase === "loading" ? "Setting up your live session…" : "Evaluating your response…"}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error" && questions.length === 0) {
    return (
      <div className="liv-shell">
        <div className="liv-center">
          <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
            Setup failed
          </div>
          <p style={{ fontSize: "0.9rem", color: "#64748b", maxWidth: 360 }}>{error}</p>
          <button className="ghost-btn" style={{ marginTop: 16 }} onClick={onBack}>
            ← Go back
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="liv-shell" style={{ overflowY: "auto", padding: "40px 20px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "32px",
              padding: "24px",
              background: "#fff",
              borderRadius: "16px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 6px rgba(0,0,0,0.02)",
            }}
          >
            <div>
              <h2 style={{ fontSize: "1.5rem", margin: "0 0 4px 0", color: "#0f172a" }}>
                Interview Complete 🎉
              </h2>
              <p style={{ margin: 0, color: "#64748b" }}>{allResults.length} questions answered</p>
            </div>

            {overallScore !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#64748b",
                    }}
                  >
                    Overall
                  </div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>
                    Average Score
                  </div>
                </div>
                <ScoreRing score={overallScore} size={64} />
              </div>
            )}
          </div>

          {allResults.map((result, index) => (
            <div
              key={index}
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "32px",
                marginBottom: "24px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "24px",
                  paddingBottom: "24px",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#3b82f6",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Q{index + 1} · {result.question?.type}
                  </span>
                  <h3
                    style={{
                      margin: "8px 0 0 0",
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      color: "#0f172a",
                      lineHeight: 1.4,
                    }}
                  >
                    {result.question?.question}
                  </h3>
                </div>
                <ScoreRing score={result.evaluation?.score || 0} size={54} />
              </div>

              <DeliveryStatsStrip stats={result.deliveryStats} />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "24px",
                  marginTop: "24px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "12px",
                    padding: "20px",
                  }}
                >
                  <h5
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      color: "#166534",
                      textTransform: "uppercase",
                    }}
                  >
                    Strengths
                  </h5>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {ensureArray(result.evaluation?.strengths).map((item, strengthIndex) => (
                      <li
                        key={strengthIndex}
                        style={{
                          fontSize: "0.9rem",
                          color: "#15803d",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "8px",
                        }}
                      >
                        <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span>
                        <span>{cleanText(item)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: "12px",
                    padding: "20px",
                  }}
                >
                  <h5
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      color: "#b45309",
                      textTransform: "uppercase",
                    }}
                  >
                    Areas to Improve
                  </h5>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {ensureArray(result.evaluation?.weaknesses).map((item, weaknessIndex) => (
                      <li
                        key={weaknessIndex}
                        style={{
                          fontSize: "0.9rem",
                          color: "#b45309",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "8px",
                        }}
                      >
                        <span style={{ color: "#f59e0b", flexShrink: 0 }}>△</span>
                        <span>{cleanText(item)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  marginBottom: "16px",
                }}
              >
                <strong
                  style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  🎤 Your Transcript:
                </strong>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.9rem",
                    color: "#334155",
                    fontStyle: "italic",
                    lineHeight: 1.5,
                  }}
                >
                  "{result.answer}"
                </p>
              </div>

              {result.evaluation?.ideal_answer_direction && (
                <div
                  style={{
                    background: "#eef2ff",
                    padding: "16px",
                    borderRadius: "8px",
                    border: "1px solid #c7d2fe",
                  }}
                >
                  <strong
                    style={{
                      fontSize: "0.8rem",
                      color: "#4338ca",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    💡 Ideal Direction:
                  </strong>
                  <p style={{ margin: 0, fontSize: "0.9rem", color: "#3730a3", lineHeight: 1.5 }}>
                    {cleanText(result.evaluation.ideal_answer_direction)}
                  </p>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={onBack}
            style={{
              width: "100%",
              background: "#0f172a",
              color: "white",
              border: "none",
              padding: "16px",
              borderRadius: "12px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
              marginBottom: "40px",
            }}
          >
            ← Back to Analysis
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="liv-shell">
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

          <div className="liv-panels">
            <div className="liv-q-panel">
              <div className={`liv-ai-avatar${isPlaying ? " speaking" : ""}`}>
                {isPlaying ? "🗣" : "🎙"}
              </div>
              <div className="liv-status-label">{statusText}</div>

              {questions.length > 0 && phase !== "ready" && (
                <p className="liv-q-text">"{q?.question}"</p>
              )}

              {ensureArray(q?.expected_skills).length > 0 && phase !== "ready" && (
                <div className="liv-skill-chips">
                  {ensureArray(q.expected_skills).map((skill, index) => (
                    <span key={index} className="liv-skill-chip">{skill}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="liv-video-panel">
              <video ref={videoRef} autoPlay muted playsInline />
              <div className="liv-video-meta">
                <span className="liv-cam-label">You</span>
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    color:
                      liveSignal === "Engaged"
                        ? "#16a34a"
                        : liveSignal.includes("pause") || liveSignal.includes("away")
                          ? "#f59e0b"
                          : "#64748b",
                  }}
                >
                  {liveSignal}
                </span>
                {isRecording && (
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: "var(--danger)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span className="live-dot" /> REC
                  </span>
                )}
              </div>
            </div>
          </div>

          {phase === "ready" && (
            <div className="liv-action-card">
              <div className="liv-action-title">Ready to begin</div>
              <div className="liv-action-sub">
                Ensure your volume is turned up. The AI will speak the first question once you start.
              </div>
              <button
                className="liv-rec-btn start"
                onClick={() => {
                  setPhase("speaking");
                  speakQuestion(questions[0]?.question);
                }}
                disabled={!questions.length}
              >
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

              <button
                className="ghost-btn"
                onClick={() => speakQuestion(q?.question)}
                disabled={isPlaying || isRecording || !q?.question}
                style={{ marginBottom: "12px" }}
              >
                ↻ Repeat question
              </button>

              <button className={`liv-rec-btn ${isRecording ? "stop" : "start"}`} onClick={toggleRecording} disabled={isPlaying}>
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
                      resize: "vertical",
                    }}
                  />

                  <button
                    className="liv-rec-btn start"
                    style={{ marginTop: "12px" }}
                    onClick={() => {
                      const stats = finalizeDeliveryStats(manualAnswer);
                      submitAnswerWithText(manualAnswer, stats);
                    }}
                    disabled={!manualAnswer.trim()}
                  >
                    Submit typed answer
                  </button>
                </div>
              )}
            </div>
          )}

          {phase === "result" && evaluation && (
            <div style={{ animation: "fadeIn 0.4s ease-out", width: "100%", maxWidth: "900px", margin: "0 auto" }}>
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "16px",
                  overflow: "hidden",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "24px",
                    padding: "24px 32px",
                    borderBottom: "1px solid #f1f5f9",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <ScoreRing score={evaluation?.score || 0} size={64} />
                    <div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          marginBottom: "4px",
                        }}
                      >
                        Answer Score
                      </div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        {evaluation?.score || 0} <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>/ 10</span>
                      </div>
                    </div>
                  </div>

                  {ensureArray(evaluation?.missing_keywords).length > 0 && (
                    <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "#64748b",
                          alignSelf: "center",
                          marginRight: "4px",
                        }}
                      >
                        Missing Skills:
                      </span>
                      {ensureArray(evaluation.missing_keywords).map((keyword, index) => (
                        <span
                          key={index}
                          style={{
                            background: "#fee2e2",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
                            padding: "4px 10px",
                            borderRadius: "99px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {cleanText(keyword)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ padding: "32px" }}>
                  <DeliveryStatsStrip stats={deliveryStats} />

                  <div style={{ marginTop: "28px", marginBottom: "28px" }}>
                    <h4 style={{ margin: "0 0 8px 0", fontSize: "1rem", fontWeight: 600, color: "#0f172a" }}>
                      Detailed Feedback
                    </h4>
                    <p style={{ margin: 0, fontSize: "0.95rem", color: "#475569", lineHeight: 1.6 }}>
                      {cleanText(evaluation?.detailed_feedback)}
                    </p>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "24px",
                      marginBottom: "28px",
                    }}
                  >
                    {ensureArray(evaluation?.strengths).length > 0 && (
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: "12px",
                          padding: "20px",
                        }}
                      >
                        <h5
                          style={{
                            margin: "0 0 12px 0",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            color: "#166534",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Strengths
                        </h5>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                          {ensureArray(evaluation.strengths).map((item, index) => (
                            <li
                              key={index}
                              style={{
                                fontSize: "0.9rem",
                                color: "#15803d",
                                lineHeight: 1.4,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "8px",
                              }}
                            >
                              <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span>
                              <span>{cleanText(item)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ensureArray(evaluation?.weaknesses).length > 0 && (
                      <div
                        style={{
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                          borderRadius: "12px",
                          padding: "20px",
                        }}
                      >
                        <h5
                          style={{
                            margin: "0 0 12px 0",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            color: "#b45309",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Areas to Improve
                        </h5>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
                          {ensureArray(evaluation.weaknesses).map((item, index) => (
                            <li
                              key={index}
                              style={{
                                fontSize: "0.9rem",
                                color: "#b45309",
                                lineHeight: 1.4,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "8px",
                              }}
                            >
                              <span style={{ color: "#f59e0b", flexShrink: 0 }}>△</span>
                              <span>{cleanText(item)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {evaluation?.ideal_answer_direction && (
                    <div
                      style={{
                        background: "#eef2ff",
                        border: "1px solid #c7d2fe",
                        borderRadius: "12px",
                        padding: "20px",
                      }}
                    >
                      <h5
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          color: "#4338ca",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
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
                style={{
                  width: "100%",
                  background: "#0f172a",
                  color: "white",
                  border: "none",
                  padding: "16px",
                  borderRadius: "12px",
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.2s",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = "#1e293b"; }}
                onMouseOut={(e) => { e.currentTarget.style.background = "#0f172a"; }}
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
