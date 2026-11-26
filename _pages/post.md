---
layout: page
title: Post editor
permalink: /post/
description: Write, preview, and submit posts for the Flake blog.
---

<div id="cms-app" class="cms-app">
  <div id="cms-status" class="cms-status" role="status" aria-live="polite" hidden></div>
  <noscript>
    <p class="cms-status cms-status--error">JavaScript is required to use the post editor.</p>
  </noscript>

  <section id="cms-auth" class="cms-card" aria-labelledby="cms-auth-title">
    <h2 id="cms-auth-title">Sign in</h2>
    <p>
      Admin posts publish immediately. Guest posts are saved as drafts and wait
      for admin approval before they go live.
    </p>
    <form id="cms-login-form" class="cms-auth-form">
      <label class="cms-field">
        <span>Role</span>
        <select id="cms-role" name="role" autocomplete="username">
          <option value="admin">Admin</option>
          <option value="guest">Guest</option>
        </select>
      </label>
      <label class="cms-field">
        <span>Password</span>
        <input id="cms-password" name="password" type="password" autocomplete="current-password" required>
      </label>
      <div class="cms-honeypot" aria-hidden="true">
        <label>Website
          <input id="cms-website" name="website" type="text" tabindex="-1" autocomplete="off">
        </label>
      </div>
      <button type="submit">Sign in</button>
    </form>
  </section>

  <section id="cms-workspace" class="cms-card" aria-label="Post editor workspace" hidden>
    <div class="cms-header">
      <p class="cms-queue-meta">
        Editing as <strong id="cms-role-badge" class="cms-badge">guest</strong>.
        Drafts live on <code>cms/&lt;slug&gt;</code> branches in the blog repository.
      </p>
      <div class="cms-header-actions">
        <button id="cms-toggle-preview" type="button">Preview</button>
        <button id="cms-logout" type="button">Sign out</button>
      </div>
    </div>

    <div id="cms-editor-view" class="cms-view">
      <div id="cms-toolbar" class="cms-toolbar" aria-label="Markdown formatting">
        <button type="button" data-action="bold" title="Bold"><strong>B</strong></button>
        <button type="button" data-action="italic" title="Italic"><em>I</em></button>
        <button type="button" data-action="code" title="Inline code">&lt;/&gt;</button>
        <button type="button" data-action="link" title="Link">Link</button>
        <button type="button" data-action="heading" title="Heading">H2</button>
        <button type="button" data-action="list" title="Bullet list">List</button>
        <button type="button" data-action="quote" title="Quote">Quote</button>
        <button type="button" data-action="table" title="Table">Table</button>
      </div>
      <label class="cms-field">
        <span>Markdown with Jekyll front matter</span>
        <textarea id="cms-content" spellcheck="true" autocapitalize="off" autocomplete="off"></textarea>
      </label>
      <div class="cms-actions">
        <button id="cms-save" type="button">Save for later</button>
        <button id="cms-submit" type="button">Submit for review</button>
        <button id="cms-publish" type="button" class="cms-primary" hidden>Publish</button>
      </div>
    </div>

    <div id="cms-preview-view" class="cms-view" hidden>
      <h3>Preview</h3>
      <div id="cms-preview-meta" class="cms-preview-meta"></div>
      <article id="cms-preview" class="cms-preview">
        <p class="cms-empty">Sign in and start writing to see a preview.</p>
      </article>
    </div>

    <div class="cms-queue">
      <h3>Open drafts</h3>
      <div id="cms-drafts-list"><p class="cms-empty">Loading drafts…</p></div>
    </div>

    <div id="cms-review" class="cms-queue" hidden>
      <h3>Admin review queue</h3>
      <div id="cms-review-list"><p class="cms-empty">Loading review queue…</p></div>
    </div>
  </section>
</div>

<script src="/assets/js/post-editor.js" defer></script>
