// === Tab switching ===
document.querySelectorAll('.tabs button[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    const parent = btn.closest('.tabs').parentElement;

    // Deactivate all tabs and content
    btn.closest('.tabs').querySelectorAll('button').forEach(b => b.classList.remove('active'));
    parent.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

    // Activate clicked tab
    btn.classList.add('active');
    const target = parent.querySelector(`#tab-${tabId}`);
    if (target) target.classList.add('active');
  });
});

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

// === Share View Page ===
(function initViewPage() {
  const ctx = window.__shareContext;
  if (!ctx) return;

  const hash = location.hash.slice(1);
  if (!hash && !ctx.hasPassword) {
    document.getElementById('loading-indicator')?.remove();
    const area = document.getElementById('content-area');
    if (area) area.innerHTML = '<div class="alert alert-error">No encryption key found in URL.</div>';
    return;
  }

  if (ctx.hasPassword) {
    // Wait for password submission
    const submitBtn = document.getElementById('submit-password');
    const pwInput = document.getElementById('share-password');
    const pwError = document.getElementById('password-error');

    if (submitBtn) {
      const doSubmit = () => fetchContent(hash, pwInput?.value);

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
    fetchContent(hash);
  }

  async function fetchContent(key, password) {
    const loadingEl = document.getElementById('loading-indicator');
    const contentArea = document.getElementById('content-area');
    const actionsArea = document.getElementById('content-actions');
    const passwordPrompt = document.getElementById('password-prompt');
    const pwError = document.getElementById('password-error');

    try {
      const res = await fetch(`/view/${ctx.id}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, password }),
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

      // Show delete button after password verified
      if (ctx.hasPassword) {
        showDeleteButton(password);
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

  function showDeleteButton(password) {
    const area = document.getElementById('delete-btn-area');
    if (!area) return;
    area.style.display = '';

    const btn = document.createElement('button');
    btn.className = 'outline secondary btn-sm';
    btn.textContent = 'Delete';
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this share permanently?')) return;
      try {
        const res = await fetch(`/view/${ctx.id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
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
