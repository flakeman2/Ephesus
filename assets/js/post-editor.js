(() => {
  'use strict';

  const API = '/post/api';

  const session = { role: null, csrf: null };
  let currentSlug = '';
  let previewTimer = null;
  let previewVisible = false;

  const app = document.getElementById('cms-app');
  const authEl = document.getElementById('cms-auth');
  const workspaceEl = document.getElementById('cms-workspace');
  const queuesEl = document.getElementById('cms-queues');
  const loginForm = document.getElementById('cms-login-form');
  const roleInput = document.getElementById('cms-role');
  const passwordInput = document.getElementById('cms-password');
  const websiteInput = document.getElementById('cms-website');
  const roleBadge = document.getElementById('cms-role-badge');
  const editorViewEl = document.getElementById('cms-editor-view');
  const previewViewEl = document.getElementById('cms-preview-view');
  const togglePreviewBtn = document.getElementById('cms-toggle-preview');
  const contentEl = document.getElementById('cms-content');
  const toolbarEl = document.getElementById('cms-toolbar');
  const previewEl = document.getElementById('cms-preview');
  const previewMetaEl = document.getElementById('cms-preview-meta');
  const draftsEl = document.getElementById('cms-drafts-list');
  const reviewEl = document.getElementById('cms-review');
  const reviewListEl = document.getElementById('cms-review-list');
  const statusEl = document.getElementById('cms-status');

  if (!app || !authEl || !workspaceEl || !queuesEl || !contentEl || !editorViewEl || !previewViewEl || !togglePreviewBtn) return;

  function starterPost() {
    const today = new Date().toISOString().slice(0, 10);
    return `---
title: "Your post title"
date: ${today}
author: Devin Flake
layout: post
permalink: /your-post-slug/
tags: [general]
verification: "I read and verified this post before publishing."
---

Write the post body here.
`;
  }

  function setStatus(message, kind = 'info') {
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.className = 'cms-status';
      delete statusEl.dataset.kind;
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = `cms-status cms-status--${kind}`;
    statusEl.dataset.kind = kind;
  }

  function clearProblemStatus() {
    const kind = statusEl && statusEl.dataset.kind;
    if (kind === 'warning' || kind === 'error') setStatus('');
  }

  function clearSession() {
    session.role = null;
    session.csrf = null;
  }

  function resetView() {
    editorViewEl.hidden = false;
    previewViewEl.hidden = true;
    previewVisible = false;
    togglePreviewBtn.textContent = 'Preview';
  }

  function showAuth() {
    resetView();
    authEl.hidden = false;
    workspaceEl.hidden = true;
    queuesEl.hidden = true;
  }

  function showWorkspace(role) {
    resetView();
    authEl.hidden = true;
    workspaceEl.hidden = false;
    queuesEl.hidden = false;
    roleBadge.textContent = role;
    reviewEl.hidden = role !== 'admin';
    document.getElementById('cms-publish').hidden = role !== 'admin';
    document.getElementById('cms-submit').hidden = role === 'admin';
  }

  async function api(path, options = {}) {
    const { method = 'GET', body, csrf = true, quiet401 = false } = options;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && session.csrf && method !== 'GET' && method !== 'HEAD') {
      headers['X-CSRF-Token'] = session.csrf;
    }

    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (_) {
      throw new Error('Could not reach the post API. Check your connection and try again.');
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      // A non-JSON error still becomes a useful generic failure below.
    }

    if (!response.ok) {
      if (response.status === 401 && path !== '/login' && !quiet401) {
        clearSession();
        showAuth();
        setStatus('Your session expired. Sign in again.', 'error');
      }
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  async function withBusy(button, action) {
    if (!button || button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      await action();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  function safeLink(url, text) {
    let parsed;
    try {
      parsed = new URL(url, window.location.origin);
    } catch (_) {
      return document.createTextNode(text);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return document.createTextNode(text);
    }
    const link = document.createElement('a');
    link.href = parsed.href;
    link.textContent = text;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function sanitizeHTML(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
    parsed.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return parsed.body.innerHTML;
  }

  function renderMeta(data) {
    previewMetaEl.replaceChildren();
    const dl = document.createElement('dl');
    const fields = [
      ['Title', data.title],
      ['Permalink', data.permalink],
      ['Slug', data.slug],
      ['Tags', Array.isArray(data.tags) ? data.tags.join(', ') : null],
      ['AI models (optional)', Array.isArray(data.ai_models) ? data.ai_models.join(', ') : null],
      ['Verification', data.verification],
    ];
    fields.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '—';
      dl.append(dt, dd);
    });
    previewMetaEl.append(dl);
  }

  function renderQueue(container, items, kind) {
    container.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cms-empty';
      empty.textContent = kind === 'review' ? 'No posts waiting for review.' : 'No open drafts.';
      container.append(empty);
      return;
    }

    const list = document.createElement('ul');
    items.forEach((item) => {
      const li = document.createElement('li');
      const title = document.createElement('div');
      title.className = 'cms-queue-title';
      title.textContent = item.title || `Pull request #${item.number}`;

      const meta = document.createElement('div');
      meta.className = 'cms-queue-meta';
      meta.append(document.createTextNode(`#${item.number}`));
      if (item.branch) meta.append(document.createTextNode(` · ${item.branch}`));
      (item.labels || []).forEach((name) => {
        const badge = document.createElement('span');
        badge.className = 'cms-label';
        badge.textContent = name;
        meta.append(document.createTextNode(' '), badge);
      });
      if (item.url) {
        meta.append(document.createTextNode(' · '), safeLink(item.url, 'Open pull request'));
      }

      li.append(title, meta);
      if (kind === 'review' && (item.labels || []).includes('cms/guest')) {
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.dataset.number = String(item.number);
        approve.textContent = 'Approve guest post';
        li.append(approve);
      }
      list.append(li);
    });
    container.append(list);
  }

  async function refreshPreview(options = {}) {
    const { silent = false, announce = false } = options;
    if (!session.role) return null;

    const content = contentEl.value;
    if (!content.trim()) {
      currentSlug = '';
      previewMetaEl.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'cms-empty';
      empty.textContent = 'Start writing to see a preview.';
      previewEl.replaceChildren(empty);
      clearProblemStatus();
      return null;
    }

    try {
      const data = await api('/preview', { method: 'POST', body: { content } });
      currentSlug = data.slug;
      renderMeta(data);
      previewEl.innerHTML = sanitizeHTML(data.html || '');
      if (data.warnings) {
        setStatus(data.warnings, 'warning');
      } else {
        clearProblemStatus();
        if (announce) {
          setStatus(`Preview updated for “${data.title || data.slug}”.`, 'success');
        }
      }
      return data.slug;
    } catch (error) {
      if (!silent) setStatus(error.message, 'error');
      throw error;
    }
  }

  async function validatedSlug() {
    const slug = await refreshPreview({ silent: true });
    if (!slug) throw new Error('Add front matter with a title and permalink before continuing.');
    return slug;
  }

  async function loadDrafts() {
    const data = await api('/drafts');
    renderQueue(draftsEl, data.drafts, 'drafts');
  }

  async function loadReview() {
    if (session.role !== 'admin') return;
    const data = await api('/review');
    renderQueue(reviewListEl, data.reviews, 'review');
  }

  async function loadLists() {
    await Promise.allSettled([loadDrafts(), loadReview()]);
  }

  function applyFormat(prefix, suffix, placeholder) {
    const start = contentEl.selectionStart;
    const end = contentEl.selectionEnd;
    const hadSelection = end !== start;
    const selected = hadSelection ? contentEl.value.slice(start, end) : placeholder;
    contentEl.setRangeText(prefix + selected + suffix, start, end, 'end');
    if (!hadSelection && placeholder) {
      const from = start + prefix.length;
      contentEl.setSelectionRange(from, from + placeholder.length);
    }
    contentEl.focus();
    contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const formats = {
    bold: ['**', '**', 'bold text'],
    italic: ['*', '*', 'italic text'],
    code: ['`', '`', 'code'],
    link: ['[', '](https://example.com)', 'link text'],
    heading: ['## ', '', 'Heading'],
    list: ['- ', '', 'list item'],
    quote: ['> ', '', 'quote'],
    table: ['| Item | Value |\n| --- | --- |\n| ', ' | example |\n', 'item'],
  };

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(loginForm.querySelector('button[type="submit"]'), async () => {
      try {
        const data = await api('/login', {
          method: 'POST',
          csrf: false,
          body: {
            role: roleInput.value,
            password: passwordInput.value,
            website: websiteInput.value,
          },
        });
        session.role = data.role;
        session.csrf = data.csrf;
        passwordInput.value = '';
        websiteInput.value = '';
        showWorkspace(data.role);
        if (!contentEl.value.trim()) contentEl.value = starterPost();
        setStatus(`Signed in as ${data.role}.`, 'success');
        await loadLists();
        await refreshPreview().catch(() => {});
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });

  document.getElementById('cms-logout').addEventListener('click', (buttonEvent) => {
    withBusy(buttonEvent.currentTarget, async () => {
      try {
        await api('/logout', { method: 'POST' });
      } catch (_) {
        // Clear locally even if the session already expired.
      }
      clearSession();
      contentEl.value = '';
      currentSlug = '';
      previewMetaEl.replaceChildren();
      renderQueue(draftsEl, [], 'drafts');
      renderQueue(reviewListEl, [], 'review');
      showAuth();
      setStatus('Signed out.', 'success');
    });
  });

  toolbarEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !formats[button.dataset.action]) return;
    applyFormat(...formats[button.dataset.action]);
  });

  contentEl.addEventListener('input', () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      refreshPreview().catch(() => {});
    }, 1500);
  });

  togglePreviewBtn.addEventListener('click', async () => {
    if (togglePreviewBtn.disabled) return;
    if (previewVisible) {
      resetView();
      return;
    }
    togglePreviewBtn.disabled = true;
    togglePreviewBtn.textContent = 'Loading…';
    try {
      await refreshPreview();
      editorViewEl.hidden = true;
      previewViewEl.hidden = false;
      previewVisible = true;
    } catch (_) {
      // refreshPreview already reported the error in the status box.
      return;
    } finally {
      togglePreviewBtn.disabled = false;
      togglePreviewBtn.textContent = previewVisible ? 'Edit' : 'Preview';
    }
  });

  document.getElementById('cms-save').addEventListener('click', (event) => {
    withBusy(event.currentTarget, async () => {
      try {
        const slug = await validatedSlug();
        const data = await api('/drafts', {
          method: 'POST',
          body: { slug, content: contentEl.value },
        });
        setStatus(`Draft saved on ${data.branch}.`, 'success');
        await loadDrafts();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });

  document.getElementById('cms-submit').addEventListener('click', (event) => {
    withBusy(event.currentTarget, async () => {
      try {
        const slug = await validatedSlug();
        const data = await api('/submit', {
          method: 'POST',
          body: { slug, content: contentEl.value },
        });
        setStatus(`${data.message}${data.url ? ` Pull request: ${data.url}` : ''}`, 'success');
        await loadLists();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });

  document.getElementById('cms-publish').addEventListener('click', (event) => {
    withBusy(event.currentTarget, async () => {
      try {
        const slug = await validatedSlug();
        const data = await api('/publish', {
          method: 'POST',
          body: { slug, content: contentEl.value },
        });
        setStatus(`${data.message}${data.url ? ` Pull request: ${data.url}` : ''}`, 'success');
        await loadLists();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });

  reviewListEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-number]');
    if (!button) return;
    withBusy(button, async () => {
      try {
        const data = await api('/approve', {
          method: 'POST',
          body: { number: Number(button.dataset.number) },
        });
        setStatus(data.message, 'success');
        await loadLists();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  });

  async function restoreSession() {
    try {
      const me = await api('/me', { quiet401: true });
      session.role = me.role;
      session.csrf = me.csrf;
      showWorkspace(me.role);
      if (!contentEl.value.trim()) contentEl.value = starterPost();
      await loadLists();
      await refreshPreview().catch(() => {});
    } catch (_) {
      clearSession();
      showAuth();
    }
  }

  showAuth();
  renderQueue(draftsEl, [], 'drafts');
  renderQueue(reviewListEl, [], 'review');
  restoreSession();
})();
