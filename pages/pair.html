<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Knut-Bug | Connecter un bot</title>
  <link rel="stylesheet" href="/knut.css">
  <style>
    :root {
      --bg: #0a0a0f;
      --bg-2: #111118;
      --bg-3: #1a1a24;
      --surface: #111118;
      --border: #1f1f2e;
      --border-2: #374151;
      --text: #e0e0e0;
      --text-2: #9ca3af;
      --text-3: #6b7280;
      --primary: #6366f1;
      --primary-2: #8b5cf6;
      --green: #22c55e;
      --red: #ef4444;
      --r-md: 10px;
      --r-lg: 14px;
      --r-full: 999px;
      --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
      --font-mono: 'Courier New', monospace;
      --t-fast: 0.15s ease;
      --t-mid: 0.25s ease;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
      --shadow-lg: 0 8px 24px rgba(0,0,0,0.4);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--s4);
    }

    .container {
      width: 100%;
      max-width: 460px;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: var(--s3);
      margin-bottom: var(--s5);
    }
    .header-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      border-radius: var(--r-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 900;
      color: #fff;
    }
    .header-title {
      font-size: 1.1rem;
      font-weight: 800;
    }
    .header-sub {
      font-size: 0.75rem;
      color: var(--text-3);
      margin-top: 2px;
    }
    .status-dot {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.7rem;
      font-family: var(--font-mono);
      color: var(--text-3);
    }
    .status-dot .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-3);
    }
    .status-dot .dot.on {
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    /* Card */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      padding: var(--s5);
      margin-bottom: var(--s4);
    }

    /* Form */
    .form-group {
      margin-bottom: var(--s4);
    }
    .form-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-2);
      margin-bottom: var(--s2);
      letter-spacing: 0.03em;
    }
    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-icon {
      position: absolute;
      left: 14px;
      color: var(--text-3);
      pointer-events: none;
      display: flex;
    }
    .form-input {
      width: 100%;
      padding: 14px 16px 14px 42px;
      background: var(--bg-2);
      border: 1.5px solid var(--border-2);
      border-radius: var(--r-md);
      color: var(--text);
      font-size: 1.05rem;
      font-family: var(--font-mono);
      letter-spacing: 0.05em;
      outline: none;
      transition: border var(--t-fast);
    }
    .form-input:focus {
      border-color: var(--primary);
    }
    .form-input::placeholder {
      color: var(--text-3);
      letter-spacing: 0;
      font-family: inherit;
      font-size: 0.9rem;
    }
    .form-hint {
      font-size: 0.72rem;
      color: var(--text-3);
      margin-top: 6px;
    }

    /* Buttons */
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: var(--r-md);
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      transition: all var(--t-fast);
      color: #fff;
    }
    .btn:active { transform: scale(0.97); }
    .btn:disabled {
      background: var(--bg-3) !important;
      color: var(--text-3) !important;
      cursor: not-allowed;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
    }
    .btn-danger {
      background: linear-gradient(135deg, #ef4444, #dc2626);
    }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border-2);
      color: var(--text-3);
    }
    .btn-sm {
      width: auto;
      padding: 8px 16px;
      font-size: 0.8rem;
    }

    /* Code Box */
    .code-box {
      background: var(--bg-2);
      border: 2px dashed var(--primary);
      border-radius: var(--r-lg);
      padding: var(--s5) var(--s4);
      text-align: center;
      margin-bottom: var(--s3);
    }
    .code-lbl {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-3);
      margin-bottom: var(--s2);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .code-val {
      font-family: var(--font-mono);
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: 0.25em;
      color: #818cf8;
      word-break: break-all;
      line-height: 1.2;
    }
    .code-hint {
      font-size: 0.75rem;
      color: var(--text-2);
      margin-top: var(--s3);
      line-height: 1.5;
    }
    .code-notification-info {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: var(--r-md);
      padding: 10px 12px;
      font-size: 0.78rem;
      color: #c7d2fe;
      margin-top: var(--s3);
      text-align: left;
      line-height: 1.4;
    }

    /* Steps */
    .steps {
      margin-top: var(--s4);
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: var(--s3);
      padding: var(--s3) 0;
      border-bottom: 1px solid var(--border);
    }
    .step:last-child { border-bottom: none; }
    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--bg-3);
      border: 1px solid var(--border-2);
      font-size: 0.7rem;
      font-weight: 700;
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-2);
    }
    .step-txt {
      font-size: 0.8rem;
      color: var(--text-2);
      line-height: 1.5;
    }
    .step-txt strong { color: var(--text); }

    /* Alerts */
    .alert-ok {
      background: rgba(34, 197, 94, 0.1);
      color: #6ee7b7;
      padding: 14px;
      border-radius: var(--r-md);
      font-size: 0.85rem;
      text-align: center;
      border: 1px solid rgba(34, 197, 94, 0.2);
      margin-bottom: var(--s4);
    }
    .alert-err {
      background: rgba(239, 68, 68, 0.08);
      color: #fca5a5;
      padding: 12px;
      border-radius: var(--r-md);
      font-size: 0.82rem;
      border: 1px solid rgba(239, 68, 68, 0.2);
      margin-top: var(--s3);
    }

    /* Spinner */
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    /* Hidden */
    .hidden { display: none !important; }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 500;
      background: var(--surface);
      border: 1px solid var(--border-2);
      border-radius: var(--r-full);
      padding: 10px 22px;
      font-size: 0.82rem;
      font-weight: 500;
      box-shadow: var(--shadow-lg);
      opacity: 0;
      transition: opacity var(--t-mid);
      pointer-events: none;
    }
    .toast.show { opacity: 1; }

    /* Retour */
    .btn-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: 1px solid var(--border-2);
      border-radius: var(--r-md);
      padding: 8px 14px;
      color: var(--text-2);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      margin-bottom: var(--s4);
    }
  </style>
