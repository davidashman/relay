import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import '@vscode/codicons/dist/codicon.css';
import '@mdi/font/css/materialdesignicons.min.css';
import 'virtual:svg-icons-register';

declare global {
  interface Window {
    acquireVsCodeApi?: <T = unknown>() => {
      postMessage(data: T): void;
      getState(): any;
      setState(data: any): void;
    };
    RELAY_BOOTSTRAP?: {
      host?: 'sidebar' | 'editor' | 'panel';
      page?: string;
      /** Stable unique panel key (for webviewId) */
      id?: string;
      /** Session to preload — separate from the panel key */
      sessionId?: string;
      title?: string;
    };
  }
}

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.mount('#app');
