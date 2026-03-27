// === Tab switching ===
function activateTab(tabId) {
  const tabBtn = document.querySelector(`.tabs button[data-tab="${tabId}"]`);
  if (!tabBtn) return;
  const parent = tabBtn.closest('.tabs').parentElement;

  tabBtn.closest('.tabs').querySelectorAll('button').forEach(b => b.classList.remove('active'));
  parent.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

  tabBtn.classList.add('active');
  const target = parent.querySelector(`#tab-${tabId}`);
  if (target) target.classList.add('active');
}

document.querySelectorAll('.tabs button[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Activate tab from ?tab= query param
(function() {
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  if (tab) activateTab(tab);
})();

// === Copy to clipboard ===
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.copy || btn.previousElementSibling?.textContent;
    if (text) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 2000);
      });
    }
  });
});

// === Password field toggle ===
document.querySelectorAll('input[name="use_password"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const form = cb.closest('form');
    const pwField = form?.querySelector('[id^="password-field"]');
    if (pwField) {
      pwField.style.display = cb.checked ? '' : 'none';
    }
  });
});

// === TTL preset toggle ===
document.querySelectorAll('select[name="ttl_preset"]').forEach(sel => {
  const form = sel.closest('form');
  const customRow = form?.querySelector('.custom-ttl-row');
  if (!customRow) return;
  sel.addEventListener('change', () => {
    customRow.style.display = sel.value === 'custom' ? '' : 'none';
  });
});

