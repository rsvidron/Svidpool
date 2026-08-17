import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    // --host is passed in the npm script so you can open the harness from a
    // tablet on the same LAN while the projector machine shows fullscreen.
  },
});
