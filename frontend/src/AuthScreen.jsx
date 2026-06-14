// src/AuthScreen.jsx
import { useState } from "react";


export default function AuthScreen({ onAuth, API_BASE }) {
    const [tab, setTab] = useState("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    async function submit(e) {
        e.preventDefault();
        setErr(""); setLoading(true);
        try {
            let res, data;
            if (tab === "login") {
                const form = new URLSearchParams({ username, password });
                res = await fetch(`${API_BASE}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: form,
                });
            } else {
                res = await fetch(`${API_BASE}/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password, full_name: fullName }),
                });
            }
            data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Auth failed");
            localStorage.setItem("jat_token", data.access_token);
            localStorage.setItem("jat_user", JSON.stringify({ username: data.username, full_name: data.full_name }));
            onAuth({ token: data.access_token, username: data.username, full_name: data.full_name });
        } catch (ex) {
            setErr(ex.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-screen">
            {/* Left brand panel */}
            <div className="auth-left">
                <div className="auth-left-logo">
                    Job<em>Lens</em>
                    <span className="ai-tag">AI</span>
                </div>

                <div className="auth-left-body">
                    <h1 className="auth-left-headline">
                        Land the role<br />you actually <em>deserve.</em>
                    </h1>
                    <p>
                        Upload your CV, paste a job description, and get
                        a precise gap analysis — then practice with a live AI interviewer.
                    </p>
                    <ul className="auth-feature-list">
                        <li>Instant CV–JD match scoring</li>
                        <li>Skill gap detection with guidance</li>
                        <li>Live AI mock interview with speech</li>
                        <li>Per-answer scoring and ideal responses</li>
                    </ul>
                </div>

                <div className="auth-left-footer">
                    © {new Date().getFullYear()} JobLens. All rights reserved.
                </div>
            </div>

            {/* Right form panel */}
            <div className="auth-right">
                <div className="auth-right-head">
                    <h2 className="auth-right-title">
                        {tab === "login" ? "Welcome back" : "Create your account"}
                    </h2>
                    <p className="auth-right-sub">
                        {tab === "login"
                            ? "Sign in to continue your analysis sessions."
                            : "Free to start — no credit card required."}
                    </p>
                </div>

                <div className="auth-tab-row">
                    {["login", "register"].map(t => (
                        <button
                            key={t}
                            className={`auth-tab ${tab === t ? "active" : ""}`}
                            onClick={() => { setTab(t); setErr(""); }}
                        >
                            {t === "login" ? "Sign In" : "Create Account"}
                        </button>
                    ))}
                </div>

                <form onSubmit={submit}>
                    {tab === "register" && (
                        <div className="field">
                            <label>Full Name</label>
                            <input
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                placeholder="Ada Lovelace"
                            />
                        </div>
                    )}
                    <div className="field">
                        <label>Username</label>
                        <input
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="your_handle"
                            required autoFocus
                        />
                    </div>
                    <div className="field">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>
                    <button className="auth-submit" type="submit" disabled={loading}>
                        {loading ? "Please wait…" : tab === "login" ? "Sign in →" : "Create account →"}
                    </button>
                    {err && <div className="auth-err">⚠ {err}</div>}
                </form>
            </div>
        </div>
    );
}