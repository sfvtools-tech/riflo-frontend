export function readAuthConfig(
  env: Record<string, unknown>,
  development: boolean,
) {
  const names = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "APP_ID"] as const;
  const values = names.map((name) => env[`VITE_FIREBASE_${name}`]);
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(
      "Sign-in needs the Firebase web app settings. Add them to .env.local and restart the frontend.",
    );
  }
  const emulator = env.VITE_FIREBASE_AUTH_EMULATOR_URL;
  if (emulator) {
    const url = new URL(String(emulator));
    if (
      !development ||
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "The sign-in emulator must be a local HTTP address in development.",
      );
    }
  }
  return {
    firebase: {
      apiKey: String(values[0]),
      authDomain: String(values[1]),
      projectId: String(values[2]),
      appId: String(values[3]),
    },
    emulator: emulator ? String(emulator) : null,
  };
}
