import type { DriveFile } from "./project-response";

type Picker = { setVisible: (visible: boolean) => void; dispose: () => void };
type Builder = {
  addView: (view: unknown) => Builder;
  setOAuthToken: (token: string) => Builder;
  setDeveloperKey: (key: string) => Builder;
  setAppId: (id: string) => Builder;
  setOrigin: (origin: string) => Builder;
  setCallback: (
    callback: (value: {
      action: string;
      docs?: { id?: string; resourceKey?: string }[];
    }) => void,
  ) => Builder;
  build: () => Picker;
};
type GoogleSdk = {
  gapi?: {
    load: (
      name: string,
      options: {
        callback: () => void;
        onerror: () => void;
        timeout: number;
        ontimeout: () => void;
      },
    ) => void;
  };
  google?: {
    picker: {
      PickerBuilder: new () => Builder;
      DocsView: new (id: unknown) => { setMode: (mode: unknown) => unknown };
      DocsViewMode: { LIST: unknown };
      ViewId: { DOCS_VIDEOS: unknown };
    };
  };
};
const sdk = () => window as unknown as GoogleSdk;
let loading: Promise<void> | undefined;
function loadPicker() {
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        script.remove();
        reject(
          new Error(
            "Google Picker could not load. Check your connection and try again.",
          ),
        );
      };
      const timer = window.setTimeout(fail, 15000);
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        fail();
      };
      script.onload = () => {
        clearTimeout(timer);
        if (!sdk().gapi) {
          fail();
          return;
        }
        sdk().gapi!.load("picker", {
          callback: resolve,
          onerror: fail,
          timeout: 15000,
          ontimeout: fail,
        });
      };
      document.head.append(script);
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}
export const pickerConfigured = () =>
  Boolean(
    import.meta.env.VITE_GOOGLE_PICKER_API_KEY &&
      /^\d+$/.test(import.meta.env.VITE_GOOGLE_PROJECT_NUMBER ?? ""),
  );
export async function chooseDriveVideo(
  access: { accessToken: string; expiresAt: string },
  signal: AbortSignal,
): Promise<DriveFile | null> {
  await loadPicker();
  signal.throwIfAborted();
  const expires = Date.parse(access.expiresAt);
  if (
    typeof access.accessToken !== "string" ||
    !Number.isFinite(expires) ||
    expires <= Date.now()
  ) {
    throw new Error("Drive access expired. Open the Picker again.");
  }
  const library = sdk().google?.picker;
  if (!library) {
    throw new Error("Google Picker is unavailable.");
  }
  return new Promise((resolve, reject) => {
    let picker: Picker;
    const finish = (file: DriveFile | null, error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      picker?.setVisible(false);
      picker?.dispose();
      if (error) {
        reject(error);
      } else {
        resolve(file);
      }
    };
    const abort = () =>
      finish(null, new DOMException("Selection cancelled.", "AbortError"));
    const timer = window.setTimeout(
      () =>
        finish(null, new Error("Drive access expired. Open the Picker again.")),
      Math.min(expires - Date.now(), 10 * 60 * 1000),
    );
    signal.addEventListener("abort", abort, { once: true });
    try {
      picker = new library.PickerBuilder()
        .addView(
          new library.DocsView(library.ViewId.DOCS_VIDEOS).setMode(
            library.DocsViewMode.LIST,
          ),
        )
        .setOAuthToken(access.accessToken)
        .setDeveloperKey(import.meta.env.VITE_GOOGLE_PICKER_API_KEY)
        .setAppId(import.meta.env.VITE_GOOGLE_PROJECT_NUMBER)
        .setOrigin(window.location.origin)
        .setCallback((data) => {
          if (data.action === "cancel") {
            finish(null);
          }
          if (data.action === "picked") {
            const doc = data.docs?.[0];
            if (
              !doc?.id ||
              !/^[A-Za-z0-9_-]{1,256}$/.test(doc.id) ||
              (doc.resourceKey &&
                !/^[A-Za-z0-9_-]{1,256}$/.test(doc.resourceKey))
            ) {
              finish(
                null,
                new Error("Google returned an unexpected file selection."),
              );
              return;
            }
            finish({
              fileId: doc.id,
              ...(doc.resourceKey ? { resourceKey: doc.resourceKey } : {}),
            });
          }
        })
        .build();
      picker.setVisible(true);
    } catch {
      finish(
        null,
        new Error(
          "Google Picker could not open. Check its setup and try again.",
        ),
      );
    }
  });
}
