import { useState } from "react";

const COUNTRIES = [
  { name: "Pakistan", code: "pk" },
  { name: "United States", code: "us" },
  { name: "United Kingdom", code: "gb" },
  { name: "Canada", code: "ca" },
  { name: "Australia", code: "au" },
  { name: "United Arab Emirates", code: "ae" },
  { name: "Saudi Arabia", code: "sa" },
  { name: "Germany", code: "de" },
  { name: "France", code: "fr" },
  { name: "Netherlands", code: "nl" },
  { name: "India", code: "in" },
  { name: "Singapore", code: "sg" },
  { name: "Remote", code: "remote" },
];

export default function JobsScreen({ auth, cvFile, pdfToBase64, API_BASE, onBack }) {
  const [jobs, setJobs] = useState([]);
  const [jobTitle, setJobTitle] = useState("");
  const [skills, setSkills] = useState([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState("pk");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [searched, setSearched] = useState(false);

  const selectedCountry =
    COUNTRIES.find((c) => c.code === selectedCountryCode) || COUNTRIES[0];

  async function findJobs() {
    try {
      setErr("");
      setLoading(true);

      if (!cvFile) {
        throw new Error("Please upload your CV first from the main page.");
      }

      const b64 = await pdfToBase64(cvFile);

      const res = await fetch(`${API_BASE}/internal/recommend_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          cv_pdf: {
            filename: cvFile.name,
            base64: b64,
          },
          location: selectedCountry.name,
          country_code: selectedCountry.code,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("Unable to load job recommendations right now.");
      }

      setJobTitle(data.inferred_title || "");
      setSkills(data.skills || []);
      setJobs(data.jobs || []);
      setSearched(true);

    } catch (error) {
      console.error("Job recommendation error:", error);
      setErr("Unable to load job recommendations right now. Please try again later.");
      setSearched(true);

    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jobs-page">
      <div className="jobs-head">
        <div>
          <h2>Job Recommendations</h2>
          <p>Upload your CV on the main page, then search for roles that match your skills and experience.</p>
        </div>
        <button className="ghost-btn" onClick={onBack}>← Back</button>
      </div>

      <div className="jobs-controls">
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Country</label>
          <select
            value={selectedCountryCode}
            onChange={(e) => setSelectedCountryCode(e.target.value)}
            style={{
              padding: "10px 13px",
              border: "1px solid var(--ink-100)",
              borderRadius: "var(--radius-m)",
              fontFamily: "var(--font-ui)",
              fontSize: "0.9rem",
              color: "var(--ink-900)",
              background: "var(--surface)",
              outline: "none",
              width: "100%",
            }}
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="auth-submit"
          onClick={findJobs}
          disabled={loading || !cvFile}
          style={{ maxWidth: "160px", marginTop: 0, alignSelf: "flex-end" }}
        >
          {loading ? "Searching…" : "Find Jobs"}
        </button>
      </div>

      {!cvFile && (
        <div className="err-bar">
          <span>⚠</span>
          <div>
            <strong>No CV uploaded</strong> — go back and upload a PDF CV first.
          </div>
        </div>
      )}

      {err && (
        <div className="err-bar">
          <span>⚠</span>
          <div>
            <strong>Notice</strong> — {err}
          </div>
        </div>
      )}

      {jobTitle && (
        <div className="jobs-summary">
          <h3>Detected Role: {jobTitle}</h3>

          {skills.length > 0 && (
            <div className="skills-row">
              {skills.map((skill) => (
                <span key={skill} className="skill-pill">{skill}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="jobs-list">
        {jobs.length === 0 && !loading && (
          <div className="empty-jobs">
            {!searched ? (
              <>No results yet. Select a country and click <strong>Find Jobs</strong>.</>
            ) : (
              <>No job recommendations available right now. Try another country or search again later.</>
            )}
          </div>
        )}

        {jobs.slice(0, 20).map((job, index) => (
          <div className="job-card" key={index}>
            <div className="job-title">{job.title || "Untitled Job"}</div>

            <div className="job-meta">
              {job.company || "Unknown company"} · {job.location || "Unknown location"}
            </div>

            {job.description && (
              <p className="job-desc">
                {job.description.slice(0, 280)}
                {job.description.length > 280 ? "…" : ""}
              </p>
            )}

            {job.url && (
              <a className="job-link" href={job.url} target="_blank" rel="noreferrer">
                View posting →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}