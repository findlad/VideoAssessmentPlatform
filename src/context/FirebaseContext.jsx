"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import { firebaseClient } from "@/lib/firebase/client";

const FirebaseContext = createContext(null);

export function FirebaseProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(firebaseClient.auth));

  useEffect(() => {
    if (!firebaseClient.auth) {
      return undefined;
    }

    return onAuthStateChanged(firebaseClient.auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
  }, []);

  const value = useMemo(
    () => ({
      ...firebaseClient,
      user,
      authLoading
    }),
    [user, authLoading]
  );

  return (
    <FirebaseContext.Provider value={value}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const context = useContext(FirebaseContext);

  if (!context) {
    throw new Error("useFirebase must be used within FirebaseProvider");
  }

  return context;
}
