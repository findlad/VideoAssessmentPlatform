# Video Assessment Platform

Next.js app with Firebase client integration, Firestore, Firebase Admin support for server code, and Cloud Functions.

Deployed to:
https://videoassessmentplatform--videoassessmentplatform.us-central1.hosted.app/

## Setup

1. Install dependencies:

```bash
npm install
npm --prefix functions install
```

2. Copy env templates:

```bash
cp .env.example .env
cp functions/.env.example functions/.env
```

3. Fill in Firebase values from your Firebase project settings.

4. Run locally:

```bash
npm run dev
```

5. Run Firebase emulators:

```bash
npm run firebase:emulators
```

6. Build check:

```bash
npm run build
```

## Firebase Layout

- `src/lib/firebase/client.js`: browser Firebase app, Auth, Firestore, Storage, Functions, emulator wiring.
- `src/lib/firebase/admin.js`: server-side Firebase Admin singleton.
- `src/lib/api/admin-auth.js`: Firebase ID token verification and admin access checks.
- `src/context/FirebaseContext.jsx`: React provider and `useFirebase()` hook.
- `functions/src/index.ts`: Cloud Functions entry points.

## Admin Authentication

Admins sign in through Firebase Authentication using Google or email/password. Enable the Google and Email/Password sign-in providers in Firebase Console before using both options.

For demo/self-service access, set:

```bash
ALLOW_ADMIN_SELF_SIGNUP=true
```

When enabled, any signed-in Firebase user is automatically created as an admin. This keeps the demo simple: reviewers can create an account with Google or email/password and use the dashboard immediately.

## Demo Data

Seed 12 sample assessments in mixed states with:

```bash
npm run seed:demo -- --ownerUid=<firebase-auth-admin-uid> --ownerEmail=admin@example.com
```

For completed and reviewed assessments with playable videos, first record or provide a small local `.webm` or `.mp4` file, then run:

```bash
npm run seed:demo -- --ownerUid=<firebase-auth-admin-uid> --ownerEmail=admin@example.com --sampleVideo=./sample-answer.webm
```

The script writes Firestore `questions` documents, answer subcollection documents, and uploads the sample video to Firebase Storage for each completed/reviewed answer. Without `--sampleVideo`, it still creates the assessments and answer metadata, but video playback/downloads for those seeded completed rows will point at placeholder paths.

The owner UID must match the admin Firebase Auth UID that signs into the dashboard, because the current dashboard lists assessments by `createdBy`.

## Interview Request API

### External Intake API

External systems can trigger an assessment with:

```http
POST /api/v1/assessments/trigger
Authorization: Bearer <api-key>
Content-Type: application/json
```

Configure accepted keys with `INTAKE_API_KEYS`. For local development this can be a plaintext comma-separated list. For production, store hashed keys as `sha256:<hex-hash>`.

Signed-in admins can also generate and revoke API keys from the dashboard. Generated keys are shown once, and only a SHA-256 hash is stored in Firestore under `apiKeys`.

Request body:

```json
{
  "event": "stage_transition",
  "timestamp": "2026-03-15T10:21:00Z",
  "candidate": {
    "id": "000000",
    "name": "Jane Doe",
    "email": "jane.doe@email.com",
    "phone": "+1-555-123-4567",
    "resumeUrl": "https://storage.example.com/resumes/abc123.pdf"
  },
  "assessment": {
    "title": "Software Engineer Video Assessment",
    "description": "Please answer each question concisely.",
    "questions": [
      {
        "text": "Tell us about yourself and your background.",
        "maxDurationSeconds": 120,
        "maxAttempts": 1
      }
    ]
  }
}
```

Success response:

```json
{
  "success": true,
  "assessment": {
    "id": "created-assessment-id",
    "candidateId": "000000",
    "candidateName": "Jane Doe",
    "candidateEmail": "jane.doe@email.com",
    "assessmentLink": "https://your-platform/interview?token=secure-access-token",
    "status": "invited",
    "createdAt": "2026-03-15T10:21:05.000Z"
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "message": "candidate.email is required"
  }
}
```

