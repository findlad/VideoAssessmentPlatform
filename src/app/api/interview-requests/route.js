import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminServices } from "@/lib/firebase/admin";
import { getBearerToken, requireAdminUser } from "@/lib/api/admin-auth";

const MAX_QUESTIONS = 6;
const DEFAULT_ATTEMPTS_ALLOWED = 1;
const DEFAULT_MAX_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 300;
const LINK_EXPIRY_DAYS = Number(process.env.ASSESSMENT_LINK_EXPIRY_DAYS || 7);
const senderEmail = process.env.NEXT_PUBLIC_EMAIL_FROM_ADDRESS;

function createAccessToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getInterviewLink(request, accessToken) {
  const configuredOrigin = process.env.NEXT_PUBLIC_DEPLOYMENT_URL;
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const origin = configuredOrigin || (host ? `${protocol}://${host}` : "");

  if (!origin) {
    return `/interview?token=${encodeURIComponent(accessToken)}`;
  }

  return `${origin}/interview?token=${encodeURIComponent(accessToken)}`;
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

function normalizeQuestions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((question) => {
      if (typeof question === "string") {
        return {
          attemptsAllowed: DEFAULT_ATTEMPTS_ALLOWED,
          maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
          text: normalizeText(question),
        };
      }

      return {
        attemptsAllowed: Math.max(
          1,
          Math.floor(Number(question?.attemptsAllowed)) ||
            DEFAULT_ATTEMPTS_ALLOWED,
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
      };
    })
    .filter((question) => question.text);
}

export async function POST(request) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Missing authorization bearer token." },
        { status: 401 },
      );
    }

    const adminUser = await requireAdminUser(request);

    if (!adminUser) {
      return NextResponse.json(
        { error: "You must be an admin to create interview requests." },
        { status: 403 },
      );
    }

    const { db } = getAdminServices();
    const body = await request.json();
    const interviewTitle = normalizeText(body.interviewTitle);
    const requesterName = normalizeText(body.requesterName);
    const intervieweeName = normalizeText(body.intervieweeName);
    const targetEmail = normalizeText(body.targetEmail);
    const questionDetails = normalizeQuestions(body.questions);
    const questions = questionDetails.map((question) => question.text);

    if (
      !requesterName ||
      !interviewTitle ||
      !intervieweeName ||
      !targetEmail ||
      questionDetails.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Interview title, requester name, interviewee name, target email, and at least one question are required.",
        },
        { status: 400 },
      );
    }

    if (questionDetails.length > MAX_QUESTIONS) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_QUESTIONS} questions.` },
        { status: 400 },
      );
    }

    const timestamp = FieldValue.serverTimestamp();
    const accessToken = createAccessToken();
    const expiresAt = new Date(
      Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    const requestRef = await db.collection("questions").add({
      accessToken,
      createdBy: adminUser.uid,
      createdByEmail: adminUser.email || "",
      interviewTitle,
      requesterName,
      intervieweeName,
      targetEmail,
      questions,
      questionSettings: questionDetails.map((question, index) => ({
        attemptsAllowed: question.attemptsAllowed,
        maxDurationSeconds: question.maxDurationSeconds,
        question: question.text,
        questionIndex: index,
      })),
      questionCount: questionDetails.length,
      responseCount: 0,
      status: "requested",
      createdAt: timestamp,
      expiresAt: Timestamp.fromDate(expiresAt),
      updatedAt: timestamp,
    });
    const interviewLink = getInterviewLink(request, accessToken);
    const safeInterviewTitle = escapeHtml(interviewTitle);
    const safeIntervieweeName = escapeHtml(intervieweeName);
    const safeRequesterName = escapeHtml(requesterName);
    const safeInterviewLink = escapeHtml(interviewLink);
    const mailRequest = {
      to: [targetEmail],
      metadata: {
        type: "interview-request",
        fileName: requestRef.id,
        questionFileId: requestRef.id,
        interviewTitle,
        requesterName,
        intervieweeName,
        targetEmail,
        questionCount: questionDetails.length,
        interviewLink,
        expiresAt: expiresAt.toISOString(),
      },
      message: {
        subject: `${interviewTitle} interview request from ${requesterName}`,
        text: `Hello ${intervieweeName},\n\nYou have received an interview request for ${interviewTitle} from ${requesterName}. ${requesterName} has posed a series of questions, you will be able to read the questions one at a time, and when ready to answer, you can click the record button. Once you have granted permission to use your camera and microphone, we will record your answer. The interviewer may allow multiple attempts, but the default is one. This link expires on ${expiresAt.toLocaleDateString()}. When you are ready to start your video interview, please click the link:\n\n${interviewLink}`,
        html: `<p>Hello ${safeIntervieweeName},</p><p>You have received an interview request for <strong>${safeInterviewTitle}</strong> from ${safeRequesterName}.</p>
        <p>${safeRequesterName} has posed a series of questions, you will be able to read the questions one at a time, and when ready to answer, you can click the record button. Once you have granted permission to use your camera and microphone, we will record your answer. The interviewer may allow multiple attempts, but the default is one.</p>
        <p>This link expires on ${escapeHtml(expiresAt.toLocaleDateString())}.</p>
        <p>When you are ready to start your video interview, please click the link:</p>
        <p><a href="${safeInterviewLink}">Conduct Video Interview</a></p>`,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (senderEmail) {
      mailRequest.from = senderEmail;
    }

    await db.collection("mail").add(mailRequest);

    return NextResponse.json({
      id: requestRef.id,
      interviewLink,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create the interview request.",
      },
      { status: 500 },
    );
  }
}
