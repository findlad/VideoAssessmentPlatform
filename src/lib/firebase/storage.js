import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { storage } from "@/lib/firebase/client";

function requireStorage() {
  if (!storage) {
    throw new Error("Storage is not initialized. Check Firebase env values.");
  }

  return storage;
}

export async function uploadInterviewAnswer(
  fileName,
  questionIndex,
  blob,
  options = {},
) {
  const answerNumber = questionIndex + 1;
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const answerRef = ref(
    requireStorage(),
    `interviewAnswers/${fileName}/answer-${answerNumber}.${extension}`,
  );

  const task = uploadBytesResumable(answerRef, blob, {
    contentType: blob.type || "video/webm",
    customMetadata: {
      fileName,
      answerNumber: String(answerNumber),
    },
  });

  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        options.onProgress?.(
          Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        );
      },
      reject,
      resolve,
    );
  });

  return answerRef.fullPath;
}

export async function getStorageDownloadUrl(path) {
  const fileRef = ref(requireStorage(), path);

  return getDownloadURL(fileRef);
}

export async function deleteStorageFile(path) {
  const fileRef = ref(requireStorage(), path);

  return deleteObject(fileRef);
}
