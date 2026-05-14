import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase/client";

function requireStorage() {
  if (!storage) {
    throw new Error("Storage is not initialized. Check Firebase env values.");
  }

  return storage;
}

export async function uploadInterviewAnswer(fileName, questionIndex, blob) {
  const answerNumber = questionIndex + 1;
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const answerRef = ref(
    requireStorage(),
    `interviewAnswers/${fileName}/answer-${answerNumber}.${extension}`,
  );

  await uploadBytes(answerRef, blob, {
    contentType: blob.type || "video/webm",
    customMetadata: {
      fileName,
      answerNumber: String(answerNumber),
    },
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