</head>
<body>

<div class="toast" id="toast"></div>

<div class="container">
  <!-- Retour -->
  <a href="/accueil" class="btn-back">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
    Retour
  </a>

  <!-- Header -->
  <div class="header">
    <div class="header-icon">[+]</div>
    <div>
      <div class="header-title">Connecter un bot</div>
      <div class="header-sub">KNUT-BUG · WhatsApp Pairing</div>
    </div>
    <div class="status-dot" id="statusDisplay">
      <span class="dot" id="statusDot"></span>
      <span id="statusText">Off</span>
    </div>
  </div>

  <!-- Card principale -->
  <div class="card">
    <!-- Formulaire (affiché si pas connecté) -->
    <div id="formSection">
      <div class="form-group">
        <label class="form-label">Numéro WhatsApp avec indicatif pays</label>
        <div class="input-wrap">
          <span class="input-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>
          </span>
          <input class="form-input" id="phoneInput" type="tel" placeholder="237621631200" autocomplete="off">
        </div>
        <div class="form-hint">Format international sans le signe + (ex: 237621631200, 2250700000000, 33612345678)</div>
      </div>

      <button class="btn btn-primary" id="btnGenerate" onclick="generateCode()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Générer le code de pairing
      </button>
    </div>

    <!-- Résultat : code -->
    <div id="codeSection" class="hidden">
      <div class="code-box">
        <div class="code-lbl">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Code de liaison WhatsApp
        </div>
        <div class="code-val" id="codeValue">—</div>
        <div class="code-hint">Valable ~5 minutes</div>
        <div class="code-notification-info">
          🔔 <strong>Notification WhatsApp envoyée :</strong> Appuyez sur la notification reçue sur votre téléphone, ou allez dans <em>WhatsApp &gt; Appareils connectés &gt; Lier un appareil &gt; Lier avec un numéro</em> et entrez ce code.
        </div>
      </div>

      <button class="btn btn-primary" id="btnCopy" onclick="copyCode()" style="margin-bottom: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
        Copier le code
      </button>

      <button class="btn btn-outline btn-sm" onclick="resetForm()" style="width:100%;margin-top:8px;">
        Annuler
      </button>
    </div>

    <!-- Connecté -->
    <div id="connectedSection" class="hidden">
      <div class="alert-ok">[OK] Bot connecté avec succès !</div>
      <button class="btn btn-danger" onclick="stopBot()">
        [X] Déconnecter le bot
      </button>
    </div>

    <!-- Erreur -->
    <div id="errorBox" class="alert-err hidden"></div>
  </div>

  <!-- Étapes -->
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-txt">Entrez votre <strong>numéro WhatsApp avec indicatif pays</strong> sans espace ni <code>+</code> (ex: <code style="font-family:var(--font-mono);font-size:0.78rem;">237621631200</code>)</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-txt">Cliquez sur <strong>Générer le code</strong> — un code à 8 caractères apparaîtra et une notification sera transmise à votre téléphone</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-txt">Ouvrez WhatsApp sur votre téléphone : <strong>Appareils connectés &gt; Lier un appareil &gt; Lier avec un numéro de téléphone</strong>, puis saisissez le code</div>
    </div>
  </div>
