# Monthline

A responsive English-language JDG earnings calculator for Poland. Enter monthly working hours, save your hourly rate and deductions, and keep historical monthly snapshots synchronized between devices through your Supabase account.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
cp .env.example .env.local
```

Configure Supabase as described below, fill in `.env.local`, then:

```sh
npm run dev
```

Open the local URL printed by Vite. Without configuration the calculator is an explicitly **unsaved preview**: login and saving are unavailable. No salary records are silently stored in browser-only storage.

## Supabase setup

1. Create a Supabase project.
2. Run [001_monthline.sql](./supabase/migrations/001_monthline.sql) once in the project's SQL Editor, or apply it using the Supabase CLI migration workflow. The migration creates the tables and RPC functions used by the app.
3. In Authentication, enable the Email provider and email confirmations. Configure delivery/SMTP according to your hosting needs; default email delivery can have limits.
4. Set Authentication's Site URL to your production app URL. Add the exact local and production app URLs to the allowed Redirect URLs, including any hosting subdirectory and trailing slash, for example `http://127.0.0.1:5173/` and `https://your-domain.example/`.
5. Copy your Project URL and **publishable key** (or legacy public `anon` key) into `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-public-key
   ```

6. Restart Vite after changing environment variables. Create an account, confirm the email, then sign in.

Never use a service-role/secret key in this frontend. Public configuration is included in the browser build; access control is enforced in PostgreSQL. Do not commit `.env.local`.

Sign-up confirmation and password-reset links return to the app. The reset-link flow displays a new-password form before returning to the calculator. Supabase persists the authentication session in the browser; monetary records are stored in the database.

## Calculations

All values are PLN and use the user's custom formula, **not an implementation of Polish tax law**:

```text
base   = hourly rate × working hours
VAT    = base × 23%
brutto = base + VAT
tax    = base × income-tax percentage
netto  = base − tax − accounting − card support − ZUS
```

Defaults: hourly rate **155 PLN**, income tax **10.5%**, accounting **299 PLN**, card support **9 PLN**, ZUS **2619 PLN**. The hourly rate is prefilled and remains editable. Everything except VAT is editable. VAT does not enter the take-home tax base.

Inputs accept a dot or comma decimal separator, with up to two decimal places. Hours can be fractional or zero; negative netto is retained. Base earnings, VAT, and tax are rounded half-up to grosz using integer arithmetic; totals are derived from those rounded components so the breakdown reconciles.

For example, 160 hours at 100 PLN/hour produces base earnings of 16,000 PLN, brutto of **19,680 PLN**, and netto of **11,393 PLN** with the default deductions.

Supported input limits: 10,000 working hours per month, 10,000,000 PLN for each monetary input, and income tax between 0% and 100%. Months must be between January 1000 and December 9999. These are storage/validation bounds, not payroll recommendations.

## Monthly records and defaults

- Choose a month, enter hours, and use **Save month**. Edits are calculated immediately but are not automatically saved.
- Each saved month contains its own hours, hourly rate, tax, and fee snapshot. Opening it restores those exact inputs.
- A new, unsaved month uses the most recent default settings effective on or before that month. Before the first saved defaults, the built-in defaults apply, including an hourly rate of 155 PLN. Saved or inherited hourly rates take precedence over this starting rate.
- Saving changed settings makes them effective from the selected month. They carry forward until a later dated settings change. Existing saved months are never rewritten by default changes.
- Saving only hours does not create an additional defaults version.
- Month changes, refresh, and sign-out prompt before discarding edits. Reload/close warnings depend on the browser; browsers cannot guarantee protection from crashes or forced shutdowns. Unsaved drafts are not stored.
- Records are fetched on login, month changes, and **Refresh**. An internet connection is required to save or fetch; there is no offline write queue or real-time subscription.
- Failed saves keep your inputs. If a response is lost, the server may have committed the save; refresh to confirm the database version before retrying.
- A per-user revision prevents stale overwrites from another device. A conflict keeps the draft and asks you to refresh. Copy any draft values you want to keep before accepting a refresh/discard confirmation.

