import { useEffect, useRef, useState } from "react";

const API_BASE = "https://arbitrary-negotiate-monotone.ngrok-free.dev"; 

const HEADERS = (token) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "ngrok-skip-browser-warning": "true",
});

export default function LiveInterviewScreen({ session, auth, onBack }) {
  const videoRef = useRef(null);
  const initializedRef = useRef(false); // <-- Guard against strict-mode double execution
  const [stream, setStream] = useState(null);
  const [error, setError] = useState("");
  
  const [statusText, setStatusText] = useState("Initializing camera...");
  const [questions, setQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // If already initialized by strict mode, block the second run
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function startMediaAndInterview() {
      try {
        // 1. Start Camera
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setStream(mediaStream);
        if (videoRef.current) videoRef.current.srcObject = mediaStream;

        // 2. Fetch questions
        setStatusText("Analyzing CV and generating questions...");
        const res = await fetch(`${API_BASE}/internal/interview/questions`, {
          method: "POST",
          headers: HEADERS(auth.token),
          body: JSON.stringify({ session_id: session.session_id }),
        });

        if (!res.ok) throw new Error("Failed to load interview questions");
        const data = await res.json();
        setQuestions(data.questions);

        // 3. Speak the first question
        if (data.questions.length > 0) {
          speakQuestion(data.questions[0].question);
        }

      } catch (err) {
        setError("Setup failed: " + err.message);
        console.error(err);
      }
    }
    
    startMediaAndInterview();

    // Cleanup tracks on screen exit
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function speakQuestion(text) {
    try {
      setStatusText("AI is speaking...");
      setIsPlaying(true);
      setError(""); // Clear any old error indicators
      
      const res = await fetch(`${API_BASE}/internal/interview/speak`, {
        method: "POST",
        headers: HEADERS(auth.token),
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Audio generation failed");
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setIsPlaying(false);
        setStatusText("Listening for your answer...");
      };

      await audio.play();
    } catch (err) {
      console.warn("HuggingFace TTS side-channeled, shifting to browser native engine:", err.message);
      
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        
        utterance.onend = () => {
          setIsPlaying(false);
          setStatusText("Listening for your answer...");
        };
        
        utterance.onerror = (speechErr) => {
          // Safely ignore strict-mode background interruptions
          if (speechErr.error === "interrupted") return; 
          setError("Audio execution failed: " + speechErr.error);
          setIsPlaying(false);
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setError("Audio stream initialization failed: " + err.message);
        setIsPlaying(false);
      }
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <button style={styles.ghostBtn} onClick={onBack}>← Exit Live Interview</button>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>Live AI Interview (Beta)</h2>
      </div>

      {error && (
        <div style={{ padding: "16px", background: "#fee2e2", color: "#dc2626", borderRadius: "8px", border: "1px solid #fca5a5", marginBottom: "20px" }}>
          <strong>⚠ Notice:</strong> {error}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", height: "100%", minHeight: "400px" }}>
        {/* Left Side: AI Interaction Area */}
        <div style={{ flex: "1 1 400px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
          <div style={{ 
            width: "80px", height: "80px", background: "#eef2ff", borderRadius: "50%", 
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", marginBottom: "20px",
            animation: isPlaying ? "pulse-blue 1.5s infinite" : "none",
            border: isPlaying ? "2px solid #4f46e5" : "2px solid transparent"
          }}>
            {isPlaying ? "🗣️" : "🎙️"}
          </div>
          
          <h3 style={{ color: "#1e293b", marginBottom: "8px", textAlign: "center" }}>{statusText}</h3>

          {questions.length > 0 && (
            <p style={{ color: "#475569", textAlign: "center", maxWidth: "400px", fontSize: "1rem", lineHeight: 1.6, marginTop: "16px", padding: "16px", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              "{questions[currentQIndex]?.question}"
            </p>
          )}
        </div>

        {/* Right Side: User Body Cam */}
        <div style={{ width: "320px", background: "#0f172a", borderRadius: "16px", overflow: "hidden", position: "relative", alignSelf: "flex-start", boxShadow: "0 10px 25px rgba(0,0,0,0.1)" }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "240px", objectFit: "cover", transform: "scaleX(-1)" }} />
          <div style={{ position: "absolute", bottom: "12px", left: "12px", background: "rgba(0,0,0,0.6)", color: "white", padding: "4px 10px", borderRadius: "99px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "8px", fontWeight: "600" }}>
            <div style={styles.recordingDot} /> LIVE
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes pulse-red {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes pulse-blue {
          0% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(79, 70, 229, 0); }
          100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  ghostBtn: { padding: "8px 16px", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", transition: "all 0.2s" },
  recordingDot: { width: "8px", height: "8px", background: "#ef4444", borderRadius: "50%", animation: "pulse-red 2s infinite" }
};