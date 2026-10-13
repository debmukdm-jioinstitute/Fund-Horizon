import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";

export default async function HomePage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get("fh_session")?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  try {
    const apiInternalUrl = process.env.API_INTERNAL_URL || API_URL;
    const res = await fetch(`${apiInternalUrl}/api/auth/me`, {
      headers: {
        Cookie: `fh_session=${sessionToken}`,
      },
      cache: "no-store",
    });

    if (res.ok) {
      const user = await res.json();
      if (user.is_staff) {
        redirect("/backoffice");
      }
    }
  } catch {
    // on network or backend error, fail-closed to login
  }

  redirect("/login");
}
