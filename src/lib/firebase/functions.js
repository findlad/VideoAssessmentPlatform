import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";

function requireFunctions() {
  if (!functions) {
    throw new Error("Cloud Functions is not initialized. Check Firebase env values.");
  }

  return functions;
}

export function callableFunction(name) {
  return httpsCallable(requireFunctions(), name);
}

export async function pingFunctions(payload = {}) {
  const ping = callableFunction("ping");
  const result = await ping(payload);

  return result.data;
}
