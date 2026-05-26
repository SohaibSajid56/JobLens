import { useState, useEffect, useRef } from "react";

const API_BASE = "https://arbitrary-negotiate-monotone.ngrok-free.dev";

const HEADERS = (token) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "ngrok-skip-browser-warning": "true",
});

function ScoreRing({ score }) {
  const r = 28, cx = 36, cy = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 10) * circ;
  const color = score >= 8 ? "#10b981" : score >= 6 ? "#f59e0b" : score >= 4 ? "#f97316" : "#ef4444";
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        style={{ fontSize: "14px", fontWeight: 700, fill: color, fontFamily: "inherit" }}>
        {score}/10
      </text>
    </svg>
  );
}

function Badge({ label, type }) {
  const colors = {
    good:    { bg: "#d1fae5", color: "#059669", border: "#a7f3d0" },
    warn:    { bg: "#fef3c7", color: "#d97706", border: "#fde68a" },
    bad:     { bg: "#fee2e2", color: "#dc2626", border: "#fecaca" },
    neutral: { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" },
  };
  const s = colors[type] || colors.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: 99, fontSize: "0.72rem", fontWeight: 600,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{label}</span>
  );
}

export default function InterviewScreen({ session, auth, onBack }) {
  const [phase, setPhase] = useState("loading");
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const [error, setError] = useState("");
  const taRef = useRef(null);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "80px";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 260) + "px";
    }
  }, [answer]);

  useEffect(() => { generateQuestions(); }, []);

  async function generateQuestions() {
    setPhase("loading"); setError("");
    try {
      const res = await fetch(`${API_BASE}/internal/interview/questions`, {
        method: "POST",
        headers: HEADERS(auth.token),
        body: JSON.stringify({ session_id: session.session_id }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const data = await res.json();
      if (!data.questions || data.questions.length === 0)
        throw new Error("No questions returned. Make sure the session has a job analysis.");
      setQuestions(data.questions);
      setPhase("answering");
    } catch (ex) {
      setError(ex.message);
      setPhase("error");
    }
  }

  async function submitAnswer() {
    if (!answer.trim()) return;
    setPhase("evaluating"); setError("");
    try {
      const q = questions[current];
      const res = await fetch(`${API_BASE}/internal/interview/evaluate`, {
        method: "POST",
        headers: HEADERS(auth.token),
        body: JSON.stringify({
          session_id: session.session_id,
          question: q.question,
          question_type: q.type,
          expected_skills: q.expected_skills || [],
          user_answer: answer.trim(),
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const data = await res.json();
      setEvaluation(data);
      setAllResults(prev => [...prev, { question: q, answer: answer.trim(), evaluation: data }]);
      setPhase("result");
    } catch (ex) {
      setError(ex.message);
      setPhase("answering");
    }
  }

  function nextQuestion() {
    if (current + 1 >= questions.length) { setPhase("done"); }
    else { setCurrent(c => c + 1); setAnswer(""); setEvaluation(null); setPhase("answering"); }
  }

  const q = questions[current];
  const overallScore = allResults.length
    ? Math.round(allResults.reduce((s, r) => s + (r.evaluation?.score || 0), 0) / allResults.length * 10) / 10
    : null;

  if (phase === "loading") return (
    <div style={styles.centeredFill}>
      <div style={styles.spinnerWrap}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Generating your personalised interview questions…</p>
        <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 6 }}>Analysing CV gaps from this session</p>
      </div>
    </div>
  );

  if (phase === "error") return (
    <div style={styles.centeredFill}>
      <div style={{ maxWidth: 480, textAlign: "center", padding: "0 24px" }}>
        <div style={{ fontSize: "2rem", marginBottom: 12 }}>⚠️</div>
        <h3 style={{ color: "#dc2626", marginBottom: 8 }}>Could not start interview</h3>
        <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: 20 }}>{error}</p>
        <button style={styles.primaryBtn} onClick={generateQuestions}>Retry</button>
        <button style={{ ...styles.ghostBtn, marginLeft: 10 }} onClick={onBack}>← Go Back</button>
      </div>
    </div>
  );

  if (phase === "done") return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
          <button style={styles.ghostBtn} onClick={onBack}>← Exit</button>
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1e293b" }}>Interview Complete 🎉</h2>
            <p style={{ color: "#64748b", fontSize: "0.85rem" }}>{allResults.length} question{allResults.length !== 1 ? "s" : ""} answered</p>
          </div>
          {overallScore !== null && <div style={{ marginLeft: "auto" }}><ScoreRing score={overallScore} /></div>}
        </div>
        {allResults.map((r, i) => (
          <div key={i} style={styles.resultCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <span style={styles.qLabel}>Q{i + 1} · {r.question.type}</span>
                <p style={{ fontWeight: 600, color: "#1e293b", marginTop: 4 }}>{r.question.question}</p>
              </div>
              <ScoreRing score={r.evaluation.score} />
            </div>
            <div style={styles.answerBox}>{r.answer}</div>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.evaluation.strengths?.map((s, j) => <Badge key={j} label={`✓ ${s}`} type="good" />)}
              {r.evaluation.weaknesses?.map((w, j) => <Badge key={j} label={`△ ${w}`} type="warn" />)}
            </div>
            {r.evaluation.ideal_answer_direction && (
              <div style={styles.idealBox}>
                <span style={{ fontWeight: 600, color: "#4f46e5" }}>💡 Ideal answer direction: </span>
                {r.evaluation.ideal_answer_direction}
              </div>
            )}
          </div>
        ))}
        <button style={{ ...styles.primaryBtn, width: "100%", marginTop: 8 }} onClick={onBack}>← Back to Analysis</button>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", width: "100%", padding: "28px 32px", flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <button style={styles.ghostBtn} onClick={onBack}>← Exit Interview</button>
          <span style={styles.progressPill}>Question {current + 1} of {questions.length}{q?.type && ` · ${q.type}`}</span>
        </div>

        <div style={{ height: 4, background: "#e2e8f0", borderRadius: 99, marginBottom: 28 }}>
          <div style={{
            height: "100%", borderRadius: 99, background: "var(--primary, #4f46e5)",
            width: `${((phase === "result" ? current + 1 : current) / questions.length) * 100}%`,
            transition: "width 0.4s ease",
          }} />
        </div>

        <div style={styles.questionCard}>
          <div style={styles.interviewerLabel}>INTERVIEWER</div>
          <p style={styles.questionText}>{q?.question}</p>
          {q?.expected_skills?.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {q.expected_skills.map((s, i) => <span key={i} style={styles.skillTag}>{s}</span>)}
            </div>
          )}
        </div>

        {error && <div style={{ ...styles.errBar, marginBottom: 16 }}>⚠ {error} — please try again.</div>}

        {phase === "answering" && (
          <>
            <textarea ref={taRef} value={answer} onChange={e => setAnswer(e.target.value)}
              placeholder="Type your answer here… Be specific and use examples from your experience."
              style={styles.answerTextarea}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitAnswer(); } }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Ctrl+Enter to submit</span>
              <button style={{ ...styles.primaryBtn, opacity: answer.trim() ? 1 : 0.45 }} onClick={submitAnswer} disabled={!answer.trim()}>
                Submit Answer →
              </button>
            </div>
          </>
        )}

        {phase === "evaluating" && (
          <div style={{ ...styles.centeredFill, minHeight: 220 }}>
            <div style={styles.spinnerWrap}>
              <div style={styles.spinner} />
              <p style={styles.loadingText}>Evaluating your answer…</p>
            </div>
          </div>
        )}

        {phase === "result" && evaluation && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <div style={styles.evalHeader}>
              <ScoreRing score={evaluation.score} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  FEEDBACK (SCORE: {evaluation.score}/10)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {evaluation.strengths?.map((s, i) => <Badge key={i} label={`✓ ${s}`} type="good" />)}
                  {evaluation.weaknesses?.map((w, i) => <Badge key={i} label={`△ ${w}`} type="warn" />)}
                  {evaluation.missing_keywords?.map((k, i) => <Badge key={i} label={`✗ ${k}`} type="bad" />)}
                </div>
              </div>
            </div>
            {evaluation.detailed_feedback && (
              <div style={styles.feedbackBox}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: "#1e293b" }}>📝 Detailed Feedback</div>
                <p style={{ color: "#475569", fontSize: "0.85rem", lineHeight: 1.65 }}>{evaluation.detailed_feedback}</p>
              </div>
            )}
            {evaluation.ideal_answer_direction && (
              <div style={styles.idealBox}>
                <span style={{ fontWeight: 600, color: "#4f46e5" }}>💡 Ideal Answer Direction: </span>
                {evaluation.ideal_answer_direction}
              </div>
            )}
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "#64748b", marginBottom: 8 }}>Your answer</summary>
              <div style={styles.answerBox}>{answer}</div>
            </details>
            <button style={{ ...styles.primaryBtn, width: "100%", marginTop: 20 }} onClick={nextQuestion}>
              {current + 1 >= questions.length ? "View Summary →" : "Next Question →"}
            </button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const styles = {
  centeredFill: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 },
  spinnerWrap: { textAlign: "center" },
  spinner: { width: 40, height: 40, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "#4f46e5", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" },
  loadingText: { color: "#475569", fontWeight: 500 },
  primaryBtn: { padding: "11px 28px", background: "#4f46e5", color: "white", border: "none", borderRadius: 10, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" },
  ghostBtn: { padding: "8px 16px", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", transition: "all 0.2s" },
  progressPill: { padding: "6px 14px", background: "#eef2ff", color: "#4f46e5", borderRadius: 99, fontSize: "0.78rem", fontWeight: 600 },
  questionCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "22px 24px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
  interviewerLabel: { fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", color: "#0ea5e9", textTransform: "uppercase", marginBottom: 10 },
  questionText: { fontSize: "1.05rem", lineHeight: 1.6, color: "#1e293b", fontWeight: 500 },
  skillTag: { padding: "3px 10px", background: "#f1f5f9", color: "#475569", borderRadius: 99, fontSize: "0.7rem", border: "1px solid #e2e8f0" },
  answerTextarea: { width: "100%", minHeight: 80, maxHeight: 260, padding: "14px 16px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: "0.9rem", lineHeight: 1.6, color: "#1e293b", background: "#fff", resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box", transition: "border-color 0.2s" },
  evalHeader: { display: "flex", alignItems: "flex-start", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px", marginBottom: 14 },
  feedbackBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", marginBottom: 12 },
  idealBox: { background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "12px 16px", fontSize: "0.85rem", color: "#374151", lineHeight: 1.6, marginBottom: 12 },
  answerBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", fontSize: "0.85rem", color: "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap", marginTop: 8 },
  resultCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px 22px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  qLabel: { fontSize: "0.7rem", fontWeight: 600, color: "#0ea5e9", textTransform: "uppercase", letterSpacing: "0.08em" },
  errBar: { background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: "0.82rem" },
};