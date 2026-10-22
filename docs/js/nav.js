import { state } from './state.js';

// ============================================================
// VIEW SWITCHING
// ============================================================
// Secondary tabs render lazily and re-render after data changes. The Today view
// is rendered explicitly by its own module so typed-but-unlogged inputs survive.
const renderers = {};
const staleViews = new Set();

export function registerView(name, render) {
  renderers[name] = render;
  staleViews.add(name);
}

export function markViewsStale() {
  Object.keys(renderers).forEach((name) => staleViews.add(name));
  if (renderers[state.currentView]) switchView(state.currentView);
}

export function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (staleViews.has(view) && renderers[view]) {
    staleViews.delete(view);
    renderers[view]();
  }
}
