// api/utils/matchScore.js
// Deterministic (free) client ↔ job matching score (0–100)
// Returns score + breakdown + reasons so you can explain why a job is "70%+"

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with", "at",
  "from", "by", "as", "is", "are", "be", "this", "that", "we", "you", "your",
  "our", "they", "their", "will", "can", "may", "able", "about", "into",
]);

// Common title synonyms (extend later)
const TITLE_SYNONYMS = [
  ["software engineer", "software developer", "swe", "developer"],
  ["frontend", "front-end", "ui", "react developer", "web developer"],
  ["backend", "back-end", "api", "node developer", "server developer"],
  ["fullstack", "full-stack", "mern"],
  ["devops", "site reliability", "sre", "platform engineer"],
  ["qa", "quality assurance", "test engineer", "automation engineer"],
];

function normalizeText(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9+.#/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s = "") {
  const t = normalizeText(s)
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w));
  return new Set(t);
}

function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function mapTitleToGroup(title = "") {
  const t = normalizeText(title);
  for (const group of TITLE_SYNONYMS) {
    for (const g of group) {
      if (t.includes(g)) return group[0]; // canonical label
    }
  }
  return "";
}

// Extract skills by checking keywords (client-driven, so fast + practical)
function buildSkillSetFromClient(client) {
  const all = new Set();
  for (const s of [...(client.skills || []), ...(client.mustHaveSkills || []), ...(client.niceToHaveSkills || [])]) {
    const ns = normalizeText(s);
    if (ns) all.add(ns);
  }
  return all;
}

