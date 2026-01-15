// api/services/greenhouseService.js
import axios from "axios";
import { normalizeJob } from "../models/jobModel.js";

/**
 * Greenhouse Job Board API:
 * https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=false
 *
 * We keep it FAST: content=false (no big HTML)
 * We still get: id, title, location, updated_at/created_at, absolute_url
 */

// ----- helpers -----
function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

// Extract {city,country,isRemote} from typical location formats
// Examples:
// "New York City, United States"
// "Remote - United States"
// "Remote (Canada)"
// "Remote"
function parseLocation(locName = "") {
  const raw = cleanStr(locName);
  if (!raw) return { city: undefined, country: undefined, isRemote: false };

  const lower = raw.toLowerCase();
  const isRemote = lower.includes("remote");

  // Remove "Remote -" prefix and "(Remote...)" brackets for clean splitting
  const cleaned = raw
    .replace(/\(.*remote.*\)/i, "")
    .replace(/remote\s*[-–]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Split by comma
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);

  // If only "Remote" left
  if (parts.length === 1 && parts[0].toLowerCase() === "remote") {
    return { city: undefined, country: undefined, isRemote: true };
  }

  // Common "City, Country"
  if (parts.length >= 2) {
    return { city: parts[0], country: parts[parts.length - 1], isRemote };
  }

  // Common "Country"
  if (parts.length === 1) {
    return { city: undefined, country: parts[0], isRemote };
  }

  return { city: undefined, country: undefined, isRemote };
}

function inferWorkType(locationName = "") {
  const lower = cleanStr(locationName).toLowerCase();
  if (lower.includes("remote")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  return "onsite";
}

/**
 * Fetch jobs from a Greenhouse board and return normalized jobs.
 * @param {string} board greenhouse board name (e.g., "stripe")
 * @param {{ includeContent?: boolean }} options
 */
export async function fetchGreenhouseJobs(board, options = {}) {
  const includeContent = options.includeContent ?? false; // ✅ default FAST

  const b = cleanStr(board);
  if (!b) throw new Error("fetchGreenhouseJobs: board is required");

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    b
  )}/jobs?content=${includeContent ? "true" : "false"}`;

  const { data } = await axios.get(apiUrl, {
    timeout: 20000,
    headers: {
      "User-Agent": "job-search-api/1.0",
      Accept: "application/json",
    },
  });

  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

  return jobs.map((j) => {
    const locName = cleanStr(j?.location?.name);

    const { city, country, isRemote } = parseLocation(locName);

    // This is the direct job post page on the company's Greenhouse board
    // (in your Stripe example it's already the perfect original link)
    const companyUrl = cleanStr(j?.absolute_url) || undefined;

    // If Greenhouse provides company name inside job object (sometimes it does),
    // use it. Otherwise fallback to board name.
    const companyName =
      cleanStr(j?.company?.name) ||
      cleanStr(j?.departments?.[0]?.name) || // fallback (not perfect)
      b;

    // We do NOT send description for now (fast + you said not needed)
    return normalizeJob(
      {
        id: String(j?.id ?? ""),
        title: cleanStr(j?.title),
        company: companyName,

        workType: isRemote ? "remote" : inferWorkType(locName),

        country,
        city,

        postedAt: j?.updated_at || j?.created_at,

        description: undefined, // ✅ intentionally excluded

        sourceUrl: apiUrl,
        companyUrl,
      },
      "greenhouse"
    );
  });
}
