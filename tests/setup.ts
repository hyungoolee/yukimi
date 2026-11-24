import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every test file gets its own empty data folder, seeded from data/seed on first read.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "yukimi-test-"));
process.env.WEATHER_SOURCE = "saved";
process.env.DEMO_MODE = "1";
process.env.APP_SECRET = "test-app-secret";
process.env.ELEVENLABS_WEBHOOK_SECRET = "test-webhook-secret";
process.env.LINE_CHANNEL_SECRET = "test-line-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-line-token";
