import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { config } from "../config";

mkdirSync(config.dataDir, { recursive: true });

const dbPath = `${config.dataDir}/shareque.db`;
export const db = new Database(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
