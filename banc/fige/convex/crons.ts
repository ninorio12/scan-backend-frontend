import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Rappel des visites du lendemain, envoyé en fin de journée.
crons.daily(
  "rappel-visites-demain",
  { hourUTC: 18, minuteUTC: 0 },
  api.visites.rappelVisitesDemain,
  {}
);

export default crons;
