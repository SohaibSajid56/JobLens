// src/App.jsx
import { useState, useRef, useEffect } from "react";
import "./styles.css"; // 1. IMPORT THE NEW CSS FILE HERE
import AuthScreen from "./AuthScreen"; // 2. IMPORT THE AUTH COMPONENT
import InterviewScreen from "./InterviewScreen";

const API_BASE = "https://unshaven-crafty-dedicate.ngrok-free.dev";

// ─── Helpers ───
const pdfToBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("PDF read failed"));
    r.readAsDataURL(file);
  });

function matchClass(pct) {
  if (pct === null || pct === undefined) return "";
  if (pct >= 65) return "good";
  if (pct >= 40) return "ok";
  return "low";
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Main App ───
export default function App() {
  const [auth, setAuth] = useState(() => {
    const t = localStorage.getItem("jat_token");
    const u = localStorage.getItem("jat_user");
    return t && u ? { token: t, ...JSON.parse(u) } : null;
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cvFile, setCvFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [isInterviewMode, setIsInterviewMode] = useState(false);

  const [history, setHistory] = useState([]);
  const [activeHist, setActiveHist] = useState(null);

  const endRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "52px";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  useEffect(() => { if (auth) loadHistory(); }, [auth]);

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/history`, {
        headers: { Authorization: `Bearer ${auth.token}`, "ngrok-skip-browser-warning": "true" },
      });
      const data = await res.json();
      setHistory(data.sessions || []);
    } catch {}
  }

  function handleCvFile(file) {
    if (file?.type === "application/pdf") setCvFile(file);
    else if (file) alert("Please upload a PDF file.");
  }

  async function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    setErrMsg(""); setActiveHist(null);
    const userMsg = { role: "user", content: input };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const payload = {
        messages: updated.map(m => ({ role: m.role, content: m.content })),
        session_id: sessionId,
      };

      if (cvFile) {
        const b64 = await pdfToBase64(cvFile);
        payload.cv_pdf = { filename: cvFile.name, base64: b64 };
      }

      const res = await fetch(`${API_BASE}/api/analyze_job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }

      const data = await res.json();
      setSessionId(data.session_id);
      setMessages(prev => [...prev, { role: "assistant", content: data.response, match_pct: data.match_pct }]);
      loadHistory();
    } catch (ex) {
      setErrMsg(ex.message);
      setMessages(prev => prev.slice(0, -1));
      setInput(userMsg.content);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setMessages([]); setInput(""); setSessionId(null);
    setCvFile(null); setErrMsg(""); setActiveHist(null);
    setIsInterviewMode(false);
  }

  async function deleteSession(sid, e) {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/history/${sid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.token}`, "ngrok-skip-browser-warning": "true" },
    });
    loadHistory();
    if (sessionId === sid) startNew();
  }

  function openHistory(session) {
    setActiveHist(session);
    setMessages([]); setInput(""); setSessionId(session.session_id);
    setErrMsg(""); setIsInterviewMode(false);
  }

  function logout() {
    localStorage.removeItem("jat_token"); localStorage.removeItem("jat_user");
    setAuth(null);
  }

  if (!auth) return <AuthScreen onAuth={setAuth} />;

  return (
    <div className="shell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-logo">Job<em>Lens</em></div>
          <div className="sidebar-user">Signed in as <strong>{auth.username}</strong></div>
        </div>

        <button className="new-chat-btn" onClick={startNew}>＋ New Analysis</button>

        <div className="history-label">Recent Sessions</div>
        <div className="history-list">
          {history.length === 0 && <div style={{ fontSize: "0.75rem", color: "#64748b", padding: "8px 12px" }}>No sessions yet</div>}
          {history.map(s => (
            <div key={s.session_id} className={`hist-card ${activeHist?.session_id === s.session_id || sessionId === s.session_id ? "active" : ""}`} onClick={() => openHistory(s)}>
              <div className="hist-card-title">{s.turns[0]?.user?.slice(0, 58) || "Session"}</div>
              <div className="hist-card-meta">
                <span>{fmtDate(s.started)}</span>
                {s.match_pct !== null && s.match_pct !== undefined && (
                  <span className={`match-badge ${matchClass(s.match_pct)}`}>{s.match_pct}% match</span>
                )}
                {s.has_cv && <span>📄</span>}
              </div>
              <button className="hist-del" onClick={(e) => deleteSession(s.session_id, e)} title="Delete">✕</button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <button className="logout-btn" onClick={logout}>↩ Sign out</button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-title">
            {activeHist ? `Session — ${fmtDate(activeHist.started)}` : "New Analysis"}
            {((activeHist && activeHist.has_cv) || (cvFile && messages.length > 1)) && !isInterviewMode && (
              <button className="cv-drop has" style={{ padding: "6px 12px", fontSize: "0.7rem", borderRadius: "99px" }} onClick={() => setIsInterviewMode(true)}>
                🎙️ Start Mock Interview
              </button>
            )}
          </div>

          <div className="cv-zone">
            <div className={`cv-drop ${drag ? "drag" : ""} ${cvFile ? "has" : ""}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); handleCvFile(e.dataTransfer.files[0]); }}>
              <input type="file" accept="application/pdf" onChange={e => handleCvFile(e.target.files[0])} />
              <span>{cvFile ? "📄" : "🎯"}</span>
              <span>{cvFile ? cvFile.name.slice(0, 24) + (cvFile.name.length > 24 ? "…" : "") : "Upload CV (PDF)"}</span>
            </div>
            {cvFile && <button className="cv-rm" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }} onClick={() => setCvFile(null)} title="Remove CV">✕</button>}
          </div>
        </div>

        {errMsg && <div className="err-bar"><span>⚠</span><div><strong>Request failed</strong> — {errMsg}</div></div>}

        {/* CONTENT AREA */}
        {isInterviewMode && activeHist ? (
          <InterviewScreen session={activeHist} auth={auth} onBack={() => setIsInterviewMode(false)} />
        ) : (
          <>
            <div className="chat-body">
              {activeHist && messages.length === 0 ? (
                <div className="hist-turns" style={{ maxWidth: "1000px", margin: "0 auto" }}>
                  {activeHist.turns.map((t, i) => (
                    <div key={i} style={{ marginBottom: "24px" }}>
                      <div className="msg-row user">
                        <div className="bubble">
                          <div className="bubble-label">{auth.username}</div>
                          {t.user}
                        </div>
                      </div>
                      <div className="msg-row assistant">
                        <div className="bubble">
                          <div className="bubble-label">JobLens AI</div>
                          {t.ai}
                          {t.match_pct !== null && t.match_pct !== undefined && (
                            <div><span className={`match-pill ${matchClass(t.match_pct)}`}>{t.match_pct}% CV match</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                /* MODERN EMPTY STATE */
                <div className="empty" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
                  <div style={{ padding: "16px", background: "#eef2ff", borderRadius: "20px", color: "var(--primary)", marginBottom: "16px" }}>
                    <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 style={{ fontSize: "1.8rem", fontWeight: "700", color: "var(--text-main)", marginBottom: "8px" }}>Welcome to JobLens AI</h2>
                  <p style={{ color: "var(--text-muted)", fontSize: "1rem", textAlign: "center", maxWidth: "500px" }}>
                    Upload your CV and paste a job description to get a comprehensive gap analysis and start your personalized mock interview.
                  </p>

                  <div className="dash-grid">
                    <button className="dash-card" onClick={() => setInput("Paste a job description here...")}>
                      <span className="dash-icon">📄</span><span className="dash-title">Analyze Job Description</span><span className="dash-desc">Extract key skills and requirements from any job posting automatically.</span>
                    </button>
                    <button className="dash-card" onClick={() => document.querySelector('input[type="file"]').click()}>
                      <span className="dash-icon">🎯</span><span className="dash-title">Upload CV for Gap Analysis</span><span className="dash-desc">Match your resume against a job role to find missing skills and improvements.</span>
                    </button>
                    <button className="dash-card" onClick={() => setInput("Can you suggest some projects to improve my React skills?")}>
                      <span className="dash-icon">🎙️</span><span className="dash-title">AI Mock Interview</span><span className="dash-desc">Practice with dynamically generated questions based on your specific CV gaps.</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* MESSAGES */
                <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
                  {messages.map((m, i) => (
                    <div key={i} className={`msg-row ${m.role}`}>
                      <div className="bubble">
                        <div className="bubble-label">{m.role === "user" ? auth.full_name || auth.username : "JobLens AI"}</div>
                        {m.content}
                        {m.match_pct !== null && m.match_pct !== undefined && (
                          <div><span className={`match-pill ${matchClass(m.match_pct)}`}>{m.match_pct}% CV match</span></div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="msg-row assistant"><div className="bubble" style={{ padding: "16px 24px" }}>...</div></div>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* INPUT */}
            <div className="input-bar">
              <div className="input-row">
                <textarea
                  ref={taRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={activeHist && messages.length === 0 ? "Continue this session or start a new one…" : "Paste a job description or follow-up message…"}
                  disabled={loading}
                />
                <button className="send" onClick={handleSend} disabled={loading || !input.trim()}>{loading ? "…" : "Send ↑"}</button>
              </div>
              <div className="hint">
                <span>⏎ Send · Shift+⏎ New line</span>
                {cvFile && <span style={{ color: "var(--primary)", fontWeight: 500 }}>📄 CV attached — gap analysis enabled</span>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}