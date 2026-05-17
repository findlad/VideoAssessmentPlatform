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
cp .env.local.example .env.local
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

## Firebase Layout

- `src/lib/firebase/client.js`: browser Firebase app, Auth, Firestore, Storage, Functions, emulator wiring.
- `src/lib/firebase/admin.js`: server-side Firebase Admin singleton.
- `src/context/FirebaseContext.jsx`: React provider and `useFirebase()` hook.
- `functions/src/index.ts`: Cloud Functions entry points.

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
curl -X POST http://localhost:3000/api/v1/assessments/trigger \
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

### Video Retrieval API

External systems can retrieve completed assessment videos with:

```http
GET /api/v1/assessments/{assessment_id}/videos
Authorization: Bearer <api-key>
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
```

`NEXT_PUBLIC_DEPLOYMENT_URL` should be set in deployed environments so email links use an absolute URL.

# VideoAssessmentPlatform
