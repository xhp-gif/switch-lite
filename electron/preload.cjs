// 渲染进程桥：设置页「检查更新」按钮与更新状态事件
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('switchliteDesktop', {
  checkUpdate: () => ipcRenderer.invoke('switchlite:check-update'),
  quitAndInstall: () => ipcRenderer.invoke('switchlite:quit-and-install'),
  onUpdateStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on('switchlite:update-status', listener);
    return () => ipcRenderer.removeListener('switchlite:update-status', listener);
  },
});