// === Stored Data Panel ===
(function initStoredPanel() {
  const listItems = document.querySelectorAll('.stored-list-item');
  const contentArea = document.getElementById('stored-content');
  if (!listItems.length || !contentArea) return;

  listItems.forEach(btn => {
    btn.addEventListener('click', () => {
      // Mark active
      listItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const id = btn.dataset.id;
      const type = btn.dataset.type;
      loadStoredContent(id, type);
    });
  });

  async function loadStoredContent(id, type) {
    contentArea.innerHTML = '<p class="text-muted">Loading...</p>';

    try {
      const res = await fetch(`/stored/content/${id}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();

      if (data.type === 'note') {
        renderNote(data);
      } else {
        renderFile(data);
      }
    } catch (err) {
      contentArea.innerHTML = '<div class="alert alert-error">Failed to load content.</div>';
    }
  }

  function renderNote(data) {
    contentArea.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = data.title;
    title.style.marginTop = '0';
    contentArea.appendChild(title);

    const pre = document.createElement('pre');
    pre.textContent = data.content;
    contentArea.appendChild(pre);

    const actions = document.createElement('div');
    actions.className = 'stored-content-actions';

    const editBtn = document.createElement('a');
    editBtn.href = `/stored/note/${data.id}`;
    editBtn.className = 'outline btn-sm';
    editBtn.role = 'button';
    editBtn.textContent = 'Edit';
    actions.appendChild(editBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'outline btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.content).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 2000);
      });
    });
    actions.appendChild(copyBtn);

    appendDeleteBtn(actions, data.id);
    contentArea.appendChild(actions);
  }

  function renderFile(data) {
    contentArea.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = data.title;
    title.style.marginTop = '0';
    contentArea.appendChild(title);

    const info = document.createElement('div');
    info.className = 'stored-file-info';
    info.innerHTML =
      '<p><strong>' + escapeHtml(data.fileName) + '</strong></p>' +
      '<p class="file-meta">' + escapeHtml(data.fileMime) + ' &middot; ' + formatSize(data.fileSize) + '</p>';
    contentArea.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'stored-content-actions';

    const dlBtn = document.createElement('a');
    dlBtn.href = `/stored/file/${data.id}`;
    dlBtn.className = 'outline btn-sm';
    dlBtn.role = 'button';
    dlBtn.textContent = 'Download';
    actions.appendChild(dlBtn);

    appendDeleteBtn(actions, data.id);
    contentArea.appendChild(actions);
  }

  function appendDeleteBtn(container, id) {
    const btn = document.createElement('button');
    btn.className = 'outline secondary btn-sm';
    btn.textContent = 'Delete';
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this item?')) return;
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `/stored/delete/${id}`;
      document.body.appendChild(form);
      form.submit();
    });
    container.appendChild(btn);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
})();

// === Share View Page ===
(function initViewPage() {
  const ctx = window.__shareContext;
  if (!ctx) return;

  const rawHash = location.hash.slice(1);
  if (!rawHash && !ctx.hasPassword) {
    document.getElementById('loading-indicator')?.remove();
    const area = document.getElementById('content-area');
    if (area) area.innerHTML = '<div class="alert alert-error">No encryption key found in URL.</div>';
    return;
  }

  // Parse hash: split on first "." — left part is encryption key (base64url, no dots),
  // right part is passwordToken (payload.signature)
  let encryptionKey = rawHash;
  let passwordToken = null;
  const dotIdx = rawHash.indexOf('.');
  if (dotIdx !== -1) {
    encryptionKey = rawHash.slice(0, dotIdx);
    passwordToken = rawHash.slice(dotIdx + 1);
  }

  if (ctx.hasPassword) {
    // Wait for password submission
    const submitBtn = document.getElementById('submit-password');
    const pwInput = document.getElementById('sq-unlock');

    if (submitBtn) {
      const doSubmit = () => fetchContent(encryptionKey, pwInput?.value, passwordToken);

      submitBtn.addEventListener('click', doSubmit);
      pwInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSubmit();
        }
      });
    }
  } else {
    // Fetch content immediately
    fetchContent(encryptionKey, undefined, passwordToken);
  }

  async function fetchContent(key, password, pwToken) {
    const loadingEl = document.getElementById('loading-indicator');
    const contentArea = document.getElementById('content-area');
    const actionsArea = document.getElementById('content-actions');
    const passwordPrompt = document.getElementById('password-prompt');
    const pwError = document.getElementById('password-error');

    try {
      const bodyObj = { key };
      if (password) bodyObj.password = password;
      if (pwToken) bodyObj.passwordToken = pwToken;

      const res = await fetch(`/view/${ctx.id}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });

      if (res.status === 401) {
        if (pwError) {
          pwError.textContent = 'Password required.';
          pwError.style.display = '';
        }
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        if (err.error === 'Invalid password' && pwError) {
          pwError.textContent = 'Invalid password.';
          pwError.style.display = '';
          return;
        }
        throw new Error(err.error || 'Failed to load content');
      }

      // Hide password prompt, show content
      if (passwordPrompt) passwordPrompt.style.display = 'none';
      if (contentArea) contentArea.style.display = '';

      // Show delete button (always shown — requires key from URL)
      showDeleteButton(key, password, pwToken);

      // Show save button for logged-in users
      if (ctx.canSave) {
        showSaveButton(key, password, pwToken);
      }

      if (ctx.type === 'text') {
        const data = await res.json();
        if (loadingEl) loadingEl.remove();
        renderTextContent(data.content, contentArea, actionsArea);
      } else {
        const blob = await res.blob();
        if (loadingEl) loadingEl.remove();
        renderFileContent(blob, contentArea, actionsArea);
      }
    } catch (err) {
      if (loadingEl) loadingEl.remove();
      if (contentArea) {
        contentArea.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        contentArea.style.display = '';
      }
    }
  }

  function renderTextContent(text, container, actions) {
    const pre = document.createElement('pre');
    pre.textContent = text;

    const wrapper = document.createElement('div');
    wrapper.className = 'content-preview';
    wrapper.appendChild(pre);
    container.appendChild(wrapper);

    // Show copy button
    if (actions) {
      actions.style.display = '';
      const copyBtn = document.getElementById('copy-content-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy to Clipboard', 2000);
          });
        });
      }
    }
  }

  function showDeleteButton(key, password, pwToken) {
    const area = document.getElementById('delete-btn-area');
    if (!area) return;
    area.style.display = '';

    const btn = document.createElement('button');
    btn.className = 'outline secondary btn-sm';
    btn.textContent = 'Delete';
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this share permanently?')) return;
      try {
        const bodyObj = { key };
        if (password) bodyObj.password = password;
        if (pwToken) bodyObj.passwordToken = pwToken;

        const res = await fetch(`/view/${ctx.id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
        });
        const data = await res.json();
        if (data.deleted) {
          document.getElementById('view-container').innerHTML =
            '<div class="text-center" style="margin-top:4rem">' +
            '<h2>Share Deleted</h2>' +
            '<p class="text-muted">This share has been permanently deleted.</p>' +
            '</div>';
        } else {
          alert(data.error || 'Failed to delete');
        }
      } catch {
        alert('Failed to delete share.');
      }
    });
    area.appendChild(btn);
  }

  function showSaveButton(key, password, pwToken) {
    const area = document.getElementById('content-actions');
    if (!area) return;
    area.style.display = '';

    const btn = document.createElement('button');
    btn.className = 'outline btn-sm';
    btn.textContent = 'Save to my data';
    btn.addEventListener('click', async () => {
      const defaultTitle = ctx.fileName || 'Saved share';
      const title = prompt('Title for saved item:', defaultTitle);
      if (!title) return;

      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const bodyObj = { key, title };
        if (password) bodyObj.password = password;
        if (pwToken) bodyObj.passwordToken = pwToken;

        const res = await fetch(`/view/${ctx.id}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
        });
        const data = await res.json();
        if (data.saved) {
          btn.textContent = 'Saved!';
        } else {
          btn.textContent = data.error || 'Failed to save';
          setTimeout(() => { btn.textContent = 'Save to my data'; btn.disabled = false; }, 2000);
        }
      } catch {
        btn.textContent = 'Failed to save';
        setTimeout(() => { btn.textContent = 'Save to my data'; btn.disabled = false; }, 2000);
      }
    });
    area.appendChild(btn);
  }

  function renderFileContent(blob, container, actions) {
    const mime = ctx.fileMime || blob.type || 'application/octet-stream';
    const url = URL.createObjectURL(blob);
    const wrapper = document.createElement('div');
    wrapper.className = 'content-preview';

    if (mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = ctx.fileName || 'Image';
      wrapper.appendChild(img);
    } else if (mime.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.style.maxWidth = '100%';
      wrapper.appendChild(video);
    } else if (mime.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.src = url;
      audio.controls = true;
      wrapper.appendChild(audio);
    } else if (mime.startsWith('text/') || mime === 'application/json') {
      blob.text().then(text => {
        const pre = document.createElement('pre');
        pre.textContent = text;
        wrapper.appendChild(pre);
      });
    } else {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = 'Preview not available for this file type.';
      wrapper.appendChild(p);
    }

    container.appendChild(wrapper);

    // Download button
    if (actions) {
      actions.style.display = '';
      const dlBtn = document.createElement('a');
      dlBtn.href = url;
      dlBtn.download = ctx.fileName || 'download';
      dlBtn.className = 'outline';
      dlBtn.role = 'button';
      dlBtn.textContent = 'Download';
      actions.appendChild(dlBtn);

      // Hide copy button for files
      const copyBtn = document.getElementById('copy-content-btn');
      if (copyBtn && !mime.startsWith('text/')) {
        copyBtn.style.display = 'none';
      } else if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          blob.text().then(text => {
            navigator.clipboard.writeText(text).then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => copyBtn.textContent = 'Copy to Clipboard', 2000);
            });
          });
        });
      }
    }
  }
})();

