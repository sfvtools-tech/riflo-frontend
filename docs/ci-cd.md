# Frontend CI/CD

`.github/workflows/ci.yml` runs unit tests and the TypeScript/Vite build on pull requests to `main` and pushes to `main`. A successful main push or manual **Rebuild and deploy main** run deploys its exact tested build artifact to the existing Firebase Hosting site. No preview environment or backend deployment is created. PR checks work without Firebase configuration or cloud credentials; an unconfigured build keeps sign-in unavailable.

Before enabling automatic deployment, configure these GitHub repository **variables**, not service-account keys:

| Variable | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Existing Firebase web application's public API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | `riflo-159b5.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `riflo-159b5` |
| `VITE_FIREBASE_APP_ID` | Existing Firebase web application ID |
| `VITE_API_BASE_URL` | `https://34.93.118.95` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full `projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` resource |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Dedicated frontend deployment service-account email |

The `VITE_` values are public browser configuration. Do not add provider keys, ADC, Auth emulator variables or private Google OAuth credentials. Optional `VITE_GOOGLE_PICKER_API_KEY` and `VITE_GOOGLE_PROJECT_NUMBER` must be set together if Drive Picker is enabled. Main builds reject missing configuration and unexpected project/API targets. If those deployment targets intentionally change, update the validation and smoke-check URL in the same reviewed change.

Use GitHub OIDC and service-account impersonation through Workload Identity Federation. Restrict the provider to the immutable owner/repository IDs, `refs/heads/main`, the `push` or `workflow_dispatch` event, and this repository's `.github/workflows/ci.yml` workflow reference; bind only this repository to `roles/iam.workloadIdentityUser` on the frontend deployment account. Grant that account `roles/firebasehosting.admin`, `roles/serviceusage.apiKeysViewer` and `roles/serviceusage.serviceUsageViewer` on the existing Firebase project. Service Usage Viewer lets the CLI check that the Hosting API is enabled; it cannot enable or disable APIs. Do not grant project Editor, Firebase Admin, backend access or service-account key creation. See [Google's federation setup](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [Firebase CLI ADC authentication](https://firebase.google.com/docs/cli), and [Firebase product roles](https://firebase.google.com/docs/projects/iam/roles-predefined-product).

Protect `main` with pull requests and the `Frontend checks` status check. Required reviewer approvals should remain zero; anyone with merge access can merge once checks pass. Authentication occurs only in the deployment job, after the build artifact and pinned CLI are ready. Artifacts contain only `dist/` and expire after seven days. Generated credentials are excluded from Git.

Deployments are serialized without cancelling an active deployment. A smoke check compares the live HTML and JavaScript asset with the tested artifact; failures mark the run failed but do not automatically roll back. These checks do not prove Google sign-in or authenticated import/generation behavior.

For rollback, use the Firebase console's Hosting release history to restore the previous known-good release, then revert the faulty commit through a PR before the next main deployment. The workflow rejects superseded main commits; only the current main revision can be re-run for deployment. Frontend and backend releases are independent, so API changes must remain compatible with the deployed frontend.

Versions are pinned in the workflow: Node 24.22.2, Firebase CLI 15.34.2 and action commit SHAs. Update them through reviewed PRs with passing checks. Unit tests and builds do not need cloud access; actual OIDC deployment must be verified in GitHub after the identity and repository variables are configured.

To change public browser settings without a code push, edit the repository Variables, then run **Actions → Frontend CI and deploy → Run workflow → main → Rebuild and deploy main**. This tests and rebuilds the selected current main commit; it is not a rebuild of a separately tracked historical Hosting revision. Non-main manual runs cannot deploy. Frontend configuration is compiled into JavaScript and is public. The backend configuration-only action is separate because it updates server runtime values without rebuilding application code.
