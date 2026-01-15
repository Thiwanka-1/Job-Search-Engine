import axios from "axios";
import { normalizeJob } from "../models/jobModel.js";

const ADZUNA_BASE = "https://api.adzuna.com/v1/api";

function cleanStr(v) {
  return String(v ?? "").trim();
}

/**
 * Adzuna uses country codes in URL like:
 * /jobs/us/search/1
 * /jobs/gb/search/1
 *
 * NOTE: Sri Lanka is not reliably supported in Adzuna public jobs API.
 */
function toAdzunaCountryCode(countryName = "") {
  const c = countryName.toLowerCase().trim();
  const map = {
    "united states": "us",
    "usa": "us",
    "uk": "gb",
    "united kingdom": "gb",
    "canada": "ca",
    "australia": "au",
    "india": "in",
    "france": "fr",
    "germany": "de",
    "netherlands": "nl",
    "new zealand": "nz",
    "singapore": "sg",
    "south africa": "za",
    "italy": "it",
    "spain": "es",
    "mexico": "mx",
    "brazil": "br",
    "poland": "pl",
    "belgium": "be",
    "switzerland": "ch",
    "austria": "at",
  };
  return map[c] || null;
}

/**
 * Follow Adzuna redirect_url to get final company/ATS URL.
 * Some sites block HEAD, so we use GET with low redirects.
 */
async function resolveFinalUrl(adzunaRedirectUrl) {
  try {
    const res = await axios.get(adzunaRedirectUrl, {
      timeout: 15000,
      maxRedirects: 6,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        "User-Agent": "job-search-api/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    // In Node, axios usually exposes final URL here:
    const finalUrl =
      res?.request?.res?.responseUrl ||
      res?.headers?.location ||
      adzunaRedirectUrl;

    return finalUrl;
  } catch {
    return adzunaRedirectUrl;
  }
}

/**
 * Fetch jobs from Adzuna (industry-wide source)
 * @param {{
 *  jobTitle: string,
 *  country: string,
 *  city?: string,
 *  salaryMin?: number,
 *  salaryMax?: number,
 *  limit?: number,
 *  industryTag?: string  // e.g. "it-jobs" (Adzuna category tag)
 * }} filters
 */
export async function fetchAdzunaJobs(filters) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    throw new Error("Missing ADZUNA_APP_ID / ADZUNA_APP_KEY in .env");
  }

  const countryCode = toAdzunaCountryCode(filters.country);
  if (!countryCode) {
    return []; // country not supported by our mapping
  }

  const page = 1;
  const resultsPerPage = Math.min(Number(filters.limit || 20), 50);

  const url = `${ADZUNA_BASE}/jobs/${countryCode}/search/${page}`;

  const params = {
    app_id: appId,
    app_key: appKey,
    "content-type": "application/json",
    results_per_page: resultsPerPage,

    // title keywords
    what: cleanStr(filters.jobTitle),

    // optional location filter (city/region)
    ...(filters.city ? { where: cleanStr(filters.city) } : {}),

    // salary filters (Adzuna supports salary_min)
    ...(typeof filters.salaryMin === "number"
      ? { salary_min: Math.floor(filters.salaryMin) }
      : {}),

    // category tag (industry)
    ...(filters.industryTag ? { category: cleanStr(filters.industryTag) } : {}),
  };

  const { data } = await axios.get(url, {
    timeout: 20000,
    params,
    headers: {
      "User-Agent": "job-search-api/1.0",
      Accept: "application/json",
    },
  });

  const results = Array.isArray(data?.results) ? data.results : [];

  // Resolve redirect_url -> final URL (company/ATS)
  const mapped = await Promise.all(
    results.map(async (r) => {
      const company = r?.company?.display_name || "unknown";
      const title = r?.title || "";
      const locationName = r?.location?.display_name || "";
      const redirectUrl = r?.redirect_url || "";

      const finalUrl = redirectUrl ? await resolveFinalUrl(redirectUrl) : undefined;

      // Adzuna returns salary_min/max sometimes
      const salaryMin = typeof r?.salary_min === "number" ? r.salary_min : undefined;
      const salaryMax = typeof r?.salary_max === "number" ? r.salary_max : undefined;

      // Adzuna doesn’t standardize workType well; leave unknown for now
      return normalizeJob(
        {
          id: String(r?.id ?? ""),
          title: cleanStr(title),
          company: cleanStr(company),

          country: cleanStr(filters.country),
          city: cleanStr(locationName) || undefined,

          salaryMin,
          salaryMax,
          salaryPeriod: "year", // Adzuna salaries are commonly yearly ranges (not guaranteed)

          postedAt: r?.created || undefined,

          description: undefined,

          sourceUrl: url,
          companyUrl: finalUrl,
          workType: "unknown",
        },
        "adzuna"
      );
    })
  );

  return mapped;
}
