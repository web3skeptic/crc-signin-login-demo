import { defineConfig } from 'vite';

// `base: './'` makes all built asset URLs relative, so the site works whether it's
// served from a domain root or from a GitHub Pages project subpath
// (e.g. https://web3skeptic.github.io/crc-signin-login-demo/).
export default defineConfig({
  base: './',
  server: { port: 5183 },
});
