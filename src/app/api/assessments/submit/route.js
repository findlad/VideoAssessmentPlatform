import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";

const senderEmail = process.env.NEXT_PUBLIC_EMAIL_FROM_ADDRESS;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json(
      { error: "Missing assessment token." },
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

  if ((assessment.responseCount || 0) < (assessment.questionCount || 0)) {
    return NextResponse.json(
      { error: "All questions must be answered before submitting." },
      { status: 409 },
    );
  }

  if (assessment.status === "completed" || assessment.status === "reviewed") {
    return NextResponse.json({ success: true });
  }

  const submittedAt = FieldValue.serverTimestamp();

  await doc.ref.set(
    {
      status: "completed",
      submittedAt,
      updatedAt: submittedAt,
    },
    { merge: true },
  );

  const candidateEmail = assessment.candidateEmail || assessment.targetEmail;

  if (candidateEmail) {
    const candidateName =
      assessment.candidateName || assessment.intervieweeName || "there";
    const assessmentTitle = assessment.interviewTitle || "your video interview";
    const safeCandidateName = escapeHtml(candidateName);
    const safeAssessmentTitle = escapeHtml(assessmentTitle);
    const mailRequest = {
      to: [candidateEmail],
      metadata: {
        type: "assessment-completed",
        fileName: doc.id,
        questionFileId: doc.id,
        interviewTitle: assessmentTitle,
        intervieweeName: candidateName,
        targetEmail: candidateEmail,
      },
      message: {
        subject: `${assessmentTitle} submitted`,
        text: `Hello ${candidateName},\n\nThank you. Your assessment for ${assessmentTitle} has been submitted successfully. Your answers have been shared with the reviewer.`,
        html: `<p>Hello ${safeCandidateName},</p>
        <p>Thank you. Your assessment for <strong>${safeAssessmentTitle}</strong> has been submitted successfully.</p>
        <p>Your answers have been shared with the reviewer.</p>`,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (senderEmail) {
      mailRequest.from = senderEmail;
    }

    await db.collection("mail").add(mailRequest);
  }

  return NextResponse.json({ success: true });
}
