import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getBootstrapData } from "./api/bootstrap.js";
const { Pool } = pg;
const root = fileURLToPath(new URL(".", import.meta.url));
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  if (req.url === "/api/bootstrap") {
    try { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(await getBootstrapData())); }
    catch { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Could not load game data." })); }
    return;
  }
  if (req.url === "/api/db/health") {
    try { if (!pool) throw new Error("DATABASE_URL is not configured"); await pool.query("select 1"); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ connected: true })); }
    catch (error) { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ connected: false, error: error.message })); }
    return;
  }
  try { const path = req.url === "/" ? "/index.html" : req.url.split("?")[0]; const body = await readFile(join(root, "dist", path)); res.writeHead(200); res.end(body); }
  catch { const body = await readFile(join(root, "dist", "index.html")); res.writeHead(200, { "Content-Type": "text/html" }); res.end(body); }
}).listen(port, () => console.log(`Pokedole listening on ${port}`));
