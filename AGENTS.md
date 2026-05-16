# Repository Code Standards

This project uses **Biome** for linting and formatting. CI runs `bunx biome ci .`
on every push and rejects unformatted code, so AI agents and humans should follow
the rules below to avoid pipeline failures.

## Quick Reference

- **Format code**: `bunx biome format --write .`
- **Apply lint + format fixes**: `bunx biome check --write .`
- **CI-equivalent (read-only)**: `bunx biome ci .`
- **Type-check**: `bun run typecheck`
- **Build**: `bun run build`

Most issues are autofixable — run `bunx biome check --write .` before committing.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Favor
clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity.
- Prefer `unknown` over `any` when the type is genuinely unknown.
- Use const assertions (`as const`) for immutable values and literal types.
- Leverage TypeScript's type narrowing instead of type assertions.
- Use meaningful variable names instead of magic numbers — extract constants with descriptive names.

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions.
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops.
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access.
- Prefer template literals over string concatenation.
- Use destructuring for object and array assignments.
- Use `const` by default, `let` only when reassignment is needed, never `var`.
- Keep imports at the top of the file; never use dynamic `import()` for type-only or eagerly-needed modules.

### Async & Promises

- Always `await` promises in async functions; don't drop the return value.
- Use `async/await` syntax instead of promise chains for better readability.
- Handle errors appropriately in async code with try-catch blocks.
- Don't use async functions as Promise executors.

### React & JSX

- Use function components over class components.
- Call hooks at the top level only, never conditionally.
- Specify all dependencies in hook dependency arrays correctly.
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices).
- Nest children between opening and closing tags instead of passing as props.
- Don't define components inside other components.
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images.
  - Use proper heading hierarchy.
  - Add labels for form inputs.
  - Include keyboard event handlers alongside mouse events.
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles.

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code.
- Throw `Error` objects with descriptive messages, not strings or other values.
- Use `try-catch` blocks meaningfully — don't catch errors just to rethrow them.
- Prefer early returns over nested conditionals for error cases.

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits.
- Extract complex conditions into well-named boolean variables.
- Use early returns to reduce nesting.
- Prefer simple conditionals over nested ternary operators.
- Group related code together and separate concerns.

### Security

- Add `rel="noopener"` (or `noopener noreferrer`) when using `target="_blank"` on links.
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary.
- Don't use `eval()` or assign directly to `document.cookie`.
- Validate and sanitize user input.

### Performance

- Avoid spread syntax in accumulators within loops.
- Use top-level regex literals instead of creating them in loops.
- Prefer specific imports over namespace imports.
- Avoid barrel files (index files that re-export everything).
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags when on Next.js routes.

### Framework-Specific Guidance

**Next.js (App Router):**

- Use `<Image>` for images on Next routes.
- Use the App Router metadata API for head elements.
- Use Server Components for async data fetching instead of async Client Components.

**React 19+:**

- Use `ref` as a prop instead of `React.forwardRef`.

---

## Project Conventions

- **Comments**: only explain *why* (constraints, trade-offs, external API quirks, doc links).
  Do NOT narrate what the code does (e.g. `// loop over items`, `// return the result`).
- **Logging**: keep `console.log/warn/error` only for the long-running bridge worker
  (`bridge/`) where they aid live debugging. UI/route handlers should not log to console.
- **Imports**: keep ordered (external → `@/...` aliases → relative). Biome enforces this.
- **DB schema changes**: edit `db/schema.ts`, then run `bun run db:push` on the target env.
  No migrations folder — Drizzle-kit applies the diff directly.
- **Secrets**: never commit `.env`; the encrypted-at-rest fields live on `tenants`
  and use AES-256-GCM via `lib/crypto.ts`.

## Testing

- Write assertions inside `it()` or `test()` blocks.
- Avoid done callbacks in async tests — use async/await instead.
- Don't use `.only` or `.skip` in committed code.
- Keep test suites reasonably flat — avoid excessive `describe` nesting.

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** — Biome can't validate your algorithms.
2. **Meaningful naming** — descriptive names for functions, variables, and types.
3. **Architecture decisions** — component structure, data flow, and API design.
4. **Edge cases** — boundary conditions and error states.
5. **User experience** — accessibility, performance, and usability.
6. **Documentation** — comment complex logic, but prefer self-documenting code.

---

Run `bunx biome check --write .` before committing to keep CI green.
