import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No .env file: defaults below apply.
}

const env = process.env;
// "npm run dev" uses its own port, so it can run next to a copy that starts at login.
const dev = process.argv.includes('--dev');

export const config = {
  root,
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  dev,
  port: dev ? Number(env.DEV_PORT || 8788) : Number(env.PORT || 8787),
  whisper: {
    bin: env.WHISPER_BIN || 'whisper-cli',
    model: path.resolve(root, env.WHISPER_MODEL || 'models/ggml-base.en.bin'),
  },
  ocrBin: path.join(root, 'bin', 'ocr'),
  /** macOS: also put timed reminders in the Reminders app. Set SYSTEM_REMINDERS=off to keep them inside the assistant. */
  systemReminders: (env.SYSTEM_REMINDERS || 'on').toLowerCase() !== 'off',
  llm: {
    baseUrl: (env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: env.LLM_MODEL || 'qwen2.5:3b',
    apiKey: env.LLM_API_KEY || 'ollama',
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 120_000),
  },
};
