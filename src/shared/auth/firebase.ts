import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { readAuthConfig } from "./config";

let instance: ReturnType<typeof getAuth> | undefined;
export function firebaseAuth() {
  if (!instance) {
    const config = readAuthConfig(import.meta.env, import.meta.env.DEV);
    instance = getAuth(initializeApp(config.firebase));
    if (config.emulator) {
      connectAuthEmulator(instance, config.emulator);
    }
  }
  return instance;
}
