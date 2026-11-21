# Repository Guidelines

## Project Structure & Module Organization

The React + TypeScript application lives in `call-calendar/`.
`src/main.tsx` mounts `src/App.tsx`. Keep reusable UI in `src/components/ui/`,
shared utilities in `src/lib/`, imported assets in `src/assets/`, and static
files in `public/`. Vitest tests live in `call-calendar/tests/`.
Root-level `mise.toml` defines tool versions and tasks; `hk.pkl` defines Git
hooks. GitHub Actions workflows live in `.github/workflows/`.

## Build, Test, and Development Commands

Run commands from the repository root:

- `mise trust` and `mise install`: trust the configuration and install pinned tools.
- `mise run setup`: install npm dependencies from the lockfile and install Git hooks.
- `mise run dev`: start Vite in the foreground.
- `mise run dev:start`, `mise run dev:logs`, `mise run dev:stop`: manage background Vite at `http://localhost:5173`.
- `mise run build`: type-check and build into `call-calendar/dist/`.
- `mise run smoke`: run the startup tests.
- `mise run lint` / `mise run fix`: check code or apply available ESLint fixes.
- `mise run generate:api`: generate OpenAPI and the client SDK from TypeSpec.
- `mise run check`: run all quality gates, including security scans; OSV requires network access.

## Commit message conventions
Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commit messages:

<type>[optional scope]: <description>
[optional body]
[optional footer(s)]

Append the issue number to the subject of each commit that implements a ticket.
Example: `feat: запись на свободный слот (#12)`.

Types:
feat: New feature
fix: Bug fix
docs: Documentation changes
style: Code style (formatting, semicolons, etc.)
refactor: Code refactoring without feature/fix
perf: Performance improvements
test: Adding or updating tests
chore: Build process, dependencies, tooling
ci: CI configuration changes

Examples:
feat(api): add agent versioning endpoint
fix(workflow): handle timeout in run execution
docs: update API documentation
refactor(db): simplify connection pooling
Validation (optional):

### Validate a commit message
echo "feat: add new feature" | npx commitlint

### Validate last commit
npx commitlint --from HEAD~1 --to HEAD

## Security & Generated Files

Edit `call-calendar/api/main.tsp` to change the API contract. Regenerate
`call-calendar/api/openapi.yaml` and `call-calendar/src/api/generated/` with
`mise run generate:api`. Do not edit these generated files by hand. Commit
the generated changes with the contract.

Never commit secrets. Do not disable rules to pass checks: exceptions require a
human decision, a specific path and rule, and a reason; security exceptions also
need an enforced expiry. Regenerate the npm lockfile with npm from mise. Do not
hand-edit build output, the upstream Renovate schema snapshot, or the generated
Hexlet workflow. Keep actions pinned to full commit SHAs.

# Repository checks

Run `mise run check` from the repository root before considering a change done.
CI runs the same command. Use `mise run setup` to install dependencies and hooks.
Smoke tests bind a local port. Always request elevated permissions when running
`mise run check`, subject to the environment's approval policy. When the sandbox
blocks local listeners, also request elevated permissions for `mise run smoke`.

Do not disable lint rules to pass checks. Exceptions require a human decision,
a specific path and rule, and a reason. Security exceptions also require an
expiry date enforced by a check.

Do not manually edit `call-calendar/package-lock.json`, build output, or
`schemas/renovate.schema.json`. Regenerate the lockfile with npm; fetch the schema
from its documented upstream URL. Do not edit the generated Hexlet workflow.
## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context layout. See `docs/agents/domain.md`.
