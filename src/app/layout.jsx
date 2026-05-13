import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata = {
  title: "Video Assessment Platform",
  description: "Video assessment workflow built with Next.js and Firebase"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
