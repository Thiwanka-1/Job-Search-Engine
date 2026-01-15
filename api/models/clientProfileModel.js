import { z } from "zod";

const WorkType = z.enum(["remote", "onsite", "hybrid", "any"]).default("any");

export const clientProfileSchema = z.object({
  clientId: z.string().trim().min(1, "clientId is required"),

  // Core profile
  fullName: z.string().trim().min(2).optional(),
  yearsExperience: z.coerce.number().min(0).max(60).optional(),

  // Skills (important)
  skills: z.array(z.string().trim().min(1)).default([]),
  mustHaveSkills: z.array(z.string().trim().min(1)).default([]),
  niceToHaveSkills: z.array(z.string().trim().min(1)).default([]),

  // Preferences
  preferredTitles: z.array(z.string().trim().min(1)).default([]),
  preferredIndustries: z.array(z.string().trim().min(1)).default([]),
  preferredCountries: z.array(z.string().trim().min(1)).default([]),
  preferredCities: z.array(z.string().trim().min(1)).default([]),

  workType: WorkType,

  salaryMin: z.coerce.number().int().nonnegative().optional(),
  salaryMax: z.coerce.number().int().nonnegative().optional(),

  // Optional raw resume text (we can extract skills later)
  resumeText: z.string().max(200000).optional(),
}).superRefine((data, ctx) => {
  if (
    typeof data.salaryMin === "number" &&
    typeof data.salaryMax === "number" &&
    data.salaryMin > data.salaryMax
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salaryMax"],
      message: "salaryMax must be >= salaryMin",
    });
  }
});
