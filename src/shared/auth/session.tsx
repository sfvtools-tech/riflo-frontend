import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "./firebase";

type Session = {
  user: User | null;
  loading: boolean;
  busy: boolean;
  error: string;
  configured: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};
const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    try {
      const auth = firebaseAuth();
      setConfigured(true);
      return onAuthStateChanged(
        auth,
        (next) => {
          setUser(next);
          setLoading(false);
        },
        () => {
          setError("Sign-in could not be restored. Reload to try again.");
          setLoading(false);
        },
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sign-in is not configured.",
      );
      setLoading(false);
    }
  }, []);
  async function act(logout: boolean) {
    setBusy(true);
    setError("");
    try {
      if (logout) {
        await signOut(firebaseAuth());
      } else {
        await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      }
    } catch {
      setError(
        logout
          ? "We could not sign you out. Please try again."
          : "Sign-in did not finish. Allow the Google popup and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        user,
        loading,
        busy,
        error,
        configured,
        login: () => act(false),
        logout: () => act(true),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useSession() {
  const session = useContext(Context);
  if (!session) {
    throw new Error("A live session is required.");
  }
  return session;
}
