import { contextBridge, ipcRenderer } from "electron";
import type { PetActivity, PetBootstrap, PetBridge, PetEvent, PetEventType, PetPreferences, PetQuestion } from "../shared/types";

const bridge: PetBridge = {
  onCursor:callback=>{const listener=(_event:Electron.IpcRendererEvent,p:{x:number;y:number})=>callback(p);ipcRenderer.on('pet:cursor',listener);return ()=>ipcRenderer.removeListener('pet:cursor',listener);},
  setLayout: layout=>ipcRenderer.send('pet:layout',layout),
  onViewport: callback=>{const listener=(_event:Electron.IpcRendererEvent,v:{left:number;width:number})=>callback(v);ipcRenderer.on('pet:viewport',listener);return ()=>ipcRenderer.removeListener('pet:viewport',listener);},
  getBootstrap: () => ipcRenderer.invoke("pet:get-bootstrap") as Promise<PetBootstrap>,
  rendererReady: () => ipcRenderer.invoke('pet:renderer-ready'),
  savePreferences: (patch) =>
    ipcRenderer.invoke("pet:save-preferences", patch) as Promise<PetPreferences>,
  markRead: (id) => ipcRenderer.invoke("pet:mark-read", id),
  sendTest: (type: PetEventType) => ipcRenderer.invoke("pet:send-test", type),
  openSettings: () => ipcRenderer.send("pet:open-settings"),
  openCodex: () => ipcRenderer.invoke('pet:open-codex'),
  onTransform: (callback) => {
    ipcRenderer.on('pet:transform', callback);
    return () => ipcRenderer.removeListener('pet:transform', callback);
  },
  setMouseIgnored: (ignored) => ipcRenderer.send("pet:set-mouse-ignored", ignored),
  moveWindow: (dx, dy) => ipcRenderer.send("pet:move-window", dx, dy),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: PetEvent) => callback(value);
    ipcRenderer.on("pet:event", listener);
    return () => ipcRenderer.removeListener("pet:event", listener);
  },
  onPreferences: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: PetPreferences) => callback(value);
    ipcRenderer.on("pet:preferences", listener);
    return () => ipcRenderer.removeListener("pet:preferences", listener);
  },
  onActivity: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: PetActivity) => callback(value);
    ipcRenderer.on("pet:activity", listener);
    return () => ipcRenderer.removeListener("pet:activity", listener);
  },
};

contextBridge.exposeInMainWorld("petBridge", bridge);
