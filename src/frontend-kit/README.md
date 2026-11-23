# Horse DB Frontend Integration Kit

This directory is the supported integration surface for independently-created Horse DB frontends.

External frontends should import from **`src/frontend-kit/index.ts` only**. Integrated frontends receive the real `runtime.platform`; standalone/AI prototypes may use `createMockPlatformClient()`.

Public kit surface includes:

- canonical platform DTOs + `PlatformClient` interface
- frontend manifest/compatibility helpers
- feature/permission helpers
- stable `PlatformClientError`
- canonical public route helpers/parser
- runtime/adapter types
- shared frontend asset types
- field-based registry-search helpers
- in-memory mock platform with capability/auth failure simulation

The production HTTP adapter (`platformClient.ts`) is **host infrastructure**, not a plugin import. Frontends must not construct HTTP requests, handle CSRF, or know `/api/*` routes.

Current v0.36 optional intelligence services are also exposed only through `PlatformClient`: structural pedigree metrics, ancestor-path tracing, pedigree coefficients, relationship atlas/coefficients, structured horse insights, and whole-registry analytics. A frontend may declare them optional and remain portable to another backend that omits them.

Useful commands:

```text
npm run frontend:new -- my-ui "My UI"
npm run validate:frontends
npm run validate:frontends:json
npm run typecheck:frontend-kit
```

See:

- `docs/FRONTEND_AGENT_BRIEF.md`
- `docs/FRONTEND_INTEGRATION_PLAYBOOK.md`
- `docs/FRONTEND_PLATFORM_CONTRACT.md`
- `docs/PLATFORM_EXTENSION_POLICY.md`
- `docs/SHARED_MODULE_STRATEGY.md`
