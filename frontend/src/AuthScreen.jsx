// src/AuthScreen.jsx
import { useState } from "react";

// Update this if ngrok changes
const API_BASE = "https://unshaven-crafty-dedicate.ngrok-free.dev";

export default function AuthScreen({ onAuth }) {
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
            <div className="auth-card">
                <div className="auth-logo">Job<em>Lens</em></div>
                <div className="auth-sub">AI-powered job description analyser & CV gap analysis</div>

                <div className="auth-tab-row">
                    {["login", "register"].map(t => (
                        <button key={t} className={`auth-tab ${tab === t ? "active" : ""}`} onClick={() => { setTab(t); setErr(""); }}>
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
    );
}