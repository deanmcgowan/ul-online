# Contributing

Contributions are very welcome. This page covers the practical bits of how to contribute — what to include in a PR, code style expectations, and so on.

---

## Getting started

1. Fork the repository and create a branch from `main`.
2. Follow the [Configuration](Configuration) and [Development Guide](Development-Guide) pages to get a working local setup.
3. Make your changes on the branch.
4. Open a pull request against `main` on the upstream repository.

---

## What to include in a pull request

Every PR should have:

- **A short summary** of what the change does and why
- **Screenshots** for any UI change, including before and after if applicable
- **Setup notes** if the change requires a new environment variable, a migration, or a config step

Small, well-scoped PRs are much easier to review than large ones. If you're unsure whether something is worth doing, open an issue first to discuss it.

---

## Code style

The project uses ESLint (`eslint.config.js`) and TypeScript in strict mode. Run the linter before pushing:

```bash
npm run lint
```

There's no enforced formatter at the time of writing, so match the style of the file you're editing. The codebase uses 2-space indentation throughout.

### TypeScript

- Prefer explicit return types on public hook and utility functions.
- Avoid `any` — use `unknown` and narrow it, or add a proper type.
- Keep component prop interfaces above the component definition.

### React

- Hooks go in `src/hooks/`, pure utility functions and types go in `src/lib/`.
- Keep components focused — if a component is growing large, split it.
- Prefer named exports for components; default exports are fine for page components.

### Internationalisation

If your change touches any user-visible string, add it to both the `en-GB` and `sv-SE` blocks in `src/lib/i18n.ts`. The TypeScript compiler will tell you if you've missed a key.

---

## Tests

- Add a unit test in `src/test/` or alongside the file if you're adding new logic to `src/lib/`.
- Add a Playwright spec under `e2e/` for new user-facing flows where that makes sense.
- Run all tests before opening a PR:

```bash
npm run test
npx playwright test
```

---

## Database changes

If your change requires a schema change:

1. Create a new Supabase migration file (see [Data Model — Adding a migration](Data-Model#adding-a-migration)).
2. Describe the change in the PR and mention any data backfill steps needed.
3. Update the [Data Model](Data-Model) wiki page if the schema change is significant.

---

## Sensitive data

Never commit API keys, passwords, service role keys, or `.env` files. The `.gitignore` already excludes common environment files, but double-check before pushing.

If you accidentally commit a secret, revoke it immediately and rotate it — do not assume the commit history is private.

---

## Roadmap

Current open areas that would benefit from contributions:

- Upcoming stops for a selected vehicle (backend groundwork exists)
- Route search and line filtering
- Saved favourite stops on the commute dashboard
- Improved mobile UX for the bottom sheet
- CI/CD pipeline and deployment documentation
- Screenshots and a demo GIF in the README

See the [README — Roadmap ideas](../README.md#roadmap-ideas) section for the full list.
