import { useState, useRef, useEffect, useCallback } from "react";

// ⚠️ UPDATE this every time you restart the Colab cell
const API_BASE = "https://arbitrary-negotiate-monotone.ngrok-free.dev";

// ─── Fonts + Global styles ────────────────────────────────────────────────────
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --ink:       #0d0d12;
      --paper:     #f5f3ee;
      --warm:      #ede9df;
      --stroke:    #d4cfc4;
      --accent:    #c8622a;
      --accent-lt: #f0ddd0;
      --teal:      #2a7c6f;
      --teal-lt:   #d0ede9;
      --muted:     #7a7570;
      --danger:    #b03a2e;
      --success:   #2a7c6f;
      --r:         10px;
      --serif:     'Instrument Serif', Georgia, serif;
      --mono:      'JetBrains Mono', 'Fira Mono', monospace;
    }

    html, body, #root { height: 100%; background: var(--paper); }

    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--stroke); border-radius: 99px; }

    .shell {
      display: flex;
      height: 100vh;
      font-family: var(--mono);
      color: var(--ink);
      background: var(--paper);
      position: relative;
      overflow: hidden;
    }

    /* subtle dot grid */
    .shell::before {
      content: '';
      position: fixed; inset: 0;
      background-image: radial-gradient(var(--stroke) 1px, transparent 1px);
      background-size: 28px 28px;
      opacity: 0.45;
      pointer-events: none;
      z-index: 0;
    }

    /* ── SIDEBAR ── */
    .sidebar {
      width: 260px;
      flex-shrink: 0;
      background: var(--ink);
      color: var(--paper);
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 20;
      border-right: 1px solid #1e1e28;
    }

    .sidebar-head {
      padding: 22px 20px 16px;
      border-bottom: 1px solid #2a2a38;
    }

    .sidebar-logo {
      font-family: var(--serif);
      font-size: 1.25rem;
      font-style: italic;
      letter-spacing: -0.3px;
      color: var(--paper);
      line-height: 1.2;
    }

    .sidebar-logo em {
      color: var(--accent);
      font-style: normal;
    }

    .sidebar-user {
      margin-top: 10px;
      font-size: 0.65rem;
      color: #6b6b7e;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .sidebar-user strong {
      color: var(--teal);
      font-weight: 500;
    }

    .new-chat-btn {
      margin: 14px 16px 6px;
      padding: 9px 14px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--r);
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.04em;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: opacity 0.2s, transform 0.15s;
    }

    .new-chat-btn:hover { opacity: 0.88; transform: translateY(-1px); }

    .history-label {
      padding: 8px 20px 4px;
      font-size: 0.58rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #4a4a58;
      font-weight: 600;
    }

    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 10px 10px;
    }

    .history-list::-webkit-scrollbar-thumb { background: #2a2a38; }

    .hist-card {
      padding: 9px 11px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 4px;
      transition: background 0.15s;
      position: relative;
    }

    .hist-card:hover, .hist-card.active { background: #1e1e2e; }

    .hist-card-title {
      font-size: 0.7rem;
      color: #c8c8d8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }

    .hist-card-meta {
      font-size: 0.6rem;
      color: #4a4a58;
      margin-top: 3px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .match-badge {
      padding: 1px 7px;
      border-radius: 99px;
      font-size: 0.58rem;
      font-weight: 600;
    }

    .match-badge.good  { background: rgba(42,124,111,0.25); color: var(--teal); }
    .match-badge.ok    { background: rgba(200,98,42,0.2);  color: #e8803a; }
    .match-badge.low   { background: rgba(176,58,46,0.2);  color: #d45a50; }

    .hist-del {
      position: absolute; right: 8px; top: 50%;
      transform: translateY(-50%);
      background: none; border: none;
      color: #3a3a4e; cursor: pointer; font-size: 0.75rem;
      padding: 2px 5px; border-radius: 4px;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
    }

    .hist-card:hover .hist-del { opacity: 1; }
    .hist-del:hover { color: var(--danger); }

    .sidebar-foot {
      padding: 14px 16px;
      border-top: 1px solid #2a2a38;
    }

    .logout-btn {
      width: 100%;
      padding: 8px 14px;
      background: #1a1a28;
      color: #6b6b7e;
      border: 1px solid #2a2a38;
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 0.68rem;
      cursor: pointer;
      text-align: left;
      transition: color 0.2s;
    }

    .logout-btn:hover { color: var(--danger); }

    /* ── MAIN ── */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 5;
      overflow: hidden;
    }

    /* ── TOPBAR ── */
    .topbar {
      padding: 14px 28px;
      background: rgba(245,243,238,0.9);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--stroke);
      display: flex;
      align-items: center;
      gap: 14px;
      position: relative;
      z-index: 15;
    }

    .topbar-title {
      font-family: var(--serif);
      font-size: 1rem;
      font-style: italic;
      color: var(--muted);
    }

    .cv-zone {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .cv-drop {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border: 1.5px dashed var(--stroke);
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.68rem;
      color: var(--muted);
      transition: border-color 0.2s, background 0.2s;
      background: var(--warm);
    }

    .cv-drop.drag { border-color: var(--accent); background: var(--accent-lt); }
    .cv-drop.has  { border-color: var(--teal); background: var(--teal-lt); color: var(--teal); font-weight: 500; }

    .cv-drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }

    .cv-rm {
      background: none; border: none;
      color: var(--muted); cursor: pointer;
      font-size: 0.85rem; padding: 0;
      transition: color 0.15s;
    }

    .cv-rm:hover { color: var(--danger); }

    /* ── CHAT ── */
    .chat-body {
      flex: 1;
      overflow-y: auto;
      padding: 32px 28px;
    }

    .empty {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
      color: var(--muted);
    }

    .empty-glyph {
      font-family: var(--serif);
      font-size: 3rem;
      font-style: italic;
      color: var(--stroke);
      line-height: 1;
    }

    .empty h2 {
      font-family: var(--serif);
      font-size: 1.4rem;
      font-style: italic;
      color: var(--ink);
    }

    .empty p { font-size: 0.75rem; max-width: 340px; line-height: 1.7; }

    .tip-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }

    .tip {
      padding: 9px 14px;
      background: var(--warm);
      border: 1px solid var(--stroke);
      border-radius: 8px;
      font-size: 0.7rem;
      color: var(--muted);
      cursor: pointer;
      transition: background 0.15s;
      text-align: left;
    }

    .tip:hover { background: var(--accent-lt); color: var(--accent); border-color: var(--accent); }

    .msg-row {
      display: flex;
      margin-bottom: 22px;
      animation: fadeUp 0.28s ease;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg-row.user      { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }

    .bubble {
      max-width: 76%;
      padding: 13px 16px;
      border-radius: var(--r);
      font-size: 0.78rem;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .msg-row.user .bubble {
      background: var(--ink);
      color: var(--paper);
      border-bottom-right-radius: 2px;
    }

    .msg-row.assistant .bubble {
      background: #fff;
      border: 1px solid var(--stroke);
      border-bottom-left-radius: 2px;
      color: var(--ink);
    }

    .bubble-label {
      font-size: 0.58rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .msg-row.user .bubble-label      { color: var(--accent); text-align: right; }
    .msg-row.assistant .bubble-label  { color: var(--teal); }

    /* Match score pill inside bubble */
    .match-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding: 5px 11px;
      border-radius: 99px;
      font-size: 0.66rem;
      font-weight: 600;
    }

    .match-pill.good  { background: var(--teal-lt); color: var(--teal); }
    .match-pill.ok    { background: #fdecd8; color: #c87020; }
    .match-pill.low   { background: #fde8e6; color: var(--danger); }

    .typing {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 14px 16px;
      background: #fff;
      border: 1px solid var(--stroke);
      border-radius: var(--r);
      border-bottom-left-radius: 2px;
      width: fit-content;
    }

    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--teal);
      animation: blink 1.2s infinite;
    }

    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes blink {
      0%, 80%, 100% { opacity: 0.18; transform: scale(0.8); }
      40%           { opacity: 1;    transform: scale(1); }
    }

    /* ── INPUT ── */
    .input-bar {
      padding: 14px 28px 18px;
      background: rgba(245,243,238,0.95);
      backdrop-filter: blur(8px);
      border-top: 1px solid var(--stroke);
    }

    .input-row { display: flex; gap: 10px; align-items: flex-end; }

    textarea.chat-input {
      flex: 1;
      background: #fff;
      border: 1.5px solid var(--stroke);
      border-radius: var(--r);
      padding: 11px 14px;
      font-family: var(--mono);
      font-size: 0.78rem;
      line-height: 1.55;
      color: var(--ink);
      resize: none;
      min-height: 50px;
      max-height: 150px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    textarea.chat-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(200,98,42,0.1);
    }

    textarea.chat-input::placeholder { color: var(--stroke); }
    textarea.chat-input:disabled { opacity: 0.5; }

    .send {
      height: 50px;
      padding: 0 22px;
      background: var(--ink);
      color: var(--paper);
      border: none;
      border-radius: var(--r);
      font-family: var(--mono);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
      transition: opacity 0.2s, transform 0.15s;
      white-space: nowrap;
    }

    .send:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
    .send:disabled { opacity: 0.35; cursor: not-allowed; }

    .hint {
      font-size: 0.6rem;
      color: var(--muted);
      margin-top: 7px;
      display: flex;
      justify-content: space-between;
    }

    /* ── AUTH SCREEN ── */
    .auth-screen {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--paper);
      position: relative;
    }

    .auth-screen::before {
      content: '';
      position: absolute; inset: 0;
      background-image: radial-gradient(var(--stroke) 1px, transparent 1px);
      background-size: 28px 28px;
      opacity: 0.45;
    }

    .auth-card {
      position: relative;
      z-index: 5;
      width: 380px;
      background: #fff;
      border: 1px solid var(--stroke);
      border-radius: 16px;
      padding: 38px 36px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.07);
    }

    .auth-logo {
      font-family: var(--serif);
      font-size: 1.6rem;
      font-style: italic;
      color: var(--ink);
      margin-bottom: 6px;
    }

    .auth-logo em { color: var(--accent); font-style: normal; }

    .auth-sub {
      font-size: 0.68rem;
      color: var(--muted);
      margin-bottom: 28px;
    }

    .auth-tab-row {
      display: flex;
      gap: 0;
      margin-bottom: 22px;
      border-radius: 8px;
      background: var(--warm);
      padding: 3px;
    }

    .auth-tab {
      flex: 1;
      padding: 7px;
      border: none;
      border-radius: 6px;
      background: transparent;
      font-family: var(--mono);
      font-size: 0.7rem;
      cursor: pointer;
      color: var(--muted);
      font-weight: 500;
      transition: all 0.2s;
    }

    .auth-tab.active {
      background: #fff;
      color: var(--ink);
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }

    .field {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .field label { font-size: 0.65rem; color: var(--muted); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }

    .field input {
      padding: 9px 12px;
      border: 1.5px solid var(--stroke);
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--ink);
      outline: none;
      background: var(--paper);
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .field input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(200,98,42,0.1); }

    .auth-submit {
      width: 100%;
      margin-top: 8px;
      padding: 11px;
      background: var(--ink);
      color: var(--paper);
      border: none;
      border-radius: 9px;
      font-family: var(--mono);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .auth-submit:hover:not(:disabled) { opacity: 0.85; }
    .auth-submit:disabled { opacity: 0.5; }

    .auth-err {
      margin-top: 10px;
      padding: 8px 12px;
      background: #fde8e6;
      border: 1px solid #f5c0bc;
      border-radius: 7px;
      font-size: 0.7rem;
      color: var(--danger);
    }

    /* ── ERROR BANNER ── */
    .err-bar {
      margin: 0 28px 12px;
      padding: 10px 14px;
      background: #fde8e6;
      border: 1px solid #f5c0bc;
      border-radius: 8px;
      font-size: 0.72rem;
      color: var(--danger);
      display: flex;
      gap: 8px;
    }

    /* ── HISTORY PANEL ── */
    .hist-turns { padding: 0 28px 20px; }

    .turn-card {
      border: 1px solid var(--stroke);
      border-radius: var(--r);
      margin-bottom: 16px;
      overflow: hidden;
    }

    .turn-q {
      padding: 10px 14px;
      background: var(--warm);
      font-size: 0.72rem;
      color: var(--muted);
      border-bottom: 1px solid var(--stroke);
    }

    .turn-a {
      padding: 12px 14px;
      font-size: 0.75rem;
      white-space: pre-wrap;
      color: var(--ink);
      line-height: 1.65;
    }
  `}</style>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [tab, setTab]         = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading]  = useState(false);
  const [err, setErr]          = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      let res, data;
      if (tab === "login") {
        const form = new URLSearchParams({ username, password });
        res  = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "ngrok-skip-browser-warning": "true" },
          body: form,
        });
      } else {
        res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
          body: JSON.stringify({ username, password, full_name: fullName }),
        });
      }
      data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Auth failed");
      localStorage.setItem("jat_token", data.access_token);
      localStorage.setItem("jat_user",  JSON.stringify({ username: data.username, full_name: data.full_name }));
      onAuth({ token: data.access_token, username: data.username, full_name: data.full_name });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <GlobalStyle />
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">Job<em>Lens</em></div>
          <div className="auth-sub">AI-powered job description analyser &amp; CV gap analysis</div>

          <div className="auth-tab-row">
            {["login","register"].map(t => (
              <button key={t} className={`auth-tab ${tab===t?"active":""}`} onClick={() => { setTab(t); setErr(""); }}>
                {t === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            {tab === "register" && (
              <div className="field">
                <label>Full Name</label>
                <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ada Lovelace" />
              </div>
            )}
            <div className="field">
              <label>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="your_handle" required autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Please wait…" : tab === "login" ? "Sign In →" : "Create Account →"}
            </button>
            {err && <div className="auth-err">⚠ {err}</div>}
          </form>
        </div>
      </div>
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth]         = useState(() => {
    const t = localStorage.getItem("jat_token");
    const u = localStorage.getItem("jat_user");
    return t && u ? { token: t, ...JSON.parse(u) } : null;
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [cvFile, setCvFile]     = useState(null);
  const [drag, setDrag]         = useState(false);
  const [errMsg, setErrMsg]     = useState("");
  const [sessionId, setSessionId] = useState(null);

  // sidebar history
  const [history, setHistory]   = useState([]);
  const [activeHist, setActiveHist] = useState(null);

  const endRef      = useRef(null);
  const taRef       = useRef(null);

  // scroll to bottom
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // auto-grow textarea
  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "50px";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  // load history on login
  useEffect(() => { if (auth) loadHistory(); }, [auth]);

  async function loadHistory() {
    try {
      const res  = await fetch(`${API_BASE}/api/history`, {
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
        messages:   updated.map(m => ({ role: m.role, content: m.content })),
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
        throw new Error(`HTTP ${res.status}: ${txt.slice(0,120)}`);
      }

      const data = await res.json();
      setSessionId(data.session_id);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response,
        match_pct: data.match_pct,
      }]);
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
    setMessages([]);
    setInput("");
    setSessionId(session.session_id);
    setErrMsg("");
  }

  function logout() {
    localStorage.removeItem("jat_token");
    localStorage.removeItem("jat_user");
    setAuth(null);
  }

  const TIPS = [
    "Paste a job description to extract structured requirements →",
    "Upload your CV (PDF) to get a gap analysis & improvement plan →",
    "Ask follow-up questions after the initial analysis →",
  ];

  if (!auth) return <AuthScreen onAuth={setAuth} />;

  return (
    <>
      <GlobalStyle />
      <div className="shell">

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-logo">Job<em>Lens</em></div>
            <div className="sidebar-user">Signed in as <strong>{auth.username}</strong></div>
          </div>

          <button className="new-chat-btn" onClick={startNew}>
            ＋ New Analysis
          </button>

          <div className="history-label">Recent Sessions</div>
          <div className="history-list">
            {history.length === 0 && (
              <div style={{ fontSize: "0.65rem", color: "#3a3a4e", padding: "8px 10px" }}>No sessions yet</div>
            )}
            {history.map(s => (
              <div
                key={s.session_id}
                className={`hist-card ${activeHist?.session_id === s.session_id || sessionId === s.session_id ? "active" : ""}`}
                onClick={() => openHistory(s)}
              >
                <div className="hist-card-title">
                  {s.turns[0]?.user?.slice(0, 58) || "Session"}
                </div>
                <div className="hist-card-meta">
                  <span>{fmtDate(s.started)}</span>
                  {s.match_pct !== null && s.match_pct !== undefined && (
                    <span className={`match-badge ${matchClass(s.match_pct)}`}>
                      {s.match_pct}% match
                    </span>
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
            </div>
            <div className="cv-zone">
              <div
                className={`cv-drop ${drag ? "drag" : ""} ${cvFile ? "has" : ""}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); handleCvFile(e.dataTransfer.files[0]); }}
              >
                <input type="file" accept="application/pdf" onChange={e => handleCvFile(e.target.files[0])} />
                <span>{cvFile ? "📄" : "📎"}</span>
                <span>{cvFile ? cvFile.name.slice(0, 24) + (cvFile.name.length > 24 ? "…" : "") : "Attach CV (PDF)"}</span>
              </div>
              {cvFile && (
                <button className="cv-rm" onClick={() => setCvFile(null)} title="Remove CV">✕</button>
              )}
            </div>
          </div>

          {/* ERROR */}
          {errMsg && (
            <div className="err-bar">
              <span>⚠</span>
              <div>
                <strong>Request failed</strong> — {errMsg}
                <br /><span style={{ opacity: 0.7 }}>Make sure the Colab cell is running and API_BASE is correct.</span>
              </div>
            </div>
          )}

          {/* CHAT BODY */}
          <div className="chat-body">

            {/* HISTORY VIEW */}
            {activeHist && messages.length === 0 ? (
              <div className="hist-turns">
                {activeHist.turns.map((t, i) => (
                  <div key={i} className="turn-card">
                    <div className="turn-q">
                      <strong>You</strong> · {fmtDate(t.timestamp)}{" "}
                      {t.match_pct !== null && t.match_pct !== undefined && (
                        <span className={`match-badge ${matchClass(t.match_pct)}`} style={{ marginLeft: 6 }}>
                          {t.match_pct}% match
                        </span>
                      )}
                      <div style={{ marginTop: 4, color: "inherit", opacity: 0.85 }}>{t.user}</div>
                    </div>
                    <div className="turn-a">{t.ai}</div>
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              /* EMPTY STATE */
              <div className="empty">
                <div className="empty-glyph">✦</div>
                <h2>Ready to analyse</h2>
                <p>Paste a job description below. Optionally attach your CV above for a full gap analysis with improvement suggestions.</p>
                <div className="tip-list">
                  {TIPS.map((t, i) => (
                    <button key={i} className="tip" onClick={() => setInput(t.replace(" →",""))}>{t}</button>
                  ))}
                </div>
              </div>
            ) : (
              /* MESSAGES */
              <>
                {messages.map((m, i) => (
                  <div key={i} className={`msg-row ${m.role}`}>
                    <div className="bubble">
                      <div className="bubble-label">
                        {m.role === "user" ? auth.full_name || auth.username : "JobLens AI"}
                      </div>
                      {m.content}
                      {m.match_pct !== null && m.match_pct !== undefined && (
                        <div>
                          <span className={`match-pill ${matchClass(m.match_pct)}`}>
                            {m.match_pct >= 65 ? "✓" : m.match_pct >= 40 ? "~" : "✗"} {m.match_pct}% CV match
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="msg-row assistant">
                    <div className="typing"><div className="dot"/><div className="dot"/><div className="dot"/></div>
                  </div>
                )}
              </>
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
                placeholder={activeHist && messages.length === 0
                  ? "Continue this session or start a new one…"
                  : "Paste a job description or follow-up message…"}
                disabled={loading}
              />
              <button className="send" onClick={handleSend} disabled={loading || !input.trim()}>
                {loading ? "…" : "Send ↑"}
              </button>
            </div>
            <div className="hint">
              <span>⏎ Send · Shift+⏎ New line</span>
              {cvFile && <span style={{ color: "var(--teal)" }}>📄 CV attached — gap analysis enabled</span>}
            </div>
          </div>

        </main>
      </div>
    </>
  );
}