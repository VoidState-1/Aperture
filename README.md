# ApertureElectron

`ApertureElectron` is a desktop debug workbench for ACI, rebuilt with Electron + React + TypeScript.

## Features

- Session management (`create/list/select/close`)
- User interaction (`/interact`)
- Assistant output simulation (`/interact/simulate`)
- Tool call simulator (`create` + `action`)
- Direct window action invocation
- Inspector views:
  - raw context
  - raw LLM input
  - current windows and actions

## Run

```bash
cd ApertureElectron
npm install
npm run dev
```

Default backend URL in UI: `http://localhost:5000`

## Build

```bash
npm run build
```

