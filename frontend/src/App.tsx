import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Dashboard from "@/pages/Dashboard";
import Landing, { type User } from "@/pages/Landing";
import Legal from "@/pages/Legal";
import Account from "@/pages/Account";
import Stats from "@/pages/Stats";
import Support from "@/pages/Support";
import InstallPrompt from "@/components/InstallPrompt";
import { ApiError, apiGet, apiPost, errorText } from "@/lib/api";

// Signed out: the landing page (sign up / log in). Signed in: the tracker, with only your listings.
export default function App() {
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const [resetToken, setResetToken] = useState(params.get("reset"));
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await apiGet<User>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: 1,
    staleTime: Infinity,
  });

  // drop every cached answer except "who am I" (clear() would also drop the query this page watches)
  const forgetOthers = useCallback(
    () => queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" }),
    [queryClient],
  );
  const signedIn = useCallback(
    (user: User) => {
      setResetToken(null);
      forgetOthers(); // nothing from another account stays cached
      queryClient.setQueryData(["me"], user);
    },
    [forgetOthers, queryClient],
  );
  const signedOut = useCallback(() => {
    forgetOthers();
    queryClient.setQueryData(["me"], null);
  }, [forgetOthers, queryClient]);

  // any request answered "Please log in" (session ended elsewhere, or expired): back to the landing page
  useEffect(() => {
    window.addEventListener("cardstakk:signed-out", signedOut);
    return () => window.removeEventListener("cardstakk:signed-out", signedOut);
  }, [signedOut]);

  // the link in the "Confirm your email" message: /?verify=<token>
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("verify");
    if (!token) return;
    window.history.replaceState(null, "", window.location.pathname);
    apiPost<User>("/auth/verify", { token })
      .then(() => {
        setVerifyNote("Email confirmed — thanks!");
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["items"] });
        queryClient.invalidateQueries({ queryKey: ["stacks"] });
      })
      .catch((e) => setVerifyNote(errorText(e, "That confirmation link didn't work.")));
  }, [queryClient]);

  // /privacy and /terms: open to everyone, signed in or not
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/privacy" || path === "/terms") return <Legal page={path === "/privacy" ? "privacy" : "terms"} />;

  if (me.isLoading) {
    return <div className="min-h-svh bg-[#eef1f5]" aria-busy="true" />;
  }
  if (me.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#eef1f5] p-6 text-center text-[#1f2630]">
        <p>
          Can&apos;t reach the server right now.{" "}
          <button type="button" className="font-semibold text-[#4a6a94] underline" onClick={() => me.refetch()}>
            Try again
          </button>
        </p>
      </div>
    );
  }
  if (path === "/support") return <Support user={me.data ?? null} />;
  if (!me.data || resetToken) {
    return <Landing onSignedIn={signedIn} resetToken={resetToken} notice={verifyNote} />;
  }
  if (path === "/stats") return <Stats user={me.data} />;
  if (path === "/account") return <Account user={me.data} />;
  return (
    <>
      <Dashboard user={me.data} onSignedOut={signedOut} notice={verifyNote} />
      {/* phones: offer to add the app to the home screen (once) */}
      <InstallPrompt />
    </>
  );
}
