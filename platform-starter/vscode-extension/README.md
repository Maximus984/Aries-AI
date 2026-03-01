# Aries VS Code Extension Starter

## Run Locally

```bash
npm install
npm run build
```

Press `F5` in VS Code to launch Extension Development Host.

Set:
- `aries.apiBaseUrl`
- `aries.apiKey`

## Publish

1. Install tool:

```bash
npm i -g @vscode/vsce
```

2. Package:

```bash
vsce package
```

3. Publish:

```bash
vsce publish
```
