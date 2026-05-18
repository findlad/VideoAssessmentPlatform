import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";
import { requireAdminUser } from "@/lib/api/admin-auth";

function hashApiKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeApiKey(doc) {
  const data = doc.data();

  return {
    id: doc.id,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    createdByEmail: data.createdByEmail || "",
    label: data.label || "Untitled key",
    lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString?.() || null,
    revokedAt: data.revokedAt?.toDate?.()?.toISOString?.() || null,
    usageCount: data.usageCount || 0,
  };
}

export async function GET(request) {
  const adminUser = await requireAdminUser(request);

  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = getAdminServices();
  const snapshot = await db
    .collection("apiKeys")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return NextResponse.json({
    apiKeys: snapshot.docs.map(serializeApiKey),
  });
}

export async function POST(request) {
  const adminUser = await requireAdminUser(request);

  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = getAdminServices();
  const body = await request.json().catch(() => ({}));
  const label = normalizeText(body.label) || "External integration";
  const secret = `vap_${crypto.randomBytes(32).toString("base64url")}`;
  const keyRef = await db.collection("apiKeys").add({
    createdAt: FieldValue.serverTimestamp(),
    createdBy: adminUser.uid,
    createdByEmail: adminUser.email || "",
    keyHash: hashApiKey(secret),
    label,
    revokedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
    usageCount: 0,
  });

  const snapshot = await keyRef.get();

  return NextResponse.json(
    {
      apiKey: serializeApiKey(snapshot),
      secret,
    },
    { status: 201 },
  );
}
