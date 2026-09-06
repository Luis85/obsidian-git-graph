// harness/main.ts imports the plugin stylesheet and the harness theme for their side effects.
// Vite handles those imports; TypeScript needs to be told they are modules.
declare module '*.css';
