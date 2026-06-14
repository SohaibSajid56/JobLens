import { useState, useRef, useEffect } from "react";
import "./styles.css";
import AuthScreen from "./AuthScreen";
import InterviewScreen from "./InterviewScreen";
import JobsScreen from "./jobscreen";
import LiveInterviewScreen from "./LiveInterviewScreen";

import { API_BASE, HEADERS, AUTH_HEADERS } from "./lib/api";

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
  const [isLiveInterviewMode, setIsLiveInterviewMode] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeHist, setActiveHist] = useState(null);
  const [isJobsMode, setIsJobsMode] = useState(false);

  const endRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "44px";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 180) + "px";
    }
  }, [input]);

  useEffect(() => { if (auth) loadHistory(); }, [auth]);

  async function loadHistory() {
    try {
      const token = auth?.token || localStorage.getItem("jat_token");
      if (!token) return;
      const res = await fetch(`${API_BASE}/internal/history`, {
        method: "GET",
        headers: AUTH_HEADERS(token),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to load history");
      setHistory(data.sessions || []);
    } catch (error) {
      console.error("Load history error:", error);
      setHistory([]);
    }
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

      const res = await fetch(`${API_BASE}/internal/analyze_job`, {
        method: "POST",
        headers: HEADERS(auth.token),
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
    setErrMsg(""); setActiveHist(null);
    setIsInterviewMode(false); setIsJobsMode(false); setIsLiveInterviewMode(false);
  }

  async function deleteSession(sid, e) {
    e.stopPropagation();
    await fetch(`${API_BASE}/internal/history/${sid}`, {
      method: "DELETE",
      headers: AUTH_HEADERS(auth.token),
    });
    loadHistory();
    if (sessionId === sid) startNew();
  }

  function openHistory(session) {
    setActiveHist(session);
    setMessages([]); setInput(""); setSessionId(session.session_id);
    setErrMsg(""); setIsInterviewMode(false); setIsJobsMode(false); setIsLiveInterviewMode(false);
  }

  function logout() {
    localStorage.removeItem("jat_token"); localStorage.removeItem("jat_user");
    setAuth(null);
  }

  if (!auth) return <AuthScreen onAuth={setAuth} API_BASE={API_BASE} />;

  // FIX: The interview buttons should be available if ANY valid session exists with messages, 
  // whether it is a loaded history item or a brand new live session.
  const canInterview = Boolean(sessionId && (messages.length > 1 || (activeHist && activeHist.turns.length > 0)));

  return (
    <div className="shell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-logo">Job<em>Lens</em><span className="ai-tag">AI</span></div>
          <div className="sidebar-user">
            <span className="user-status" />
            <strong>{auth.username}</strong>
          </div>
        </div>

        <div className="sidebar-nav">
          <button className="nav-btn primary" onClick={startNew}>
            <span className="nav-btn-icon">+</span>
            New Analysis
          </button>
          <button
            className="nav-btn"
            onClick={() => { setIsJobsMode(true); setIsInterviewMode(false); setActiveHist(null); }}
          >
            <span className="nav-btn-icon">💼</span>
            Find Jobs
          </button>
        </div>

        <div className="history-section">
          <div className="history-label">Recent</div>
          <div className="history-list">
            {history.length === 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--ink-300)", padding: "6px 10px" }}>
                No sessions yet
              </div>
            )}
            {history.map(s => (
              <div
                key={s.session_id}
                className={`hist-card ${activeHist?.session_id === s.session_id || sessionId === s.session_id ? "active" : ""}`}
                onClick={() => openHistory(s)}
              >
                <div className="hist-card-title">{s.turns[0]?.user?.slice(0, 55) || "Session"}</div>
                <div className="hist-card-meta">
                  <span>{fmtDate(s.started)}</span>
                  {s.match_pct !== null && s.match_pct !== undefined && (
                    <span className={`match-badge ${matchClass(s.match_pct)}`}>{s.match_pct}%</span>
                  )}
                  {s.has_cv && <span>📄</span>}
                </div>
                <button className="hist-del" onClick={(e) => deleteSession(s.session_id, e)} title="Delete">✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-foot">
          <button className="logout-btn" onClick={logout}>
            <span>↩</span> Sign out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-title">
            <span style={{ color: "var(--ink-300)" }}>JobLens</span>
            <span className="topbar-sep">/</span>
            <span style={{ color: "var(--ink-700)", fontWeight: 600 }}>
              {activeHist ? fmtDate(activeHist.started) : "New Analysis"}
            </span>

            {/* FIX: Move interview action buttons right here, conditionally rendered */}
            {canInterview && !isInterviewMode && !isLiveInterviewMode && (
              <div className="interview-actions" style={{ marginLeft: '24px' }}>
                <button className="btn-mock-text" onClick={() => setIsInterviewMode(true)}>
                  📝 Text Mock
                </button>
                <button className="btn-mock-live" onClick={() => setIsLiveInterviewMode(true)}>
                  🎙️ Live Voice Mock
                </button>
              </div>
            )}
          </div>

          <div className="cv-zone">
            <div
              className={`cv-drop ${drag ? "drag" : ""} ${cvFile ? "has" : ""}`}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleCvFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" accept="application/pdf" onChange={e => handleCvFile(e.target.files[0])} />
              <span>{cvFile ? "📄" : "↑"}</span>
              <span>{cvFile ? cvFile.name.slice(0, 20) + (cvFile.name.length > 20 ? "…" : "") : "Upload CV"}</span>
            </div>
            {cvFile && (
              <button className="cv-rm" onClick={() => setCvFile(null)} title="Remove">✕</button>
            )}
          </div>
        </div>

        {errMsg && (
          <div className="err-bar">
            <span>⚠</span>
            <div><strong>Request failed</strong> — {errMsg}</div>
          </div>
        )}

        {/* SCREEN ROUTER */}
        {isJobsMode ? (
          <JobsScreen auth={auth} cvFile={cvFile} pdfToBase64={pdfToBase64} API_BASE={API_BASE} onBack={() => setIsJobsMode(false)} />
        ) : isLiveInterviewMode ? (
          <LiveInterviewScreen
          session={activeHist || { session_id: sessionId }}
          auth={auth}
          API_BASE={API_BASE}
          onBack={() => setIsLiveInterviewMode(false)}
        />
        ) : isInterviewMode ? (
          <InterviewScreen
          session={activeHist || { session_id: sessionId }}
          auth={auth}
          API_BASE={API_BASE}
          onBack={() => setIsInterviewMode(false)}
        />
        ) : (
          <>
            <div className="chat-body">
              {/* History read-back */}
              {activeHist && messages.length === 0 ? (
                <div className="hist-turns">
                  {activeHist.turns.map((t, i) => (
                    <div key={i} style={{ marginBottom: "14px" }}>
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
                          
                          {/* PREMIUM WIDGET FOR HISTORY READBACK */}
                          {t.match_pct !== null && t.match_pct !== undefined && (
                            <div className={`premium-match-box ${t.match_pct >= 70 ? 'high' : t.match_pct >= 40 ? 'med' : 'low'}`}>
                              <div className="match-score-circle">
                                <svg viewBox="0 0 36 36">
                                  <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                  <path className="circle-fill" strokeDasharray={`${t.match_pct}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                </svg>
                                <div className="match-score-text">{t.match_pct}%</div>
                              </div>
                              <div className="match-info">
                                <span className="match-title">CV Match Score</span>
                                <span className="match-subtitle">Analyzed against Job Description</span>
                              </div>
                            </div>
                          )}

                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                /* Welcome */
                <div className="empty-state">
                  <div className="empty-wordmark">Job<span>Lens</span></div>
                  <p className="empty-sub">
                    Paste a job description and upload your CV to get a detailed gap analysis,
                    improvement suggestions, and interview practice.
                  </p>
                  <div className="dash-grid">
                    <button className="dash-card" onClick={() => setInput("Paste a job description here...")}>
                      <span className="dash-icon">📋</span>
                      <span className="dash-title">Analyze a Job</span>
                      <span className="dash-desc">Extract skills and requirements from any posting.</span>
                    </button>
                    <button className="dash-card" onClick={() => document.querySelector('input[type="file"]').click()}>
                      <span className="dash-icon">📎</span>
                      <span className="dash-title">CV Gap Analysis</span>
                      <span className="dash-desc">Match your resume against a role to find gaps.</span>
                    </button>
                    <button className="dash-card" onClick={() => setInput("Can you suggest projects to improve my skills?")}>
                      <span className="dash-icon">🎙</span>
                      <span className="dash-title">Mock Interview</span>
                      <span className="dash-desc">Practice with questions generated from your CV.</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Active chat */
                <div style={{ maxWidth: "900px", margin: "0 auto" }}>
                  {messages.map((m, i) => (
                    <div key={i} className={`msg-row ${m.role}`}>
                      <div className="bubble">
                        <div className="bubble-label">
                          {m.role === "user" ? auth.full_name || auth.username : "JobLens AI"}
                        </div>
                        {m.content}

                        {/* PREMIUM WIDGET FOR ACTIVE CHAT */}
                        {m.match_pct !== null && m.match_pct !== undefined && (
                          <div className={`premium-match-box ${m.match_pct >= 70 ? 'high' : m.match_pct >= 40 ? 'med' : 'low'}`}>
                            <div className="match-score-circle">
                              <svg viewBox="0 0 36 36">
                                <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <path className="circle-fill" strokeDasharray={`${m.match_pct}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                              </svg>
                              <div className="match-score-text">{m.match_pct}%</div>
                            </div>
                            <div className="match-info">
                              <span className="match-title">CV Match Score</span>
                              <span className="match-subtitle">Analyzed against Job Description</span>
                            </div>
                          </div>
                        )}

                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="msg-row assistant">
                      <div className="bubble">
                        <div className="bubble-label">JobLens AI</div>
                        <div className="typing-dots">
                          <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* INPUT */}
            <div className="input-bar">
              <div className="input-row">
                <textarea
                  ref={taRef}
                  className="chat-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={
                    activeHist && messages.length === 0
                      ? "Continue this session…"
                      : "Paste a job description or ask a follow-up…"
                  }
                  disabled={loading}
                />
                <button className="send" onClick={handleSend} disabled={loading || !input.trim()}>
                  {loading ? "…" : "Send"}
                </button>
              </div>
              <div className="hint">
                <span>Enter to send · Shift+Enter for new line</span>
                {cvFile && <span className="cv-hint">📄 CV attached — gap analysis on</span>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}