// Minimal static-asset Worker for the Scrub-Hub SPA.
// The app is fully client-side; the Worker only serves the built assets.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
