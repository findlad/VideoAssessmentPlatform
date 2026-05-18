import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import {
  authenticateApiKey,
  sha256,
} from "@/lib/api/api-key-auth";
import { getAdminServices } from "@/lib/firebase/admin";

const MAX_QUESTIONS = 6;
const DEFAULT_ATTEMPTS_ALLOWED = 1;
const DEFAULT_MAX_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 300;
const LINK_EXPIRY_DAYS = Number(process.env.ASSESSMENT_LINK_EXPIRY_DAYS || 7);
const DUPLICATE_WINDOW_SECONDS = Number(
  process.env.INTAKE_DUPLICATE_WINDOW_SECONDS || 300,
);
const senderEmail = process.env.NEXT_PUBLIC_EMAIL_FROM_ADDRESS;

function jsonError(status, code, message, details = undefined) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getAssessmentLink(request, assessmentId) {
  const configuredOrigin = process.env.NEXT_PUBLIC_DEPLOYMENT_URL;
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const origin = configuredOrigin || (host ? `${protocol}://${host}` : "");

  if (!origin) {
    return `/interview?token=${encodeURIComponent(assessmentId)}`;
  }

  return `${origin}/interview?token=${encodeURIComponent(assessmentId)}`;
}

function createAccessToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((question) => ({
      attemptsAllowed: Math.max(
        1,
        Math.floor(Number(question?.maxAttempts)) || DEFAULT_ATTEMPTS_ALLOWED,
      ),
      maxDurationSeconds: Math.max(
        1,
        Math.min(
          MAX_DURATION_SECONDS,
          Math.floor(Number(question?.maxDurationSeconds)) ||
            DEFAULT_MAX_DURATION_SECONDS,
        ),
      ),
      text: normalizeText(question?.text),
    }))
    .filter((question) => question.text);
}

function validatePayload(body) {
  const candidate = body?.candidate || {};
  const assessment = body?.assessment || {};
  const candidateId = normalizeText(candidate.id);
  const candidateName = normalizeText(candidate.name);
  const candidateEmail = normalizeText(candidate.email).toLowerCase();
  const assessmentTitle = normalizeText(assessment.title);
  const questions = normalizeQuestions(assessment.questions);

  if (!candidateId) {
    return { error: "candidate.id is required" };
  }

  if (!candidateName) {
    return { error: "candidate.name is required" };
  }

  if (!candidateEmail) {
    return { error: "candidate.email is required" };
  }

  if (!isValidEmail(candidateEmail)) {
    return { error: "candidate.email must be a valid email address" };
  }

  if (!assessmentTitle) {
    return { error: "assessment.title is required" };
  }

  if (questions.length === 0) {
    return { error: "assessment.questions must contain at least one question" };
  }

  if (questions.length > MAX_QUESTIONS) {
    return { error: `assessment.questions cannot contain more than ${MAX_QUESTIONS} questions` };
  }

  return {
    value: {
      event: normalizeText(body.event),
      timestamp: normalizeText(body.timestamp),
      candidate: {
        email: candidateEmail,
        id: candidateId,
        name: candidateName,
        phone: normalizeText(candidate.phone),
        resumeUrl: normalizeText(candidate.resumeUrl),
      },
      assessment: {
        description: normalizeText(assessment.description),
        questions,
        title: assessmentTitle,
      },
    },
  };
}

async function findRecentDuplicate(db, payload) {
  if (!DUPLICATE_WINDOW_SECONDS) {
    return null;
  }

  const duplicateKey = sha256(
    [
      payload.candidate.id,
      payload.candidate.email,
      payload.assessment.title,
    ].join("|"),
  );
  const duplicateRef = db.collection("assessmentDedupes").doc(duplicateKey);
  const duplicateSnapshot = await duplicateRef.get();

  if (!duplicateSnapshot.exists) {
    return { duplicateKey, duplicateRef };
  }

  const duplicate = duplicateSnapshot.data();
  const createdAtMillis = duplicate.createdAt?.toMillis?.() || 0;
  const duplicateAgeSeconds = (Date.now() - createdAtMillis) / 1000;

  if (duplicateAgeSeconds <= DUPLICATE_WINDOW_SECONDS) {
    return {
      duplicateAssessmentId: duplicate.assessmentId,
      duplicateKey,
      duplicateRef,
    };
  }

  return { duplicateKey, duplicateRef };
}

