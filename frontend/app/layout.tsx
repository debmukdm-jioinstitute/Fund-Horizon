import type { Metadata, Viewport } from "next";
import "@fontsource-variable/google-sans";
import "./globals.css";
import { AuthProvider } from "@/components/AuthContext";
import { ThemeProvider } from "@/components/terminal/ThemeContext";
import GlobalHeader from "@/components/terminal/GlobalHeader";
import GlobalFooter from "@/components/terminal/GlobalFooter";
import { siteUrl } from "@/lib/site";
import { BRAND } from "@/lib/brand";

const baseUrl = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  applicationName: BRAND.name,
  title: { default: `${BRAND.name} | ${BRAND.descriptor}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  openGraph: {
    title: `${BRAND.name} | ${BRAND.tagline}`,
    description: BRAND.description,
    url: "/",
    siteName: BRAND.name,
    locale: "en_IN",
    type: "website",
    images: [{ url: BRAND.logo, alt: `${BRAND.name} logo` }],
  },
  twitter: { card: "summary", title: BRAND.name, description: BRAND.description, images: [BRAND.logo] },
};

export const viewport: Viewport = { themeColor: BRAND.navy, width: "device-width", initialScale: 1 };

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
