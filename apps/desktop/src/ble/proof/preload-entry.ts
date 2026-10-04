// The proof window's preload: exposes the app's bridge exactly as the desktop app's preload does.
import { contextBridge, ipcRenderer } from 'electron';
import { bluetoothBridge } from '../preload';

contextBridge.exposeInMainWorld('vitalsDesktop', { bluetooth: bluetoothBridge(ipcRenderer) });
