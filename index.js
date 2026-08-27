#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exit } = process;

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
  const usage = await fetchUsage();
  const output = usage.body;

  if (!usage.ok) {
    exit(1);
  }

  fs.writeFileSync(
    "/tmp/grok-hook.log",
    JSON.stringify(output, null, 2) + "\n",
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  exit(1);
});
