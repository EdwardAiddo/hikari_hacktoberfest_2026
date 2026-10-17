# demo-app

The target app for the curbfix workflow (`.github/workflows/curbfix.yml`, `APP_DIR: demo-app`). The workflow builds it, serves it with `vite preview` on port 4173, audits it with Detect, and lets Tool 2 fix the violations in the files a PR changed.

**It contains deliberate accessibility bugs. Do not fix them by hand**: they are what curbfix is tested against.

| Bug | Where | axe rule |
| --- | --- | --- |
| logo image without `alt` | `src/components/Header.tsx` | `image-alt` |
| icon-only menu button without a name | `src/components/Header.tsx` | `button-name` |
| email input without a label | `src/components/SignupForm.tsx` | `label` |
| light grey hint text (`#b8b8b8` on white) | `src/App.css`, used in `SignupForm.tsx` | `color-contrast` |
| icon-only footer link without a name | `src/components/Footer.tsx` | `link-name` |
| `<html>` without `lang` | `index.html` | `html-has-lang` |

curbfix only fixes files the PR changed. To see it work, open a PR that touches one of these files (any small edit), and the bot will try to fix the bugs in those files and comment on the PR.

```sh
npm ci
npm run build                      # tsc --noEmit && vite build
npx vite preview --port 4173 --strictPort
```
