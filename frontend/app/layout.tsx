import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthContext";
import { ThemeProvider } from "@/components/terminal/ThemeContext";
import GlobalHeader from "@/components/terminal/GlobalHeader";
import GlobalFooter from "@/components/terminal/GlobalFooter";
import { siteUrl } from "@/lib/site";

const baseUrl = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Fund Horizon — Financial Data Terminal",
  description: "Internal and client financial data terminal from Fund Horizon.",
  openGraph: {
    title: "Fund Horizon — Financial Data Terminal",
    description: "Internal and client financial data terminal from Fund Horizon.",
    url: "/",
    siteName: "Fund Horizon",
    locale: "en_IN",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('fh_terminal_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col font-sans selection:bg-[#006F64] selection:text-white antialiased">
        <ThemeProvider>
          <AuthProvider>
            <GlobalHeader />
            <main id="main" className="flex-1 w-full">
              {children}
            </main>
            <GlobalFooter />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
