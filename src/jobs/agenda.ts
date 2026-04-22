import Agenda from "agenda";
import dotenv from "dotenv";
dotenv.config();

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI!,
    collection: "agendaJobs",
  },
  processEvery: "30 seconds",
  maxConcurrency: 5,
  defaultConcurrency: 2,
});

agenda.on("ready", () => console.log("Agenda started and ready"));
agenda.on("error", (err: any) => console.error("Agenda error:", err));

export default agenda;
