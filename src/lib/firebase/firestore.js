import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

function requireDb() {
  if (!db) {
    throw new Error("Firestore is not initialized. Check Firebase env values.");
  }

  return db;
}

export function collectionRef(path) {
  return collection(requireDb(), path);
}

export function documentRef(path, id) {
  return doc(requireDb(), path, id);
}

export async function createDocument(path, data) {
  return addDoc(collectionRef(path), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function readDocument(path, id) {
  const snapshot = await getDoc(documentRef(path, id));

  return snapshot.exists()
    ? { id: snapshot.id, ...snapshot.data() }
    : null;
}

export async function readCollection(path) {
  const snapshot = await getDocs(collectionRef(path));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}

export async function queryDocuments(path, constraints = []) {
  const queryRef = query(collectionRef(path), ...constraints);
  const snapshot = await getDocs(queryRef);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}

export function whereEquals(field, value) {
  return where(field, "==", value);
}

export function orderByField(field, direction = "asc") {
  return orderBy(field, direction);
}

export async function writeDocument(path, id, data, options = { merge: true }) {
  return setDoc(
    documentRef(path, id),
    {
      ...data,
      updatedAt: serverTimestamp()
    },
    options
  );
}

export async function updateDocument(path, id, data) {
  return updateDoc(documentRef(path, id), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function deleteDocument(path, id) {
  return deleteDoc(documentRef(path, id));
}
