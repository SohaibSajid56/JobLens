import { useState } from "react";

export default function JobsScreen({ auth, cvFile, pdfToBase64, API_BASE, onBack }) {
  const [jobs, setJobs] = useState([]);
  const [jobTitle, setJobTitle] = useState("");
  const [skills, setSkills] = useState([]);
  const [location, setLocation] = useState("United States OR United Kingdom");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function findJobs() {
    try {
      setErr("");
      setLoading(true);
      if (!cvFile) throw new Error("Please upload your CV first from the main page.");
      const b64 = await pdfToBase64(cvFile);
      const res = await fetch(`${API_BASE}/internal/recommend_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ cv_pdf: { filename: cvFile.name, base64: b64 }, location }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to find jobs");
      setJobTitle(data.inferred_title || "");
      setSkills(data.skills || []);
      setJobs(data.jobs || []);
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jobs-page">
      <div className="jobs-head">
        <div>
          <h2>Jobs Recommended From Your CV</h2>
          <p>Upload your CV on the main page, then this page will search jobs based on your skills and inferred role.</p>
        </div>
        <button className="logout-btn" onClick={onBack}>← Back to Analysis</button>
      </div>

      <div className="jobs-controls">
        <div className="field" style={{ flex: 1 }}>
          <label>Location Filter</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="United States OR United Kingdom" />
        </div>
        <button className="auth-submit" onClick={findJobs} disabled={loading || !cvFile} style={{ maxWidth: "220px" }}>
          {loading ? "Finding Jobs..." : "Find Jobs"}
        </button>
      </div>

      {!cvFile && (
        <div className="err-bar"><span>⚠</span><div><strong>No CV uploaded</strong> — go back and upload a PDF CV first.</div></div>
      )}
      {err && (
        <div className="err-bar"><span>⚠</span><div><strong>Request failed</strong> — {err}</div></div>
      )}

      {jobTitle && (
        <div className="jobs-summary">
          <h3>Detected Role: {jobTitle}</h3>
          {skills.length > 0 && (
            <div className="skills-row">
              {skills.map((skill) => <span key={skill} className="skill-pill">{skill}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="jobs-list">
        {jobs.length === 0 && !loading && (
          <div className="empty-jobs">No jobs loaded yet. Click <strong>Find Jobs</strong> to search.</div>
        )}
        {jobs.slice(0, 20).map((job, index) => (
          <div className="job-card" key={index}>
            <div className="job-title">{job.title || "Untitled Job"}</div>
            <div className="job-meta">{job.company || "Unknown company"} · {job.location || "Unknown location"}</div>
            {job.description && (
              <p className="job-desc">{job.description.slice(0, 280)}{job.description.length > 280 ? "..." : ""}</p>
            )}
            {job.url && <a className="job-link" href={job.url} target="_blank" rel="noreferrer">View Job →</a>}
          </div>
        ))}
      </div>
    </div>
  );
}