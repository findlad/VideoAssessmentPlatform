"use client";

import { FirebaseProvider } from "@/context/FirebaseContext";

export function Providers({ children }) {
  return <FirebaseProvider>{children}</FirebaseProvider>;
}
