import { z } from "zod";

// Allowed enums
const WorkType = z.enum(["remote", "onsite", "hybrid"]);
const Freshness = z.enum(["today", "week", "month", "any"]);

// Main schema
export const jobSearchSchema = z
  .object({
    jobTitle: z.string().trim().min(2, "jobTitle is required"),
    industry: z.string().trim().min(2).optional(),

    salaryMin: z.coerce.number().int().nonnegative().optional(),
    salaryMax: z.coerce.number().int().nonnegative().optional(),

    workType: WorkType.optional(),
    freshness: Freshness.default("any"),

    city: z.string().trim().min(2).optional(),
    country: z.string().trim().min(2, "country is required"),

    // ✅ NEW (important)
    allowRemoteGlobal: z.coerce.boolean().default(true),

    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine((data, ctx) => {
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


// Helper: parse + normalize
export function parseJobSearch(body) {
  return jobSearchSchema.parse(body);
}
