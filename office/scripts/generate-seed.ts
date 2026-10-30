import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSeedSql } from "../src/lib/db/seed";

const target = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
writeFileSync(target, buildSeedSql());
console.log(`Seed generado en ${target}`);
