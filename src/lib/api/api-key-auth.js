import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  return scheme?.toLowerCase() === "bearer" ? token || "" : "";
}

function timingSafeStringEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    crypto.timingSafeEqual(firstBuffer, secondBuffer)
  );
}

export async function authenticateApiKey(db, request) {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  const tokenHash = sha256(token);
  const envKeys = (process.env.INTAKE_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const matchedEnvKey = envKeys.find((key) =>
    key.startsWith("sha256:")
      ? timingSafeStringEqual(key.slice("sha256:".length), tokenHash)
      : timingSafeStringEqual(key, token),
  );

  if (matchedEnvKey) {
    return {
      id: "env",
      label: "Environment API key",
      keyHash: tokenHash,
      source: "env",
    };
  }

  const snapshot = await db
    .collection("apiKeys")
    .where("keyHash", "==", tokenHash)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const apiKey = doc.data();

  if (apiKey.revokedAt) {
    return null;
  }

  await doc.ref.set(
    {
      lastUsedAt: FieldValue.serverTimestamp(),
      usageCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    id: doc.id,
    label: apiKey.label || "API key",
    keyHash: tokenHash,
    source: "firestore",
  };
}
