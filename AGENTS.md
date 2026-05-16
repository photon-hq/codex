# Repository Code Standards

This project uses **Ultracite** (a strict preset on top of Biome 2) for linting
and formatting. CI runs `bunx biome ci .` on every push and rejects unformatted
or rule-violating code, so AI agents and humans should follow the rules below to
avoid pipeline failures.

## Quick Reference

- **Format + lint with autofix**: `bunx ultracite fix`
- **Check for issues**: `bunx ultracite check`
- **CI-equivalent (read-only)**: `bunx biome ci .`
- **Type-check**: `bun run typecheck`
- **Build**: `bun run build`

Run `bunx ultracite fix` before committing — it handles 95% of issues automatically.

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
- Specify all dependencies in hook dependency arrays correctly. Define hoisted
  callbacks (`useCallback`) **above** the `useEffect` that depends on them.
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices).
- Nest children between opening and closing tags instead of passing as props.
- Don't define components inside other components.
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images.
  - Use proper heading hierarchy.
  - Add labels for form inputs.
  - Include keyboard event handlers alongside mouse events.
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of `<div role="…">`.

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` from production UI code. The
  long-running bridge worker (`bridge/`) is allowed structured `console.*` for
  live observability.
- Throw `Error` objects with descriptive messages, not strings or other values.
- Use `try-catch` blocks meaningfully — don't catch errors just to rethrow them.
- Prefer early returns over nested conditionals for error cases.

### Code Organization

- Keep functions focused. If a function passes ultracite's cognitive-complexity
  check, it's small enough.
- Extract complex conditions into well-named boolean variables.
- Use early returns to reduce nesting.
- Prefer simple conditionals over nested ternary operators.

### Security

- Add `rel="noopener noreferrer"` when using `target="_blank"` on links.
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary.
- Don't use `eval()` or assign directly to `document.cookie`.
- Validate and sanitize user input.

### Performance

- Avoid spread syntax in accumulators within loops.
- Hoist regex literals to module scope when used inside hot paths.
- Prefer specific imports over namespace imports (with the exception of
  drizzle-orm `* as schema` which is documented in the codebase).
- Use Next.js `<Image>` for marketing-page imagery; the OAuth/marketing pages
  in this repo intentionally render `<img>` for the OpenAI persistent CDN.

### Next.js (App Router)

- Use Server Components for async data fetching instead of async Client Components.
- Use the App Router metadata API for head elements.

### React 19+

- Use `ref` as a prop instead of `React.forwardRef`.

---

## Project Conventions

- **Comments**: only explain *why* (constraints, trade-offs, external API quirks, doc links).
  Do NOT narrate what the code does (e.g. `// loop over items`, `// return the result`).
- **DB schema changes**: edit `db/schema.ts`, then run `bun run db:push` on the target env.
  No migrations folder — Drizzle-kit applies the diff directly.
- **Secrets**: never commit `.env`; encrypted-at-rest fields on `tenants` use
  AES-256-GCM via `lib/crypto.ts`.
- **Fire-and-forget promises**: prefix with `void` (e.g. `void this.loop()`).
  This rule is opted-out of ultracite's `noVoid` for the codebase.
- **Per-file rule overrides** live in `biome.json` under `overrides`. Add a new
  entry rather than sprinkling `// biome-ignore` comments.

## Testing

- Write assertions inside `it()` or `test()` blocks.
- Avoid done callbacks in async tests — use async/await instead.
- Don't use `.only` or `.skip` in committed code.
- Keep test suites reasonably flat — avoid excessive `describe` nesting.

## When Ultracite Can't Help

Ultracite catches most issues automatically. Focus your attention on:

1. **Business logic correctness** — Ultracite can't validate your algorithms.
2. **Meaningful naming** — descriptive names for functions, variables, and types.
3. **Architecture decisions** — component structure, data flow, and API design.
4. **Edge cases** — boundary conditions and error states.
5. **User experience** — accessibility, performance, and usability.
6. **Documentation** — comment complex logic, but prefer self-documenting code.

---

Run `bunx ultracite fix && bun run typecheck` before committing to keep CI green.
