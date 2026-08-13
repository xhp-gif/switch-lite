import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, watchSystemTheme, getTheme } from './theme';
import './styles.css';

applyTheme();
// 跟随系统模式下，系统主题变化时实时重应用
watchSystemTheme(() => {
  if (getTheme() === 'system') applyTheme('system');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
