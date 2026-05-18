import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const DEFAULT_OWNER_EMAIL = "admin@example.com";
const STATUSES = [
  "invited",
  "invited",
  "in-progress",
  "in-progress",
  "completed",
  "completed",
  "completed",
  "reviewed",
  "reviewed",
  "reviewed",
  "expired",
  "expired",
];

const TITLES = [
  "UI Designer",
  "Software Engineer",
  "Product Manager",
  "Customer Success Lead",
];

const QUESTIONS = [
  "Tell us about your relevant background.",
  "Describe a recent project you are proud of.",
  "How do you approach ambiguous work?",
  "Why are you interested in this role?",
];

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));

  return value ? value.slice(prefix.length) : "";
}

function createAccessToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getCredential() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return {
      credential: cert({
        clientEmail,
        privateKey,
        projectId,
      }),
      projectId,
    };
  }

  return {
    projectId,
  };
}

function getContentType(filePath) {
  if (filePath.endsWith(".mp4")) {
    return "video/mp4";
  }

  return "video/webm";
}

function questionSettings() {
  return QUESTIONS.map((question, index) => ({
    attemptsAllowed: index === 1 ? 2 : 1,
    maxDurationSeconds: index === 2 ? 180 : 120,
    question,
    questionIndex: index,
  }));
}

async function uploadSampleVideo(bucket, sampleVideoPath, assessmentId, answerIndex) {
  const extension = sampleVideoPath.endsWith(".mp4") ? "mp4" : "webm";
  const storagePath = `interviewAnswers/${assessmentId}/answer-${
    answerIndex + 1
  }.${extension}`;

  await bucket.upload(sampleVideoPath, {
    destination: storagePath,
    metadata: {
      contentType: getContentType(sampleVideoPath),
      metadata: {
        seeded: "true",
      },
    },
  });

  return storagePath;
}

async function seed() {
  const ownerUid =
    readArg("ownerUid") ||
    process.env.DEMO_ADMIN_UID ||
    process.env.INTAKE_ASSESSMENT_OWNER_UID;
  const ownerEmail =
    readArg("ownerEmail") || process.env.DEMO_ADMIN_EMAIL || DEFAULT_OWNER_EMAIL;
  const sampleVideoPath = readArg("sampleVideo");
  const { credential, projectId } = getCredential();
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (projectId ? `${projectId}.appspot.com` : "");

  if (!ownerUid) {
    throw new Error(
      "Missing owner UID. Pass --ownerUid=<firebase-auth-uid> or set DEMO_ADMIN_UID.",
    );
  }

  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  }

  if (!storageBucket) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.");
  }

  if (!getApps().length) {
    initializeApp({
      ...(credential ? { credential } : {}),
      projectId,
      storageBucket,
    });
  }

  const db = getFirestore();
  const bucket = getStorage().bucket();
  const sampleVideoAbsolutePath = sampleVideoPath
    ? path.resolve(process.cwd(), sampleVideoPath)
    : "";

  if (sampleVideoAbsolutePath) {
    await fs.access(sampleVideoAbsolutePath);
  }

  const now = Date.now();

  for (let index = 0; index < STATUSES.length; index += 1) {
    const status = STATUSES[index];
    const title = TITLES[index % TITLES.length];
    const responseCount =
      status === "invited" || status === "expired"
        ? 0
        : status === "in-progress"
          ? 2
          : QUESTIONS.length;
    const createdAt = Timestamp.fromMillis(now - (index + 1) * 86_400_000);
    const submittedAt =
      status === "completed" || status === "reviewed"
        ? Timestamp.fromMillis(now - index * 43_200_000)
        : null;
    const expiresAt =
      status === "expired"
        ? Timestamp.fromMillis(now - 86_400_000)
        : Timestamp.fromMillis(now + 7 * 86_400_000);
    const assessmentRef = db.collection("questions").doc();

    await assessmentRef.set({
      accessToken: createAccessToken(),
      assessmentDescription:
        "Demo assessment generated for review workflow testing.",
      candidateId: `demo-${String(index + 1).padStart(3, "0")}`,
      createdAt,
      createdBy: ownerUid,
      createdByEmail: ownerEmail,
      expiresAt,
      interviewTitle: `${title} Video Assessment`,
      intervieweeName: `Demo Candidate ${index + 1}`,
      questionCount: QUESTIONS.length,
      questionSettings: questionSettings(),
      questions: QUESTIONS,
      requesterName: "Demo Recruiter",
      responseCount,
      source: index % 3 === 0 ? "api" : "manual",
      status,
      submittedAt,
      targetEmail: `candidate${index + 1}@example.com`,
      updatedAt: submittedAt || createdAt,
      ...(status === "reviewed"
        ? {
            overallScore: 8,
            reviewedAt: Timestamp.fromMillis(now - index * 21_600_000),
          }
        : {}),
    });

    if (responseCount === 0) {
      continue;
    }

    for (let answerIndex = 0; answerIndex < responseCount; answerIndex += 1) {
      const contentType = sampleVideoAbsolutePath
        ? getContentType(sampleVideoAbsolutePath)
        : "video/webm";
      const storagePath = sampleVideoAbsolutePath
        ? await uploadSampleVideo(
            bucket,
            sampleVideoAbsolutePath,
            assessmentRef.id,
            answerIndex,
          )
        : `interviewAnswers/${assessmentRef.id}/answer-${answerIndex + 1}.webm`;

      await assessmentRef.collection("answers").doc(`answer-${answerIndex + 1}`).set({
        attemptsAllowed: answerIndex === 1 ? 2 : 1,
        attemptsUsed: 1,
        contentType,
        maxDurationSeconds: answerIndex === 2 ? 180 : 120,
        question: QUESTIONS[answerIndex],
        questionIndex: answerIndex,
        responseReviewed: status === "reviewed",
        reviewNotes:
          status === "reviewed"
            ? "Seeded review note for demo walkthrough."
            : "",
        reviewRating: status === "reviewed" ? 8 : null,
        storagePath,
        updatedAt: submittedAt || createdAt,
      });
    }
  }

  console.log(
    `Seeded ${STATUSES.length} demo assessments for owner ${ownerUid}.` +
      (sampleVideoAbsolutePath
        ? " Sample videos were uploaded."
        : " No sample video was provided, so completed answer docs reference placeholder storage paths."),
  );
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
