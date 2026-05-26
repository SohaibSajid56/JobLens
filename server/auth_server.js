// auth-server.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();

const COLAB_API_BASE = "https://arbitrary-negotiate-monotone.ngrok-free.dev";
const INTERNAL_API_SECRET = "CHANGE_THIS_INTERNAL_SECRET";

app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── Auth config ─────────────────────────────
const SECRET_KEY = "CHANGE_ME_IN_PRODUCTION_use_secrets_module";
const TOKEN_EXPIRE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ── Simple JSON database ────────────────────
const DB_PATH = path.join(process.cwd(), "job_analyzer_db.json");



function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [] }, null, 2)
    );
  }

  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw || '{"users": []}');
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── Helper functions ────────────────────────

async function callColab(path, options = {}) {
  const url = `${COLAB_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-internal-secret": INTERNAL_API_SECRET,
    },
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { detail: text };
  }

  if (!response.ok) {
    throw new Error(data.detail || "Colab API failed");
  }

  return data;
}



async function hashPassword(password) {
  return await argon2.hash(password);
}

async function verifyPassword(password, hashedPassword) {
  try {
    return await argon2.verify(hashedPassword, password);
  } catch {
    return false;
  }
}

function createToken(data) {
  return jwt.sign(data, SECRET_KEY, {
    expiresIn: TOKEN_EXPIRE_SECONDS,
  });
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";

  const parts = authHeader.split(" ");

  if (parts.length !== 2) {
    return null;
  }

  const type = parts[0];
  const token = parts[1];

  if (type !== "Bearer") {
    return null;
  }

  return token;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      detail: "Missing token",
    });
  }

  try {
    const payload = jwt.verify(token, SECRET_KEY);

    const username = payload.sub;

    if (!username) {
      return res.status(401).json({
        detail: "Invalid token",
      });
    }

    const db = readDb();

    const user = db.users.find((u) => u.username === username);

    if (!user) {
      return res.status(401).json({
        detail: "User not found",
      });
    }

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      detail: "Invalid token",
    });
  }
}

// ── Register route ──────────────────────────
app.post("/auth/register", async (req, res) => {
  try {
    const { username, password, full_name } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        detail: "Username and password are required",
      });
    }

    const db = readDb();

    const existingUser = db.users.find(
      (user) => user.username === username
    );

    if (existingUser) {
      return res.status(400).json({
        detail: "Username already taken",
      });
    }

    const user = {
      id: uuidv4(),
      username: username,
      full_name: full_name || username,
      password: await hashPassword(password),
      created: new Date().toISOString(),
    };

    db.users.push(user);
    writeDb(db);

    const token = createToken({
      sub: username,
    });

    return res.json({
      access_token: token,
      token_type: "bearer",
      username: user.username,
      full_name: user.full_name,
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      detail: "Registration failed",
    });
  }
});

// ── Login route ─────────────────────────────
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        detail: "Username and password are required",
      });
    }

    const db = readDb();

    const user = db.users.find(
      (user) => user.username === username
    );

    if (!user) {
      return res.status(401).json({
        detail: "Invalid credentials",
      });
    }

    const passwordIsValid = await verifyPassword(
      password,
      user.password
    );

    if (!passwordIsValid) {
      return res.status(401).json({
        detail: "Invalid credentials",
      });
    }

    const token = createToken({
      sub: user.username,
    });

    return res.json({
      access_token: token,
      token_type: "bearer",
      username: user.username,
      full_name: user.full_name,
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      detail: "Login failed",
    });
  }
});

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    console.log("HISTORY USER ID:", req.user.id);
    console.log("HISTORY USERNAME:", req.user.username);

    const data = await callColab("/internal/history", {
      method: "GET",
      headers: {
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
    });

    console.log("COLAB HISTORY:", JSON.stringify(data, null, 2));

    return res.json(data);
  } catch (error) {
    console.error("History error:", error);

    return res.status(500).json({
      detail: error.message || "Failed to fetch history",
    });
  }
});

app.delete("/api/history/:session_id", requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.session_id;

    const data = await callColab(`/internal/history/${sessionId}`, {
      method: "DELETE",
      headers: {
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
    });

    return res.json(data);
  } catch (error) {
    console.error("Delete history error:", error);

    return res.status(500).json({
      detail: error.message || "Failed to delete history",
    });
  }
});

app.post("/api/analyze_job", requireAuth, async (req, res) => {
  try {
    const data = await callColab("/internal/analyze_job", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
      body: JSON.stringify(req.body),
    });

    return res.json(data);
  } catch (error) {
    console.error("Analyze proxy error:", error);

    return res.status(500).json({
      detail: error.message || "Analysis failed",
    });
  }
});

app.post("/api/recommend_jobs", requireAuth, async (req, res) => {
  try {
    const data = await callColab("/internal/recommend_jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
      body: JSON.stringify(req.body),
    });

    return res.json(data);
  } catch (error) {
    console.error("Recommend jobs proxy error:", error);

    return res.status(500).json({
      detail: error.message || "Failed to recommend jobs",
    });
  }
});

app.post("/api/interview/questions", requireAuth, async (req, res) => {
  try {
    const data = await callColab("/internal/interview/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
      body: JSON.stringify(req.body),
    });

    return res.json(data);
  } catch (error) {
    console.error("Interview questions proxy error:", error);

    return res.status(500).json({
      detail: error.message || "Failed to generate interview questions",
    });
  }
});


app.post("/api/interview/evaluate", requireAuth, async (req, res) => {
  try {
    const data = await callColab("/internal/interview/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": req.user.id,
        "x-username": req.user.username,
      },
      body: JSON.stringify(req.body),
    });

    return res.json(data);
  } catch (error) {
    console.error("Interview evaluate proxy error:", error);

    return res.status(500).json({
      detail: error.message || "Failed to evaluate answer",
    });
  }
});

// ── Start server ────────────────────────────
app.listen(8000, () => {
  console.log("✅ Auth server running on http://127.0.0.1:8000");
  console.log("Register: POST http://127.0.0.1:8000/auth/register");
  console.log("Login:    POST http://127.0.0.1:8000/auth/login");
});