async function logApiRequest(db, data) {
  await db.collection("apiRequestLogs").add({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(request) {
  const receivedAt = new Date();
  const { db } = getAdminServices();
  let apiKey = null;
  let requestBody = null;

  try {
    apiKey = await authenticateApiKey(db, request);

    if (!apiKey) {
      await logApiRequest(db, {
        endpoint: "/api/v1/assessments/trigger",
        method: "POST",
        status: "failure",
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
      });

      return jsonError(401, "UNAUTHORIZED", "A valid API key is required.");
    }

    requestBody = await request.json();
    const validation = validatePayload(requestBody);

    if (validation.error) {
      await logApiRequest(db, {
        apiKeyId: apiKey.id,
        endpoint: "/api/v1/assessments/trigger",
        method: "POST",
        status: "failure",
        statusCode: 422,
        errorCode: "INVALID_PAYLOAD",
        errorMessage: validation.error,
      });

      return jsonError(422, "INVALID_PAYLOAD", validation.error);
    }

    const payload = validation.value;
    const duplicate = await findRecentDuplicate(db, payload);

    if (duplicate?.duplicateAssessmentId) {
      await logApiRequest(db, {
        apiKeyId: apiKey.id,
        candidateEmail: payload.candidate.email,
        candidateId: payload.candidate.id,
        endpoint: "/api/v1/assessments/trigger",
        method: "POST",
        status: "failure",
        statusCode: 409,
        errorCode: "DUPLICATE_ASSESSMENT",
        errorMessage: "Recent duplicate assessment request",
      });

      return jsonError(
        409,
        "DUPLICATE_ASSESSMENT",
        "A recent assessment already exists for this candidate and title.",
        { assessmentId: duplicate.duplicateAssessmentId },
      );
    }

    const timestamp = FieldValue.serverTimestamp();
    const accessToken = createAccessToken();
    const expiresAt = new Date(
      Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    const questions = payload.assessment.questions.map(
      (question) => question.text,
    );
    const assessmentRef = await db.collection("questions").add({
      accessToken,
      apiKeyId: apiKey.id,
      assessmentDescription: payload.assessment.description,
      candidateEmail: payload.candidate.email,
      candidateId: payload.candidate.id,
      candidateName: payload.candidate.name,
      candidatePhone: payload.candidate.phone,
      candidateResumeUrl: payload.candidate.resumeUrl,
      createdAt: timestamp,
      createdBy: process.env.INTAKE_ASSESSMENT_OWNER_UID || "external-api",
      createdByEmail: "",
      externalEvent: payload.event,
      externalTimestamp: payload.timestamp,
      expiresAt: Timestamp.fromDate(expiresAt),
      intervieweeName: payload.candidate.name,
      interviewTitle: payload.assessment.title,
      questionCount: payload.assessment.questions.length,
      questions,
      questionSettings: payload.assessment.questions.map((question, index) => ({
        attemptsAllowed: question.attemptsAllowed,
        maxDurationSeconds: question.maxDurationSeconds,
        question: question.text,
        questionIndex: index,
      })),
      requesterName: apiKey.label,
      responseCount: 0,
      source: "api",
      status: "invited",
      targetEmail: payload.candidate.email,
      updatedAt: timestamp,
    });
    const assessmentLink = getAssessmentLink(request, accessToken);
    const safeAssessmentTitle = escapeHtml(payload.assessment.title);
    const safeCandidateName = escapeHtml(payload.candidate.name);
    const safeRequesterName = escapeHtml(apiKey.label);
    const safeAssessmentLink = escapeHtml(assessmentLink);
    const mailRequest = {
      to: [payload.candidate.email],
      metadata: {
        type: "interview-request",
        fileName: assessmentRef.id,
        questionFileId: assessmentRef.id,
        interviewTitle: payload.assessment.title,
        requesterName: apiKey.label,
        intervieweeName: payload.candidate.name,
        targetEmail: payload.candidate.email,
        questionCount: payload.assessment.questions.length,
        interviewLink: assessmentLink,
        expiresAt: expiresAt.toISOString(),
      },
      message: {
        subject: `${payload.assessment.title} interview request`,
        text: `Hello ${payload.candidate.name},\n\nYou have received an interview request for ${payload.assessment.title}. You will answer ${payload.assessment.questions.length} question${payload.assessment.questions.length === 1 ? "" : "s"} one at a time. This link expires on ${expiresAt.toLocaleDateString()}. When you are ready to start, please use this link:\n\n${assessmentLink}`,
        html: `<p>Hello ${safeCandidateName},</p>
        <p>You have received an interview request for <strong>${safeAssessmentTitle}</strong>.</p>
        <p>You will answer ${payload.assessment.questions.length} question${payload.assessment.questions.length === 1 ? "" : "s"} one at a time.</p>
        <p>This link expires on ${escapeHtml(expiresAt.toLocaleDateString())}.</p>
        <p>When you are ready to start, please use this link:</p>
        <p><a href="${safeAssessmentLink}">Start Video Assessment</a></p>`,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (senderEmail) {
      mailRequest.from = senderEmail;
    }

    await db.collection("mail").add(mailRequest);

    if (duplicate?.duplicateRef) {
      await duplicate.duplicateRef.set({
        assessmentId: assessmentRef.id,
        createdAt: Timestamp.fromDate(receivedAt),
      });
    }

    await logApiRequest(db, {
      apiKeyId: apiKey.id,
      assessmentId: assessmentRef.id,
      candidateEmail: payload.candidate.email,
      candidateId: payload.candidate.id,
      endpoint: "/api/v1/assessments/trigger",
      method: "POST",
      status: "success",
      statusCode: 201,
    });

    return NextResponse.json(
      {
        success: true,
        assessment: {
          assessmentLink,
          candidateEmail: payload.candidate.email,
          candidateId: payload.candidate.id,
          candidateName: payload.candidate.name,
          createdAt: receivedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          id: assessmentRef.id,
          status: "invited",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    await logApiRequest(db, {
      apiKeyId: apiKey?.id || null,
      endpoint: "/api/v1/assessments/trigger",
      method: "POST",
      status: "failure",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unable to trigger assessment.",
    });

    return jsonError(
      500,
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to trigger assessment.",
    );
  }
}
