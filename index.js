#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { env, exit, stdin } = process;

const AUTH_PATH = path.join(os.homedir(), ".grok", "auth.json");

function readAuthToken() {
  const raw = fs.readFileSync(AUTH_PATH, "utf8");
  const auth = JSON.parse(raw);
  const entries = Object.values(auth);
  const tokenEntry = entries.find(
    (entry) => entry && typeof entry.key === "string" && entry.key.length > 0,
  );

  if (!tokenEntry) {
    throw new Error(`No key field found in ${AUTH_PATH}`);
  }

  return tokenEntry.key;
}

const token = readAuthToken();

if (!token) {
  console.error(
    "Missing token. Set TOKEN, XAI_TOKEN, GROK_TOKEN, or provide auth.json.",
  );
  exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (stdin.isTTY) {
      resolve("");
      return;
    }

    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk;
    });
    stdin.on("end", () => resolve(data));
    stdin.on("error", reject);
  });
}

async function fetchUsage() {
  const url = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-xai-token-auth": "xai-grok-cli",
      Accept: "application/json",
    },
  });

  const text = await response.text();
  try {
    return {
      ok: response.ok,
      status: response.status,
      body: JSON.parse(text),
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  }
}

async function main() {
  const rawInput = await readStdin();
  const event = rawInput.trim()
    ? JSON.parse(rawInput)
    : {
        hookEventName: env.GROK_HOOK_EVENT || "unknown",
        sessionId: env.GROK_SESSION_ID || "",
        cwd: process.cwd(),
        workspaceRoot: env.GROK_WORKSPACE_ROOT || process.cwd(),
      };

  const usage = await fetchUsage();
  const output = {
    hookEventName: event.hookEventName || env.GROK_HOOK_EVENT || "unknown",
    sessionId: event.sessionId || env.GROK_SESSION_ID || "",
    cwd: event.cwd || process.cwd(),
    workspaceRoot:
      event.workspaceRoot || env.GROK_WORKSPACE_ROOT || process.cwd(),
    usage,
  };

  fs.appendFileSync(
    "/tmp/grok-hook.log",
    JSON.stringify(output, null, 2) + "\n",
  );

  if (!usage.ok) {
    exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  exit(1);
});
