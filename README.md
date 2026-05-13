# Video Assessment Platform

Next.js app with Firebase client integration, Firestore, Firebase Admin support for server code, and Cloud Functions.

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
