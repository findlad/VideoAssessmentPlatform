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

function isSelfSignupEnabled() {
  return process.env.ALLOW_ADMIN_SELF_SIGNUP === "true";
}

async function grantAdminAccess(userRef, decodedToken, email, source) {
  await userRef.set(
    {
      email,
      lastLoginAt: FieldValue.serverTimestamp(),
      role: "admin",
      source,
      uid: decodedToken.uid,
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

    if (userData?.revokedAt) {
      return null;
    }

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

    if (email && isSelfSignupEnabled()) {
      return grantAdminAccess(
        userRef,
        decodedToken,
        email,
        "self-signup-upgrade",
      );
    }

    return null;
  }

  if (
    email &&
    (isSelfSignupEnabled() || (initialAdminEmail && email === initialAdminEmail))
  ) {
    await userRef.set({
      createdAt: FieldValue.serverTimestamp(),
      email,
    });

    return grantAdminAccess(
      userRef,
      decodedToken,
      email,
      isSelfSignupEnabled() ? "self-signup" : "initial-admin-bootstrap",
    );
  }

  return null;
}
