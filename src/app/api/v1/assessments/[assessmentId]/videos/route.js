import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { getAdminServices } from "@/lib/firebase/admin";

const SIGNED_URL_TTL_SECONDS = Number(
  process.env.VIDEO_SIGNED_URL_TTL_SECONDS || 3600,
);

function jsonError(status, code, message) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

async function logApiRequest(db, data) {
  await db.collection("apiRequestLogs").add({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function getAnswerExtension(answer) {
  if (answer.contentType?.includes("mp4")) {
    return "mp4";
  }

  return answer.storagePath?.split(".").pop() || "webm";
}

export async function GET(request, { params }) {
  const { db, storage } = getAdminServices();
  const { assessmentId } = await params;
  let apiKey = null;

  try {
    apiKey = await authenticateApiKey(db, request);

    if (!apiKey) {
      await logApiRequest(db, {
        assessmentId,
        endpoint: "/api/v1/assessments/{assessment_id}/videos",
        method: "GET",
        status: "failure",
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
      });

      return jsonError(401, "UNAUTHORIZED", "A valid API key is required.");
    }

    const assessmentRef = db.collection("questions").doc(assessmentId);
    const assessmentSnapshot = await assessmentRef.get();

    if (!assessmentSnapshot.exists) {
      await logApiRequest(db, {
        apiKeyId: apiKey.id,
        assessmentId,
        endpoint: "/api/v1/assessments/{assessment_id}/videos",
        method: "GET",
        status: "failure",
        statusCode: 404,
        errorCode: "ASSESSMENT_NOT_FOUND",
      });

      return jsonError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found.");
    }

    const assessment = assessmentSnapshot.data();
    const completed =
      assessment.status === "responded" ||
      assessment.status === "completed" ||
      assessment.status === "reviewed" ||
      (assessment.responseCount || 0) >= (assessment.questionCount || 0);

    if (!completed) {
      await logApiRequest(db, {
        apiKeyId: apiKey.id,
        assessmentId,
        endpoint: "/api/v1/assessments/{assessment_id}/videos",
        method: "GET",
        status: "failure",
        statusCode: 409,
        errorCode: "ASSESSMENT_INCOMPLETE",
      });

      return jsonError(
        409,
        "ASSESSMENT_INCOMPLETE",
        "Assessment is not complete yet.",
      );
    }

    const answersSnapshot = await assessmentRef
      .collection("answers")
      .orderBy("questionIndex", "asc")
      .get();

    if (answersSnapshot.empty) {
      return jsonError(
        404,
        "VIDEOS_NOT_FOUND",
        "No submitted videos were found for this assessment.",
      );
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);
    const bucket = storage.bucket();
    const videos = await Promise.all(
      answersSnapshot.docs.map(async (doc) => {
        const answer = doc.data();
        const [videoUrl] = await bucket.file(answer.storagePath).getSignedUrl({
          action: "read",
          expires: expiresAt,
        });

        return {
          duration: answer.durationSeconds || null,
          expiresAt: expiresAt.toISOString(),
          fileName: `${assessment.candidateName || assessment.intervieweeName || "candidate"}_Q${(answer.questionIndex ?? 0) + 1}.${getAnswerExtension(answer)}`,
          questionNumber: (answer.questionIndex ?? 0) + 1,
          questionText: answer.question || "",
          videoUrl,
        };
      }),
    );

    await logApiRequest(db, {
      apiKeyId: apiKey.id,
      assessmentId,
      candidateEmail: assessment.candidateEmail || assessment.targetEmail || "",
      candidateId: assessment.candidateId || "",
      endpoint: "/api/v1/assessments/{assessment_id}/videos",
      method: "GET",
      status: "success",
      statusCode: 200,
    });

    return NextResponse.json({
      success: true,
      candidate: {
        email: assessment.candidateEmail || assessment.targetEmail || "",
        id: assessment.candidateId || "",
        name: assessment.candidateName || assessment.intervieweeName || "",
      },
      assessment: {
        id: assessmentId,
        submittedAt:
          assessment.submittedAt?.toDate?.()?.toISOString?.() ||
          assessment.updatedAt?.toDate?.()?.toISOString?.() ||
          null,
        title: assessment.interviewTitle || "",
      },
      videos,
    });
  } catch (error) {
    await logApiRequest(db, {
      apiKeyId: apiKey?.id || null,
      assessmentId,
      endpoint: "/api/v1/assessments/{assessment_id}/videos",
      method: "GET",
      status: "failure",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unable to retrieve assessment videos.",
    });

    return jsonError(
      500,
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to retrieve assessment videos.",
    );
  }
}
