#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exit } = process;

const AUTH_PATH = path.join(os.homedir(), ".grok", "auth.json");
const DEFAULT_OBJECT_KEY = "output/latest.json";
const REGION = process.env.R2_REGION || "auto";
const SERVICE = "s3";

function readAuthToken() {
  const explicitToken =
    process.env.TOKEN || process.env.XAI_TOKEN || process.env.GROK_TOKEN;

  if (explicitToken) {
    return explicitToken;
  }

  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error(
      "Missing token. Set TOKEN, XAI_TOKEN, GROK_TOKEN, or provide auth.json.",
    );
  }

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding = undefined) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function getAmzDate(now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return {
    amzDate: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`,
    dateStamp: `${yyyy}${mm}${dd}`,
  };
}

function toR2Url(accountId, bucket, objectKey) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${bucket}/${encodedKey}`;
}

function getSigningKey(secretAccessKey, dateStamp) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function buildAuthorizationHeader({
  accessKeyId,
  secretAccessKey,
  accountId,
  bucket,
  objectKey,
  body,
  contentType,
}) {
  const { amzDate, dateStamp } = getAmzDate();
  const url = new URL(toR2Url(accountId, bucket, objectKey));
  const payloadHash = sha256Hex(body);
  const canonicalUri = url.pathname;
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ]
    .map((line) => `${line}\n`)
    .join("");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp);
  const signature = hmac(signingKey, stringToSign, "hex");

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash,
    url: url.toString(),
  };
}

async function fetchUsage(token) {
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

async function uploadToR2(output) {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = requireEnv("R2_BUCKET");
  const objectKey = process.env.R2_OBJECT_KEY || DEFAULT_OBJECT_KEY;
  const contentType = "application/json; charset=utf-8";
  const body = JSON.stringify(output, null, 2) + "\n";

  // 这里直接覆盖同一个对象，始终只保留最新一份。
  const { authorization, amzDate, payloadHash, url } = buildAuthorizationHeader(
    {
      accessKeyId,
      secretAccessKey,
      accountId,
      bucket,
      objectKey,
      body,
      contentType,
    },
  );

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed (${response.status}): ${errorText}`);
  }
}

async function main() {
  const token = readAuthToken();
  const usage = await fetchUsage(token);

  if (!usage.ok) {
    console.error(JSON.stringify(usage.body, null, 2));
    exit(1);
  }

  await uploadToR2(usage.body);

  const localDebugPath = process.env.LOCAL_DEBUG_PATH || "/tmp/grok-hook.log";
  if (localDebugPath) {
    fs.writeFileSync(
      localDebugPath,
      JSON.stringify(usage.body, null, 2) + "\n",
    );
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  exit(1);
});