## Database design

`monthly_records` stores month snapshots; `setting_defaults` stores effective-dated settings; `workspace_versions` serializes saves and detects stale workspaces.

All tables have user ownership and row-level security. Authenticated users can read only their own rows and cannot directly write tables. `save_month` derives ownership from `auth.uid()`, locks the user's revision, validates with database constraints, and atomically updates the snapshot, defaults, and revision. `load_workspace` returns a coherent, user-scoped workspace. Anonymous users cannot call either function.

The definer functions fix their search path and never accept a user ID from the browser. There are no administrative keys in the frontend. Deleting a user cascades to their records. Manage database backups and account deletion through your Supabase administration workflow.

## Deploy

1. Apply the database migration and configure Supabase email/authentication URLs.
2. Set the two public environment variables in your static host's build configuration.
3. Use build command `npm run build` and output directory `dist`.
4. Deploy on an HTTPS static host, such as Netlify, Vercel, or Cloudflare Pages.
5. Add the deployed URL to Supabase Site URL/Redirect URLs and test sign-up confirmation and password recovery.

Environment variables are embedded at build time; changing them requires a rebuild. For a subdirectory deployment, run `npm run build -- --base=/your-subdirectory/` and allow the matching authentication redirect URL. No application server is required beyond Supabase.

### GitHub Pages

The included [deployment workflow](./.github/workflows/deploy-pages.yml) tests and builds the app on pushes to `main`, then publishes `dist` through GitHub Pages.

1. Push the source to `AlexanderTorchynskyi/jdg-calculator`. Do not upload `.env.local`, `node_modules`, or local build archives.
2. In repository **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with the same public values as your local environment. Never add a service-role key. These values are included in the public browser bundle.
3. In **Settings → Pages**, select **GitHub Actions** as the source. Private repositories require a GitHub plan that supports Pages; otherwise a public repository is required. Even when the source repository is private, a standard Pages site is publicly accessible; salary records still require Supabase login.
4. Push to `main` or run **Deploy to GitHub Pages** manually from the Actions tab.
5. Set the Supabase Authentication **Site URL** to `https://alexandertorchynskyi.github.io/jdg-calculator/` and add that exact URL to **Redirect URLs**. Keep `http://127.0.0.1:5173/` allowed for local development.
6. Open the deployed URL and verify email confirmation, sign-in, password recovery, and saved monthly records from both laptop and phone.

The workflow sets Vite's base path from the repository name, so scripts and authentication redirects work under `/jdg-calculator/`. Updating the public configuration requires rerunning the workflow. The workflow checks calculation/database tests; run `npm run test:ui` locally for the separate desktop/mobile browser checks.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

The unit tests cover exact outputs, rounding, zero hours, validation, maximum values, and default resolution. PostgreSQL tests use an in-memory PGlite database to execute the actual migration and verify RPCs, atomic rollback, account isolation/RLS, permission restrictions, and stale-save rejection.

Playwright checks desktop/mobile layouts, preview calculations, authentication flows, persisted monthly UI state across reload and a second page, failed loads/saves, and conflicting saves. Its Supabase HTTP responses are mocked, so these are **not live Supabase/email-delivery tests**. Test servers use ports 5181 and 5182 and are stopped by the runner.

Before relying on a deployment, verify with a real project:

1. Sign up, confirm your email, sign in, reset your password, and sign out.
2. Save a month on a laptop; reload and open the same account on a phone to confirm persistence and synchronization.
3. Change ZUS/rate for another month and confirm saved older months remain unchanged.
4. Sign in with a second account and confirm no first-account data appears.
5. Open the same account on two devices; make conflicting saves and confirm the stale one is rejected.
6. Disconnect the network during a save and confirm edits remain visible without a false success indication.
