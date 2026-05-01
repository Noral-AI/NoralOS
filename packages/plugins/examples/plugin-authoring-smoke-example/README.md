# Plugin Authoring Smoke Example

A NoralOS plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into NoralOS

```bash
pnpm noralos plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@noralos/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
