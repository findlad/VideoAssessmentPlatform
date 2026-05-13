import { FirebaseStatus } from "@/components/FirebaseStatus";

export default function Home() {
  return (
    <main className="page-shell">
      <section className="intro">
        <p className="eyebrow">Video Assessment Platform</p>
        <h1>Next.js and Firebase are ready.</h1>
        <p>
          Configure your `.env.local`, connect the Firebase project, and start
          building assessment workflows.
        </p>
      </section>
      <FirebaseStatus />
    </main>
  );
}
