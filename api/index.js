import express from "express";
import cors from "cors";
import "dotenv/config";

import jobRoutes from "./routes/jobRoutes.js";

const app = express();

// ===== Middleware =====
app.use(cors());
app.use(express.json());




// ===== Health Check =====
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "job-search-api",
    time: new Date().toISOString(),
  });
});

// ===== Routes =====
app.use("/api/jobs", jobRoutes);

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Route not found" });
});

// ===== Server Start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
});
