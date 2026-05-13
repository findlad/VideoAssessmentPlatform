"use client";

import { useFirebase } from "@/context/FirebaseContext";

export function FirebaseStatus() {
  const { app, auth, db, functions, storage, projectId, usingEmulators } =
    useFirebase();

  return (
    <section className="status-panel" aria-label="Firebase status">
      <div>
        <h2>Firebase connection</h2>
        <p>
          This reads the initialized Firebase services from the app-level
          context.
        </p>
      </div>
      <div className="status-grid">
        <StatusItem label="Project" value={projectId || "Not configured"} />
        <StatusItem label="App" value={app ? "Initialized" : "Missing"} />
        <StatusItem label="Auth" value={auth ? "Ready" : "Missing"} />
        <StatusItem label="Firestore" value={db ? "Ready" : "Missing"} />
        <StatusItem
          label="Functions"
          value={functions ? "Ready" : "Missing"}
        />
        <StatusItem label="Storage" value={storage ? "Ready" : "Missing"} />
        <StatusItem
          label="Emulators"
          value={usingEmulators ? "Enabled" : "Disabled"}
        />
      </div>
    </section>
  );
}

function StatusItem({ label, value }) {
  return (
    <div className="status-item">
      <p className="status-label">{label}</p>
      <p className="status-value">{value}</p>
    </div>
  );
}
