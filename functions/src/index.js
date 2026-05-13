const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10
});

initializeApp();

const db = getFirestore();

exports.ping = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before calling ping.");
  }

  return {
    ok: true,
    uid: request.auth.uid,
    received: request.data ?? null,
    timestamp: new Date().toISOString()
  };
});

exports.onAssessmentCreated = onDocumentCreated(
  "assessments/{assessmentId}",
  async (event) => {
    const assessmentId = event.params.assessmentId;
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    await db.collection("assessmentEvents").add({
      assessmentId,
      type: "created",
      createdAt: FieldValue.serverTimestamp()
    });
  }
);
