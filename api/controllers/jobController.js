import { jobSearchSchema } from "../models/jobSearchModel.js";
import { clientProfileSchema } from "../models/clientProfileModel.js";
import { fetchGreenhouseJobs } from "../services/greenhouseService.js";
import { scoreJobForClient } from "../utils/matchScore.js";

// --- helpers ---
function stripHtml(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function includesCI(hay = "", needle = "") {
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
}

function normalizeCI(s = "") {
  return String(s).trim().toLowerCase();
}

function isFreshEnough(postedAtIso, freshness) {
  if (!postedAtIso || freshness === "any") return true;
  const posted = new Date(postedAtIso);
  if (Number.isNaN(posted.getTime())) return true;

  const now = new Date();
  const diffMs = now.getTime() - posted.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (freshness === "today") return diffDays <= 1.0;
  if (freshness === "week") return diffDays <= 7.0;
  if (freshness === "month") return diffDays <= 30.0;
  return true;
}

function countryMatches(job, targetCountry, allowRemoteUnknownCountry = true) {
  const tc = normalizeCI(targetCountry);
  const jc = normalizeCI(job.country || "");

  if (!tc) return true;

  // If job is remote and country is unknown, allow it (useful for remote searches)
  if (allowRemoteUnknownCountry && job.workType === "remote" && !jc) return true;

  return jc === tc;
}

function cityMatches(job, targetCity) {
  if (!targetCity) return true;
  const tc = normalizeCI(targetCity);
  const jc = normalizeCI(job.city || "");
  if (!jc) return false;
  return jc === tc;
}

// POST /api/jobs/search
export const searchJobs = async (req, res) => {
  try {
    // 1) Validate search filters
    const parsedFilters = jobSearchSchema.safeParse(req.body);
    if (!parsedFilters.success) {
      return res.status(400).json({
        ok: false,
        message: "Invalid search filters",
        errors: parsedFilters.error.issues.map((i) => ({
          field: i.path.join(".") || "body",
          message: i.message,
        })),
      });
    }
    const filters = parsedFilters.data;

    // 2) Optional client profile (for 70%+ matching)
    let clientProfile = null;
    if (req.body?.clientProfile) {
      const parsedClient = clientProfileSchema.safeParse(req.body.clientProfile);
      if (!parsedClient.success) {
        return res.status(400).json({
          ok: false,
          message: "Invalid clientProfile",
          errors: parsedClient.error.issues.map((i) => ({
            field: `clientProfile.${i.path.join(".") || ""}`.replace(/\.$/, ""),
            message: i.message,
          })),
        });
      }
      clientProfile = parsedClient.data;
    }

    // 3) Decide which Greenhouse boards to query
    // You can pass in the request:
    //   { "greenhouseBoards": ["stripe","airbnb"] }
    // OR set in .env:
    //   GREENHOUSE_BOARDS=stripe,airbnb
    const boardsFromBody = Array.isArray(req.body?.greenhouseBoards)
      ? req.body.greenhouseBoards.map((b) => String(b).trim()).filter(Boolean)
      : [];

    const boardsFromEnv = String(process.env.GREENHOUSE_BOARDS || "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);

    const boards = boardsFromBody.length > 0 ? boardsFromBody : boardsFromEnv;

    if (boards.length === 0) {
      return res.status(400).json({
        ok: false,
        message:
          "No Greenhouse boards provided. Send greenhouseBoards in request OR set GREENHOUSE_BOARDS in .env (comma-separated).",
        example: {
          greenhouseBoards: ["stripe", "airbnb"],
        },
      });
    }

    // 4) Fetch jobs from all boards (parallel)
    const jobLists = await Promise.all(
      boards.map((b) => fetchGreenhouseJobs(b, { includeContent: true }))
    );

    // flatten
    let jobs = jobLists.flat();

    // 5) Apply user filters (NOT the AI match yet)
    jobs = jobs.filter((job) => {
      // Title must include jobTitle text (simple, fast)
      if (!includesCI(job.title, filters.jobTitle)) return false;

      // Industry (Greenhouse often unknown; if filter given, require match if present)
      if (filters.industry) {
        if (!job.industry) return false;
        if (!includesCI(job.industry, filters.industry)) return false;
      }

      // Work type
      if (filters.workType) {
        if (job.workType === "unknown") return false;
        if (job.workType !== filters.workType) return false;
      }

      // Freshness
      if (!isFreshEnough(job.postedAt, filters.freshness)) return false;

      // Country (allow remote unknown country)
      if (!countryMatches(job, filters.country, true)) return false;

      // City (optional)
      if (!cityMatches(job, filters.city)) return false;

      return true;
    });

    // 6) If clientProfile present => score and filter to 70+
    let results = [];
    if (clientProfile) {
      results = jobs
        .map((job) => {
          const jobForScoring = {
            ...job,
            description: stripHtml(job.description || ""),
          };

          const scored = scoreJobForClient(clientProfile, jobForScoring);

          return {
            ...job,
            matchScore: scored.score,
            pass: scored.pass,
            reasons: scored.reasons,
            breakdown: scored.breakdown,
          };
        })
        .filter((j) => j.pass) // keep only >=70 and not hard-reject
        .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    } else {
      // No client profile => just return filtered jobs with no score
      results = jobs.map((j) => ({
        ...j,
        matchScore: null,
        pass: null,
        reasons: [],
        breakdown: {},
      }));
    }

    // 7) Limit
    results = results.slice(0, filters.limit);

    return res.json({
      ok: true,
      filters,
      boardsUsed: boards,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("searchJobs error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};
