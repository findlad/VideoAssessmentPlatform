import { NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";

export async function GET(request) {
  const token = request.nextUrl.searchParams.get("token") || "";

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
  const data = doc.data();
  const expiresAt = data.expiresAt?.toDate?.() || null;

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    await doc.ref.set(
      {
        status: "expired",
      },
      { merge: true },
    );

    return NextResponse.json(
      {
        code: "ASSESSMENT_EXPIRED",
        error:
          "This assessment link has expired. Please contact the person who sent it.",
      },
      { status: 410 },
    );
  }

  return NextResponse.json({
    assessment: {
      id: doc.id,
      assessmentDescription: data.assessmentDescription || "",
      candidateEmail: data.candidateEmail || data.targetEmail || "",
      candidateName: data.candidateName || data.intervieweeName || "",
      interviewTitle: data.interviewTitle || "",
      expiresAt: expiresAt?.toISOString() || null,
      questionCount: data.questionCount || data.questions?.length || 0,
      questionSettings: (data.questionSettings || []).map((setting) => ({
        attemptsAllowed: setting.attemptsAllowed || 1,
        maxDurationSeconds: setting.maxDurationSeconds || 60,
        questionIndex: setting.questionIndex,
      })),
      responseCount: data.responseCount || 0,
      status: data.status || "invited",
    },
  });
}
