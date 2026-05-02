// Tiny in-memory ring buffer + HTML renderer for the agent's recent log
// activity. Used so a browser hitting `/agent` (after Caddy strips the
// prefix in the single-box deploy) sees the agent thinking, rather than a
// 404 on Fastify's default no-route page.
//
// Capture is via a Pino write stream wired into Fastify({ logger }) — every
// app.log.* call (and Fastify's internal request/response logs) lands here
// in addition to stdout, so we don't lose any visibility.

import pino, { type DestinationStream, type Logger } from "pino";

const MAX_LINES = 500;
const ring: string[] = [];

const stream: DestinationStream = {
  write(line: string): void {
    ring.push(line);
    while (ring.length > MAX_LINES) ring.shift();
    process.stdout.write(line);
  },
};

export function buildLogger(): Logger {
  return pino({ level: process.env["LOG_LEVEL"] ?? "info" }, stream);
}

interface LogEntry {
  time?: number;
  level?: number;
  msg?: string;
  err?: unknown;
  [k: string]: unknown;
}

const LEVEL: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO ",
  40: "WARN ",
  50: "ERROR",
  60: "FATAL",
};

function formatLine(raw: string): string {
  let obj: LogEntry;
  try {
    obj = JSON.parse(raw);
  } catch {
    return raw.trimEnd();
  }
  const ts = obj.time ? new Date(obj.time).toISOString().slice(11, 23) : "";
  const lvl = LEVEL[obj.level ?? 30] ?? `L${obj.level}`;
  const msg = obj.msg ?? "";
  const extras = Object.entries(obj)
    .filter(([k]) => !["time", "level", "msg", "pid", "hostname", "v"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${ts}  ${lvl}  ${msg}${extras ? "  " + extras : ""}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderLogPage(): string {
  const lines = ring.map(formatLine).map(htmlEscape).join("\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="2">
  <title>phulax agent</title>
  <style>
    body { background:#0c0e12; color:#cfd6e4; font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; margin:0; padding:14px 18px; }
    h1 { font-size:13px; font-weight:600; color:#9aa4b6; margin:0 0 12px; letter-spacing:.04em; text-transform:uppercase; }
    pre { white-space:pre-wrap; word-break:break-word; margin:0; }
    .nav { color:#5b6577; }
    .nav a { color:#7dc7ff; text-decoration:none; margin-right:14px; }
    .nav a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <h1>phulax agent · live tail (refresh 2s, last ${ring.length}/${MAX_LINES})</h1>
  <div class="nav">
    <a href="/agent/health">/health</a>
    <a href="/web/">web dashboard</a>
    <a href="/">keeperhub</a>
  </div>
  <hr style="border:none;border-top:1px solid #1f2530;margin:10px 0;">
  <pre>${lines || "<em>no log activity yet — agent just booted</em>"}</pre>
</body>
</html>
`;
}