function extractMatchedSkills(jobText, skillSet) {
  const text = normalizeText(jobText);
  const matched = new Set();
  for (const sk of skillSet) {
    // allow "c#" "node.js" "react" etc. by simple includes
    if (sk.length >= 2 && text.includes(sk)) matched.add(sk);
  }
  return matched;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {object} client - validated client profile
 * @param {object} job - normalized job object (title, description, location, country, salaryMin, salaryMax, workType, industry, postedAt)
 * @returns {{ score:number, pass:boolean, breakdown:object, reasons:string[], hardReject:boolean }}
 */
export function scoreJobForClient(client, job) {
  const reasons = [];
  const breakdown = {};

  const jobTitle = job?.title || "";
  const jobDesc = job?.description || "";
  const jobIndustry = job?.industry || "";
  const jobWorkType = (job?.workType || "").toLowerCase(); // remote/onsite/hybrid if known
  const jobCountry = (job?.country || "").toLowerCase();
  const jobCity = (job?.city || "").toLowerCase();

  // ---------- 1) Must-have skills (hard gate) ----------
  const mustHave = (client.mustHaveSkills || []).map(normalizeText).filter(Boolean);
  const clientSkillSet = buildSkillSetFromClient(client);
  const jobTextForSkills = `${jobTitle}\n${jobDesc}`;

  const matched = extractMatchedSkills(jobTextForSkills, clientSkillSet);
  const matchedMust = mustHave.filter((s) => matched.has(s));
  const missingMust = mustHave.filter((s) => !matched.has(s));

  breakdown.mustHaveMatched = matchedMust;
  breakdown.mustHaveMissing = missingMust;
  breakdown.skillsMatched = Array.from(matched);

  // If you have must-haves and you're missing too many -> hard reject
  let hardReject = false;
  if (mustHave.length > 0) {
    const mustRatio = matchedMust.length / mustHave.length;
    if (mustRatio < 0.6) {
      hardReject = true;
      reasons.push(
        `Rejected: missing must-have skills (${missingMust.slice(0, 8).join(", ")}${missingMust.length > 8 ? "..." : ""})`
      );
    } else if (missingMust.length > 0) {
      reasons.push(`Warning: missing some must-have skills (${missingMust.join(", ")})`);
    }
    breakdown.mustHaveRatio = mustRatio;
  } else {
    breakdown.mustHaveRatio = null;
  }

  // ---------- 2) Skill score (0–40) ----------
  // Weighted: must-have ratio + overall skill overlap
  const totalSkillsMentioned = clientSkillSet.size || 1;
  const overallRatio = matched.size / totalSkillsMentioned;

  let skillScore = 0;
  if (mustHave.length > 0) {
    const mustRatio = breakdown.mustHaveRatio ?? 0;
    skillScore = (mustRatio * 0.7 + overallRatio * 0.3) * 40;
  } else {
    skillScore = overallRatio * 40;
  }
  skillScore = clamp(skillScore, 0, 40);
  breakdown.skillScore = Math.round(skillScore);

  if (breakdown.skillScore >= 28) reasons.push("Strong skill match");
  else if (breakdown.skillScore >= 18) reasons.push("Moderate skill match");
  else reasons.push("Weak skill match");

  // ---------- 3) Title similarity (0–20) ----------
  const preferredTitles = (client.preferredTitles || []).filter(Boolean);
  let titleScore = 0;

  if (preferredTitles.length > 0) {
    const jobTok = tokens(jobTitle);
    let best = 0;

    for (const t of preferredTitles) {
      const pref = normalizeText(t);
      const prefTok = tokens(pref);

      // token similarity
      const sim = jaccard(jobTok, prefTok);

      // synonym group bonus (frontend/backend/fullstack etc.)
      const jobGroup = mapTitleToGroup(jobTitle);
      const prefGroup = mapTitleToGroup(pref);
      const groupBonus = jobGroup && prefGroup && jobGroup === prefGroup ? 0.25 : 0;

      best = Math.max(best, clamp(sim + groupBonus, 0, 1));
    }
    titleScore = best * 20;
  } else {
    // If no preferred titles, give a small neutral score
    titleScore = 10;
  }

  titleScore = clamp(titleScore, 0, 20);
  breakdown.titleScore = Math.round(titleScore);

  if (breakdown.titleScore >= 16) reasons.push("Title matches preference well");
  else if (breakdown.titleScore >= 10) reasons.push("Title is somewhat relevant");
  else reasons.push("Title relevance is low");

  // ---------- 4) Salary match (0–20) ----------
  // Job salaries are often missing. We handle gracefully.
  const cMin = typeof client.salaryMin === "number" ? client.salaryMin : null;
  const cMax = typeof client.salaryMax === "number" ? client.salaryMax : null;
  const jMin = typeof job.salaryMin === "number" ? job.salaryMin : null;
  const jMax = typeof job.salaryMax === "number" ? job.salaryMax : null;

  let salaryScore = 10; // neutral default if unknown
  if ((cMin || cMax) && (jMin || jMax)) {
    const clientLow = cMin ?? 0;
    const clientHigh = cMax ?? Number.MAX_SAFE_INTEGER;

    const jobLow = jMin ?? jMax ?? 0;
    const jobHigh = jMax ?? jMin ?? Number.MAX_SAFE_INTEGER;

    // overlap fraction of job range with client range
    const overlapLow = Math.max(clientLow, jobLow);
    const overlapHigh = Math.min(clientHigh, jobHigh);
    const overlap = Math.max(0, overlapHigh - overlapLow);

    const jobRange = Math.max(1, jobHigh - jobLow);
    const overlapRatio = overlap / jobRange;

    salaryScore = clamp(overlapRatio * 20, 0, 20);

    if (salaryScore >= 14) reasons.push("Salary range fits preference");
    else if (salaryScore >= 8) reasons.push("Salary range partially fits");
    else reasons.push("Salary likely outside preference");
  } else if (cMin || cMax) {
    salaryScore = 8; // client cares, job unknown
    reasons.push("Salary unknown (cannot confirm fit)");
  } else {
    salaryScore = 10; // client didn’t set salary
  }

  breakdown.salaryScore = Math.round(salaryScore);

  // ---------- 5) Location & work type (0–20) ----------
  // Split 10 for workType, 10 for location
  let workTypeScore = 10;
  const cWork = (client.workType || "any").toLowerCase();

  if (cWork !== "any") {
    if (!jobWorkType) {
      workTypeScore = 6; // unknown
      reasons.push("Work type unknown (cannot confirm remote/onsite/hybrid)");
    } else if (jobWorkType === cWork) {
      workTypeScore = 10;
      reasons.push("Work type matches preference");
    } else {
      workTypeScore = 0;
      reasons.push("Work type does not match preference");
    }
  }

  let locationScore = 10;
  const cCountries = (client.preferredCountries || []).map((x) => normalizeText(x));
  const cCities = (client.preferredCities || []).map((x) => normalizeText(x));

  if (cCountries.length > 0) {
    if (!jobCountry) {
      locationScore = 6;
      reasons.push("Country unknown (cannot confirm location)");
    } else if (cCountries.includes(jobCountry)) {
      locationScore = 10;
      reasons.push("Country matches preference");
    } else {
      locationScore = 0;
      reasons.push("Country does not match preference");
    }
  }

  if (locationScore > 0 && cCities.length > 0) {
    if (!jobCity) {
      locationScore = Math.min(locationScore, 8);
      reasons.push("City unknown (cannot confirm city)");
    } else if (cCities.includes(jobCity)) {
      locationScore = Math.min(10, locationScore + 2);
      reasons.push("City matches preference");
    } else {
      locationScore = Math.max(0, locationScore - 4);
      reasons.push("City differs from preference");
    }
  }

  const locWorkScore = clamp(workTypeScore + locationScore, 0, 20);
  breakdown.locationWorkScore = Math.round(locWorkScore);

  // ---------- 6) Industry preference (0–10) ----------
  const prefIndustries = (client.preferredIndustries || []).map(normalizeText).filter(Boolean);
  let industryScore = 5;

  if (prefIndustries.length > 0) {
    const ji = normalizeText(jobIndustry);
    if (!ji) {
      industryScore = 4;
      reasons.push("Industry unknown (cannot confirm fit)");
    } else if (prefIndustries.some((p) => ji.includes(p) || p.includes(ji))) {
      industryScore = 10;
      reasons.push("Industry matches preference");
    } else {
      industryScore = 2;
      reasons.push("Industry may not match preference");
    }
  }

  breakdown.industryScore = Math.round(industryScore);

  // ---------- Final score ----------
  const raw =
    skillScore +
    titleScore +
    salaryScore +
    locWorkScore +
    industryScore;

  // If hardReject, cap score to make sure it never passes 70
  const score = hardReject ? Math.min(49, Math.round(raw)) : Math.round(raw);
  const pass = score >= 70 && !hardReject;

  return {
    score,
    pass,
    hardReject,
    breakdown,
    reasons,
  };
}
