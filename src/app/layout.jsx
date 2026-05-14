import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata = {
  title: "Video Assessment Platform",
  description: "Video assessment workflow built with Next.js and Firebase"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppRouterCacheProvider>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