Example:

```bash
curl -X POST http://videoassessmentplatform--videoassessmentplatform.us-central1.hosted.app/api/v1/assessments/trigger \
  -H "Authorization: Bearer $INTAKE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "stage_transition",
    "timestamp": "2026-03-15T10:21:00Z",
    "candidate": {
      "id": "000000",
      "name": "Jane Doe",
      "email": "jane.doe@email.com"
    },
    "assessment": {
      "title": "Software Engineer Video Assessment",
      "questions": [
        {
          "text": "Tell us about yourself and your background.",
          "maxDurationSeconds": 120,
          "maxAttempts": 1
        }
      ]
    }
  }'
```

The endpoint validates required fields, creates an assessment, queues the invitation email, logs success/failure to `apiRequestLogs`, and prevents duplicate assessment creation for the same candidate/title within `INTAKE_DUPLICATE_WINDOW_SECONDS`.

`INTAKE_ASSESSMENT_OWNER_UID` can be set to associate API-created assessments with a specific admin user until full admin role management is implemented. Candidate assessment links use unguessable access tokens in the `token` query parameter and expire after `ASSESSMENT_LINK_EXPIRY_DAYS` days. Legacy `fileName` links are still accepted for older local test data.

Current reliability notes: the endpoint logs requests and prevents obvious duplicates, but full per-key rate limiting is still a production hardening item.

### Video Retrieval API

External systems can retrieve completed assessment videos with:

```http
GET /api/v1/assessments/{assessment_id}/videos
Authorization: Bearer <api-key>
```

Example:

```bash
curl -i -X GET "https://videoassessmentplatform--videoassessmentplatform.us-central1.hosted.app/api/v1/assessments/{assessment_id}/videos" \
  -H "Authorization: Bearer <api-key>"
```

The endpoint uses the same API keys as the intake API. It returns signed Firebase Storage URLs that expire after `VIDEO_SIGNED_URL_TTL_SECONDS` seconds, defaulting to one hour.

Success response:

```json
{
  "success": true,
  "candidate": {
    "id": "000000",
    "name": "Jane Doe",
    "email": "jane.doe@email.com"
  },
  "assessment": {
    "id": "created-assessment-id",
    "title": "Software Engineer Video Assessment",
    "submittedAt": "2026-03-16T14:02:00.000Z"
  },
  "videos": [
    {
      "questionNumber": 1,
      "questionText": "Tell us about yourself.",
      "videoUrl": "https://storage.googleapis.com/...",
      "expiresAt": "2026-03-16T15:02:00.000Z",
      "duration": null
    }
  ]
}
```

The endpoint returns `404 ASSESSMENT_NOT_FOUND` for unknown assessments and `409 ASSESSMENT_INCOMPLETE` when the candidate has not completed all responses. Retrieval attempts are logged to `apiRequestLogs`.

### Manual UI API

Create interview requests with:

```http
POST /api/interview-requests
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

Request body:

```json
{
  "interviewTitle": "UI Designer",
  "requesterName": "Alex Manager",
  "intervieweeName": "Jordan Candidate",
  "targetEmail": "jordan@example.com",
  "questions": [
    {
      "text": "Tell us about your relevant experience.",
      "attemptsAllowed": 1,
      "maxDurationSeconds": 60
    },
    {
      "text": "Describe a project you are proud of.",
      "attemptsAllowed": 2,
      "maxDurationSeconds": 120
    }
  ]
}
```

`attemptsAllowed` defaults to `1` and `maxDurationSeconds` defaults to `60` when omitted. Recording duration is capped at `300` seconds. The API still accepts simple string questions for backward compatibility, but structured question objects are recommended.

The API verifies the Firebase Auth ID token with Firebase Admin, creates a `questions` document, creates a `mail` document for the email extension, and returns:

```json
{
  "id": "created-question-document-id",
  "interviewLink": "https://your-site/interview?token=secure-access-token"
}
```

Example browser call from a signed-in Firebase user:

```js
const token = await user.getIdToken();

