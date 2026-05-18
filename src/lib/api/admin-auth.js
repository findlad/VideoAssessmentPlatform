import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";

export function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  return scheme?.toLowerCase() === "bearer" ? token || "" : "";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function requireAdminUser(request) {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  const { auth, db } = getAdminServices();
  const decodedToken = await auth.verifyIdToken(token);
  const email = normalizeEmail(decodedToken.email);
  const initialAdminEmail = normalizeEmail(process.env.INITIAL_ADMIN_EMAIL);
  const userRef = db.collection("users").doc(decodedToken.uid);
  const userSnapshot = await userRef.get();

  if (userSnapshot.exists) {
    const userData = userSnapshot.data();

    if (userData?.role === "admin" && !userData?.revokedAt) {
      await userRef.set(
        {
          email,
          lastLoginAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        email,
        role: "admin",
        uid: decodedToken.uid,
      };
    }

    return null;
  }

  if (initialAdminEmail && email && email === initialAdminEmail) {
    await userRef.set({
      createdAt: FieldValue.serverTimestamp(),
      email,
      lastLoginAt: FieldValue.serverTimestamp(),
      role: "admin",
      source: "initial-admin-bootstrap",
      uid: decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      email,
      role: "admin",
      uid: decodedToken.uid,
    };
  }

  return null;
}
