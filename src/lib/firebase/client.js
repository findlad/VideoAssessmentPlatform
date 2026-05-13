"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions
} from "firebase/functions";
import {
  connectStorageEmulator,
  getStorage
} from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const projectId = firebaseConfig.projectId;
const app = projectId ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1";
const usingEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

let auth = null;
let db = null;
let functions = null;
let storage = null;

if (app) {
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app, region);
  storage = getStorage(app);

  if (typeof window !== "undefined") {
    configureBrowserFirebase({ auth, db, functions, storage });
  }
}

function configureBrowserFirebase(services) {
  const globalKey = "__videoAssessmentFirebaseEmulatorsConnected";

  setPersistence(services.auth, inMemoryPersistence).catch(() => {
    // Persistence can fail in restricted browser contexts. Auth still works.
  });

  if (!usingEmulators || window[globalKey]) {
    return;
  }

  connectAuthEmulator(services.auth, "http://127.0.0.1:9099", {
    disableWarnings: true
  });
  connectFirestoreEmulator(services.db, "127.0.0.1", 8080);
  connectFunctionsEmulator(services.functions, "127.0.0.1", 5001);
  connectStorageEmulator(services.storage, "127.0.0.1", 9199);

  window[globalKey] = true;
}

export const firebaseClient = {
  app,
  auth,
  db,
  functions,
  storage,
  projectId,
  region,
  usingEmulators
};

export { app, auth, db, functions, storage };
