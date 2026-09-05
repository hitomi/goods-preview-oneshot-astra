# 制物 Studio · project instructions

Read `docs/PLAN.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, and `docs/PROGRESS.md` before continuing substantial work. These files preserve the agreed scope and decisions across context compaction. Update progress after each milestone; never mark an unverified feature complete.

- This is a Chinese-language, entirely local PWA for manufacturing-aware merchandise mockups. No accounts, cloud uploads, remote fonts, analytics, remote textures, or runtime network dependencies.
- Use Node 24 (`fnm use`), npm, React/TypeScript, Vite, TanStack Router, and Three.js. Run `npm run check`, `npm test`, `npm run build`, and relevant Playwright workflows.
- Preserve original imported files. Preview images may be bounded, but exports/backups must retain originals. IndexedDB is authoritative; show saved only after its transaction commits.
- Manufacturing advice has provenance and severity. Never claim a generic mockup guarantees production suitability or exact color. Keep incompatible processes unavailable; explain manufacturer-dependent checks concretely.
- Keep processing, domain validation, persistence, and rendering separate from user interface. Render on demand and dispose GPU resources/object URLs.
- Document implementation limitations honestly in `docs/PROGRESS.md` and user-facing help where actionable.
- Cloudflare Pages setup is documented in `docs/DEPLOYMENT.md`. Hosting distributes static application files; user projects and images remain local. Keep configuration readiness distinct from an actual verified deployment.
- The current handoff authorizes committing as `codex <codex@openai.com>` and pushing `main` to `https://github.com/hitomi/goods-preview-oneshot-astra.git`, including Pages configuration. Live Cloudflare publishing has not been requested.
