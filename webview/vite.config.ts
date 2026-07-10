import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // The webview loads this bundle via a vscode-webview:// URI, not from a
  // server root — every asset reference must be relative so ChatViewProvider
  // can rewrite it to webview.asWebviewUri().
  base: './',
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
  },
});
