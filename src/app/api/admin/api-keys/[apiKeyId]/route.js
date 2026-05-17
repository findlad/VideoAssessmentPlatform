import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";

function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  return scheme?.toLowerCase() === "bearer" ? token || "" : "";
}

async function requireAdminUser(request) {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  const { auth } = getAdminServices();

  return auth.verifyIdToken(token);
}

export async function DELETE(request, { params }) {
  const decodedToken = await requireAdminUser(request);

  if (!decodedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = getAdminServices();
  const { apiKeyId } = await params;
  const apiKeyRef = db.collection("apiKeys").doc(apiKeyId);
  const snapshot = await apiKeyRef.get();

  if (!snapshot.exists) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  await apiKeyRef.set(
    {
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return NextResponse.json({ success: true });
}
