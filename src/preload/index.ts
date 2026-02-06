import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("aperture", {
  platform: process.platform,
  versions: process.versions
});