// === WebAuthn ===
function loadWebAuthnLib() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/webauthn.js';
    script.onload = () => {
      if (window.SimpleWebAuthnBrowser) resolve(window.SimpleWebAuthnBrowser);
      else reject(new Error('WebAuthn library failed to initialize'));
    };
    script.onerror = () => reject(new Error('Failed to load WebAuthn library'));
    document.head.appendChild(script);
  });
}

(function initWebAuthn() {
  const ctx = window.__webauthnContext;
  if (!ctx) return;

  const basePath = ctx.isAdmin ? '/manage' : '';

  // Registration
  const regBtn = document.getElementById('webauthn-register-btn');
  if (regBtn && ctx.setupMode) {
    regBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('webauthn-status');
      try {
        statusEl.textContent = 'Loading WebAuthn...';
        const lib = await loadWebAuthnLib();

        statusEl.textContent = 'Requesting options...';
        const optRes = await fetch(`${basePath}/api/webauthn/register-options`, {
          method: 'POST',
        });
        const options = await optRes.json();

        statusEl.textContent = 'Waiting for security key...';
        const attResp = await lib.startRegistration({ optionsJSON: options });

        const verRes = await fetch(`${basePath}/api/webauthn/register-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attResp),
        });
        const verData = await verRes.json();

        if (verData.verified) {
          statusEl.textContent = 'Security key registered!';
          setTimeout(() => {
            window.location.href = ctx.isAdmin ? '/manage' : '/dashboard';
          }, 1000);
        } else {
          statusEl.textContent = 'Verification failed.';
        }
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
      }
    });
  }

  // Authentication
  const authBtn = document.getElementById('webauthn-auth-btn');
  if (authBtn && ctx.verifyMode) {
    authBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('webauthn-status');
      try {
        statusEl.textContent = 'Loading WebAuthn...';
        const lib = await loadWebAuthnLib();

        statusEl.textContent = 'Requesting options...';
        const optRes = await fetch(`${basePath}/api/webauthn/auth-options`, {
          method: 'POST',
        });
        const options = await optRes.json();

        statusEl.textContent = 'Waiting for security key...';
        const assertionResp = await lib.startAuthentication({ optionsJSON: options });

        const verRes = await fetch(`${basePath}/api/webauthn/auth-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(assertionResp),
        });
        const verData = await verRes.json();

        if (verData.verified) {
          statusEl.textContent = 'Verified!';
          setTimeout(() => {
            window.location.href = ctx.isAdmin ? '/manage' : '/dashboard';
          }, 1000);
        } else {
          statusEl.textContent = 'Verification failed.';
        }
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
      }
    });
  }
})();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
