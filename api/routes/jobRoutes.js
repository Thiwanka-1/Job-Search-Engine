import express from "express";
import { searchJobs } from "../controllers/jobController.js";

const router = express.Router();

router.post("/search", searchJobs);

export default router;
