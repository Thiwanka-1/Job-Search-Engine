// api/models/jobModel.js
import { z } from "zod";

/**
 * Normalized job shape (what OUR system uses everywhere)
 * We keep both:
 * - sourceUrl: where we found it (API/aggregator)
 * - companyUrl: the best "original company job description page" URL (target)
 */
export const normalizedJobSchema = z.object({
  id: z.string().trim().min(1),                // stable id per source
  source: z.string().trim().min(1),            // e.g., "greenhouse", "remotive", "adzuna"
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),

  industry: z.string().trim().optional(),
  workType: z.enum(["remote", "onsite", "hybrid", "unknown"]).default("unknown"),

  country: z.string().trim().optional(),
  city: z.string().trim().optional(),

  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  salaryCurrency: z.string().trim().optional(), // "USD", "LKR", etc.
  salaryPeriod: z.enum(["year", "month", "hour", "unknown"]).default("unknown"),

  postedAt: z.string().trim().optional(),      // ISO string
  description: z.string().optional(),

  sourceUrl: z.string().url(),                 // where we got it from
  companyUrl: z.string().url().optional(),     // ORIGINAL job post page (best effort)
});

function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function toISO(dateLike) {
  if (!dateLike) return undefined;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function mapWorkType(v) {
  const s = cleanStr(v).toLowerCase();
  if (!s) return "unknown";
  if (s.includes("remote")) return "remote";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("on-site") || s.includes("onsite") || s.includes("on site")) return "onsite";
  return "unknown";
}

/**
 * Normalize any raw job object from a source into our normalizedJobSchema.
 * `source` MUST be passed ("greenhouse", "remotive", etc.)
 */
export function normalizeJob(raw, source) {
  // ---- defaults (best effort for unknown sources) ----
  const base = {
    id: cleanStr(raw?.id || raw?.job_id || raw?.uuid || raw?.hash || ""),
    source: cleanStr(source),
    title: cleanStr(raw?.title || raw?.job_title || raw?.position || ""),
    company: cleanStr(raw?.company || raw?.company_name || raw?.employer_name || ""),

    industry: cleanStr(raw?.industry || raw?.category || raw?.sector || "") || undefined,
    workType: mapWorkType(raw?.workType || raw?.work_type || raw?.location_type),

    country: cleanStr(raw?.country || raw?.candidate_required_location || raw?.location_country || "") || undefined,
    city: cleanStr(raw?.city || raw?.location_city || "") || undefined,

    salaryMin: typeof raw?.salaryMin === "number" ? raw.salaryMin : undefined,
    salaryMax: typeof raw?.salaryMax === "number" ? raw.salaryMax : undefined,
    salaryCurrency: cleanStr(raw?.salaryCurrency || raw?.currency || "") || undefined,
    salaryPeriod: "unknown",

    postedAt: toISO(raw?.postedAt || raw?.publication_date || raw?.created_at || raw?.updated_at),
    description: cleanStr(raw?.description || raw?.job_description || raw?.content) || undefined,

    sourceUrl: cleanStr(raw?.sourceUrl || raw?.url || raw?.job_url || raw?.apply_url || ""),
    companyUrl: cleanStr(raw?.companyUrl || raw?.company_job_url || raw?.redirect_url || "") || undefined,
  };

  // ---- small salary period inference if available ----
  const period = cleanStr(raw?.salaryPeriod || raw?.salary_period || "").toLowerCase();
  if (period.includes("year") || period.includes("annual")) base.salaryPeriod = "year";
  else if (period.includes("month")) base.salaryPeriod = "month";
  else if (period.includes("hour")) base.salaryPeriod = "hour";

  // ---- safety: ensure URLs valid, else throw clean error ----
  // If sourceUrl missing, we will fail here (as intended)
  const parsed = normalizedJobSchema.safeParse(base);

  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "job"}: ${i.message}`)
      .join("; ");
    throw new Error(`normalizeJob failed (${source}): ${msg}`);
  }

  return parsed.data;
}
