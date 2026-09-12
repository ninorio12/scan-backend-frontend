import { cronJobs } from "convex/server";
import { api } from "./_generated/api";
const crons = cronJobs();
crons.daily("sync", { hourUTC: 3, minuteUTC: 0 }, api.leads.syncQuotidien);
crons.daily("mort", { hourUTC: 4, minuteUTC: 0 }, api.leads.fonctionDisparue);
export default crons;
