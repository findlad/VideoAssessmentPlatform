import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const questionIndex = Number(body.questionIndex);

  if (!token || !Number.isInteger(questionIndex) || questionIndex < 0) {
    return NextResponse.json(
      { error: "A valid token and questionIndex are required." },
      { status: 400 },
    );
  }

  const { db } = getAdminServices();
  const snapshot = await db
    .collection("questions")
    .where("accessToken", "==", token)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return NextResponse.json(
      { error: "Assessment not found." },
      { status: 404 },
    );
  }

  const doc = snapshot.docs[0];
  const assessment = doc.data();
  const expiresAt = assessment.expiresAt?.toDate?.() || null;
  const responseCount = assessment.responseCount || 0;
  const questions = assessment.questions || [];

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    await doc.ref.set(
      {
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json(
      { error: "This assessment link has expired." },
      { status: 410 },
    );
  }

  if (questionIndex >= questions.length) {
    return NextResponse.json(
      { error: "Question not found." },
      { status: 404 },
    );
  }

  if (questionIndex > responseCount) {
    return NextResponse.json(
      { error: "Questions must be answered in order." },
      { status: 409 },
    );
  }

  if (["completed", "reviewed", "responded"].includes(assessment.status)) {
    return NextResponse.json(
      { error: "This assessment has already been submitted." },
      { status: 409 },
    );
  }

  if (assessment.status === "invited" || assessment.status === "requested") {
    await doc.ref.set(
      {
        status: "in-progress",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  const setting = assessment.questionSettings?.[questionIndex] || {};

  return NextResponse.json({
    assessmentId: doc.id,
    question: {
      attemptsAllowed: setting.attemptsAllowed || 1,
      maxDurationSeconds: setting.maxDurationSeconds || 60,
      question: questions[questionIndex],
      questionIndex,
    },
  });
}