</div>

<script>
  const formSection = document.getElementById('formSection');
  const codeSection = document.getElementById('codeSection');
  const connectedSection = document.getElementById('connectedSection');
  const codeValue = document.getElementById('codeValue');
  const errorBox = document.getElementById('errorBox');
  const btnGenerate = document.getElementById('btnGenerate');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  let pollInterval = null;

  // Toast
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3000);
  }

  // Copier
  function copyCode() {
    const text = codeValue.textContent.replace(/[^A-Za-z0-9]/g, '');
    if (navigator.clipboard && location.protocol === 'https:') {
      navigator.clipboard.writeText(text).then(() => toast('Code copié !'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Code copié !');
    }
  }

  // Reset
  function resetForm() {
    if (pollInterval) clearInterval(pollInterval);
    formSection.classList.remove('hidden');
    codeSection.classList.add('hidden');
    connectedSection.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  // Vérifier statut
  async function checkStatus() {
    try {
      const res = await fetch('/api/bot/status');
      const data = await res.json();

      if (data.connected) {
        statusDot.className = 'dot on';
        statusText.textContent = 'On';
        formSection.classList.add('hidden');
        codeSection.classList.add('hidden');
        connectedSection.classList.remove('hidden');
        return true;
      } else {
        statusDot.className = 'dot';
        statusText.textContent = 'Off';
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  // Générer le code
  async function generateCode() {
    const rawPhone = document.getElementById('phoneInput').value.trim();
    errorBox.classList.add('hidden');

    let phone = rawPhone.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = phone.replace(/^0+/, '');

    if (!phone || phone.length < 8) {
      errorBox.textContent = 'Veuillez entrer un numéro WhatsApp valide avec indicatif pays (ex: 237621631200).';
      errorBox.classList.remove('hidden');
      return;
    }

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '<span class="spinner"></span> Connexion à WhatsApp...';

    try {
      const res = await fetch('/api/bot/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone })
      });
      const data = await res.json();

      if (data.success && data.pairingCode) {
        codeValue.textContent = data.pairingCode;
        formSection.classList.add('hidden');
        codeSection.classList.remove('hidden');
        toast('Code généré ! Consultez WhatsApp sur votre téléphone.');

        // Surveiller la connexion
        pollInterval = setInterval(async () => {
          const connected = await checkStatus();
          if (connected) {
            clearInterval(pollInterval);
            codeSection.classList.add('hidden');
            connectedSection.classList.remove('hidden');
            toast('Bot connecté avec succès !');

            // Rediriger vers buglist après 2s
            setTimeout(() => { window.location.href = '/buglist'; }, 2000);
          }
        }, 3000);

        // Timeout 5 min
        setTimeout(() => {
          if (pollInterval) {
            clearInterval(pollInterval);
            if (connectedSection.classList.contains('hidden')) {
              errorBox.textContent = 'Temps écoulé. Veuillez réessayer.';
              errorBox.classList.remove('hidden');
              resetForm();
            }
          }
        }, 300000);

      } else if (data.success && data.connected) {
        statusDot.className = 'dot on';
        statusText.textContent = 'On';
        connectedSection.classList.remove('hidden');
        formSection.classList.add('hidden');
        codeSection.classList.add('hidden');
        toast('Bot déjà connecté !');
        setTimeout(() => { window.location.href = '/buglist'; }, 1500);
      } else {
        errorBox.textContent = data.message || 'Erreur lors de la génération du code.';
        errorBox.classList.remove('hidden');
      }
    } catch (e) {
      errorBox.textContent = 'Erreur de connexion au serveur. Réessayez.';
      errorBox.classList.remove('hidden');
    }

    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Générer le code de pairing';
  }

  // Arrêter le bot
  async function stopBot() {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      statusDot.className = 'dot';
      statusText.textContent = 'Off';
      resetForm();
      toast('Bot déconnecté.');
    } catch (e) {
      toast('Erreur déconnexion.');
    }
  }

  // Init
  checkStatus();
</script>
</body>
</html>