const response = await fetch("/api/interview-requests", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    interviewTitle: "UI Designer",
    requesterName: "Alex Manager",
    intervieweeName: "Jordan Candidate",
    targetEmail: "jordan@example.com",
    questions: [
      {
        text: "Tell us about your relevant experience.",
        attemptsAllowed: 1,
        maxDurationSeconds: 60,
      },
      {
        text: "Describe a project you are proud of.",
        attemptsAllowed: 2,
        maxDurationSeconds: 120,
      },
    ],
  }),
});

const result = await response.json();
```

Server-side Firebase Admin requires these env vars:

```bash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ALLOW_ADMIN_SELF_SIGNUP=true
```

`NEXT_PUBLIC_DEPLOYMENT_URL` should be set in deployed environments so email links use an absolute URL.

## Deployment

This app is configured for Firebase App Hosting with [apphosting.yaml](./apphosting.yaml). Set production values before deploying:

```bash
NEXT_PUBLIC_DEPLOYMENT_URL=
NEXT_PUBLIC_EMAIL_FROM_ADDRESS=
ALLOW_ADMIN_SELF_SIGNUP=true
INTAKE_ASSESSMENT_OWNER_UID=
```

Deploy security rules after changing Firestore or Storage rules:

```bash
firebase deploy --only firestore:rules,storage
```

Apply the Storage bucket CORS policy when browser uploads or downloads are
blocked by preflight errors:

```bash
gcloud storage buckets update gs://videoassessmentplatform.firebasestorage.app --cors-file=storage.cors.json
```

Deploy the app through App Hosting after the backend is configured:

```bash
firebase deploy
```

## QA Checklist

- Create an account with Google or email/password and verify the dashboard loads.
- Manually create an assessment with 4 default questions, change attempts/duration, and confirm the invitation email arrives.
- Trigger `/api/v1/assessments/trigger` with a valid API key and with invalid payloads.
- Open the candidate link on desktop and verify questions are hidden until recording starts.
- Confirm camera/microphone setup blocks progress until confirmed.
- Record answers, test retry limits, and submit the assessment.
- Temporarily disconnect the network after recording and confirm upload retry/recovery behavior.
- Open the candidate link on a phone/tablet and confirm the unsupported-device block appears before questions load.
- Review a completed assessment: play videos, change playback speed, score, add notes, mark responses reviewed, and mark the whole assessment reviewed.
- Download one video and bulk download all videos.
- Call `/api/v1/assessments/{assessment_id}/videos` for a completed assessment and confirm signed URLs are returned.
- Check invited, in-progress, completed, reviewed, and expired states in the dashboard filters.

## Demo Outline

For the recorded demo, show:

- Admin Google sign-in and API key generation.
- API-triggered assessment using `curl` or Postman.
- Manual assessment creation from the dashboard.
- Candidate landing page, device check, no-preparation question reveal, recording, upload, and final submission.
- Unsupported mobile/tablet blocking.
- Review workflow with scoring, notes, playback speed, individual download, bulk download, and mark reviewed.
- Video retrieval API response for a completed assessment.

## Known Gaps

- `ALLOW_ADMIN_SELF_SIGNUP=true` is convenient for demos, but a production deployment should add explicit admin invitation/revocation.
- API request logging and duplicate prevention exist, but dedicated rate limiting is still a production hardening item.
- Email provider acceptance is handled by the Firebase mail extension flow, but failed-email retry UI is not built yet.
- Link expiry is configured by environment variable rather than an admin settings screen.
- API-created assessments appear in the current dashboard when `INTAKE_ASSESSMENT_OWNER_UID` is set to the reviewing admin UID.
