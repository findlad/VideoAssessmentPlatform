import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";
import { requireAdminUser } from "@/lib/api/admin-auth";

export async function DELETE(request, { params }) {
  const adminUser = await requireAdminUser(request);

  if (!adminUser) {
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
      revokedBy: adminUser.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return NextResponse.json({ success: true });
}
