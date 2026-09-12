/**
 * ============================================================
 *  JOB UI — suivi des executions en ARRIERE-PLAN
 * ============================================================
 *  Ce fichier remplace l'ancien comportement "page figee sur
 *  Execution en cours... Veuillez patienter".
 *
 *  Principe :
 *   1. POST /api/bot/command repond IMMEDIATEMENT (HTTP 202 + jobId).
 *   2. On affiche une carte de progression : le job tourne cote SERVEUR,
 *      le navigateur n'a plus rien a attendre.
 *   3. La progression arrive en Socket.IO (room de l'utilisateur) avec un
 *      polling GET /api/jobs en secours.
 *   4. On peut FERMER l'onglet, quitter le site, eteindre le telephone :
 *      au retour, GET /api/jobs reaffiche le job EN COURS avec son temps
 *      restant. Le job continue jusqu'au bout de ses 24h.
 *
 *  Utilise par pages/bugtarget.html et pages/buggroup.html.
 */
(function () {
  'use strict';

  var POLL_MS = 5000;
  var jobs = new Map(); // id -> job
  var mounted = null; // element conteneur
  var listeners = { change: [], launch: [] };
  var socket = null;
  var pollTimer = null;
  var tickTimer = null;
  var statusMessage = '';

  // ------------------------------------------------------------
  //  STYLE (injecte une seule fois)
  // ------------------------------------------------------------
  var CSS = [
    '.jobui-style{--job-bg:#111118;--job-border:#374151;--job-text:#e0e0e0;--job-muted:#9ca3af;',
    '--job-dim:#6b7280;--job-orange:#f59e0b;--job-red:#ef4444;--job-green:#22c55e}',
    '.jobui-wrap{margin-top:18px;text-align:left}',
    '.jobui-title{font-size:.68rem;font-weight:700;color:#6b7280;letter-spacing:.08em;',
    'text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px}',
    '.jobui-live{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;',
    'animation:jobui-pulse 1.6s infinite}',
    '@keyframes jobui-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.jobui-card{background:#111118;border:1px solid #1f1f2e;border-radius:14px;padding:14px;',
    'margin-bottom:10px;transition:border-color .25s}',
    '.jobui-card.running{border-color:rgba(245,158,11,.45)}',
    '.jobui-card.done{border-color:rgba(34,197,94,.45)}',
    '.jobui-card.cancelled,.jobui-card.interrupted{border-color:#374151;opacity:.75}',
    '.jobui-card.failed{border-color:rgba(239,68,68,.5)}',
    '.jobui-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.jobui-name{font-size:.9rem;font-weight:800;color:#fff;letter-spacing:.02em}',
    '.jobui-badge{margin-left:auto;font-size:.6rem;font-weight:800;letter-spacing:.08em;',
    'text-transform:uppercase;padding:4px 9px;border-radius:999px;white-space:nowrap}',
    '.jobui-badge.running{background:rgba(245,158,11,.14);color:#fbbf24;border:1px solid rgba(245,158,11,.35)}',
    '.jobui-badge.done{background:rgba(34,197,94,.14);color:#4ade80;border:1px solid rgba(34,197,94,.35)}',
    '.jobui-badge.cancelled,.jobui-badge.interrupted{background:#1a1a24;color:#9ca3af;border:1px solid #374151}',
    '.jobui-badge.failed{background:rgba(239,68,68,.14);color:#fca5a5;border:1px solid rgba(239,68,68,.35)}',
    '.jobui-target{font-size:.78rem;color:#9ca3af;margin-bottom:10px;word-break:break-all;',
    "font-family:'Courier New',monospace}",
    '.jobui-bar{height:8px;background:#1a1a24;border-radius:999px;overflow:hidden;margin-bottom:8px}',
    '.jobui-fill{height:100%;width:0;border-radius:999px;transition:width .6s ease;',
    'background:linear-gradient(90deg,#f59e0b,#ef4444)}',
    '.jobui-card.done .jobui-fill{background:linear-gradient(90deg,#22c55e,#10b981)}',
    '.jobui-card.cancelled .jobui-fill,.jobui-card.interrupted .jobui-fill,.jobui-card.failed .jobui-fill{background:#4b5563}',
    '.jobui-stats{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.72rem;color:#9ca3af;',
    "font-family:'Courier New',monospace;margin-bottom:10px}",
    '.jobui-stats b{color:#fff;font-weight:700}',
    '.jobui-status{font-size:.72rem;color:#fbbf24;margin-bottom:10px;min-height:1em}',
    '.jobui-stop{width:100%;padding:10px;border-radius:10px;border:1px solid #374151;',
    'background:transparent;color:#fca5a5;font-size:.78rem;font-weight:700;cursor:pointer;',
    'transition:all .18s;letter-spacing:.04em}',
    '.jobui-stop:hover{background:rgba(239,68,68,.12);border-color:#ef4444}',
    '.jobui-stop:disabled{opacity:.45;cursor:not-allowed}',
    '.jobui-empty{font-size:.75rem;color:#4b5563;text-align:center;padding:14px;',
    'border:1px dashed #1f1f2e;border-radius:12px}',
    '.jobui-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);',
    'z-index:900;background:#111118;border:1px solid #374151;border-radius:999px;',
    'padding:11px 22px;font-size:.8rem;font-weight:600;color:#e0e0e0;box-shadow:0 8px 24px rgba(0,0,0,.5);',
    'opacity:0;transition:all .3s;pointer-events:none;max-width:88vw;text-align:center}',
    '.jobui-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
    '.jobui-toast.ok{border-color:rgba(34,197,94,.5);color:#6ee7b7}',
    '.jobui-toast.err{border-color:rgba(239,68,68,.5);color:#fca5a5}',
    '.jobui-toast.warn{border-color:rgba(245,158,11,.5);color:#fcd34d}',
    '.jobui-resumed{font-size:.66rem;color:#6b7280;margin-top:6px;font-style:italic}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('jobui-style')) return;
    var el = document.createElement('style');
    el.id = 'jobui-style';
    el.className = 'jobui-style';
    el.textContent = CSS;
    document.head.appendChild(el);

    var toast = document.createElement('div');
    toast.className = 'jobui-toast';
    toast.id = 'jobui-toast';
    document.body.appendChild(toast);
  }

  // ------------------------------------------------------------
  //  UTILITAIRES
  // ------------------------------------------------------------
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 52 340 000 ms -> "14h 32m 20s" */
  function humanDuration(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '—';
    ms = Math.max(0, Math.floor(ms));
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return h + 'h ' + pad(m) + 'm ' + pad(s) + 's';
    if (m > 0) return m + 'm ' + pad(s) + 's';
    return s + 's';
  }

  function clockTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function dayLabel(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var tomorrow = new Date(today.getTime() + 86400000);
    if (sameDay) return "aujourd'hui";
    if (d.toDateString() === tomorrow.toDateString()) return 'demain';
    return 'le ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  }

  var BADGES = {
    running: 'En cours',
    done: 'Terminé',
    cancelled: 'Arrêté',
    failed: 'Échec',
    interrupted: 'Interrompu'
  };

  function toast(message, kind) {
    var el = document.getElementById('jobui-toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'jobui-toast show ' + (kind || '');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.className = 'jobui-toast';
    }, 4200);
  }

  function emitChange() {
    var list = JobUI.list();
    listeners.change.forEach(function (fn) {
      try {
        fn(list);
      } catch (e) {
        /* ignore */
      }
    });
  }

  // ------------------------------------------------------------
  //  RENDU
  // ------------------------------------------------------------
  function card(job) {
    var status = job.status || 'running';
    var running = status === 'running';
    var pct = Math.max(0, Math.min(100, (job.progress || 0) * 100));
    var remaining = running ? Math.max(0, (job.endsAt || 0) - Date.now()) : 0;

    var parts = [];
    parts.push('<div class="jobui-card ' + status + '" data-job="' + job.id + '">');
    parts.push(
      '<div class="jobui-head"><span class="jobui-name">⚡ ' +
        escapeHtml(job.command || 'job') +
        '</span><span class="jobui-badge ' +
        status +
        '">' +
        (BADGES[status] || status) +
        '</span></div>'
    );
    parts.push(
      '<div class="jobui-target">Cible : ' + escapeHtml(job.label || job.target || '—') + '</div>'
    );
    parts.push('<div class="jobui-bar"><div class="jobui-fill" style="width:' + pct.toFixed(2) + '%"></div></div>');
    parts.push('<div class="jobui-stats">');
    parts.push('<span>Envoyées : <b>' + (job.sentCount || 0) + '</b></span>');
    if (running) {
      parts.push('<span>Reste : <b data-remaining>' + humanDuration(remaining) + '</b></span>');
      parts.push('<span>Fin ' + dayLabel(job.endsAt) + ' à <b>' + clockTime(job.endsAt) + '</b></span>');
    } else {
      parts.push('<span>Durée : <b>' + humanDuration((job.endsAt || 0) - (job.startedAt || 0)) + '</b></span>');
      parts.push('<span>' + clockTime(job.finishedAt || job.updatedAt || job.endsAt) + '</span>');
    }
    parts.push('</div>');

    if (running && statusMessage) {
      parts.push('<div class="jobui-status">› ' + escapeHtml(statusMessage) + '</div>');
    }
    if (job.lastError && !running) {
      parts.push('<div class="jobui-status" style="color:#fca5a5">› ' + escapeHtml(job.lastError) + '</div>');
    }
    if (running) {
      parts.push('<button class="jobui-stop" data-stop="' + job.id + '">⏹ ARRÊTER CE JOB</button>');
      parts.push(
        '<div class="jobui-resumed">Tourne sur le serveur — tu peux fermer la page, ' +
          "l'exécution continue jusqu'à son terme." +
          (job.resumed ? ' (repris ' + job.resumed + '× après redémarrage)' : '') +
          '</div>'
      );
    }
    parts.push('</div>');
    return parts.join('');
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    if (!mounted) return;
    var list = JobUI.list();
    var html = '';

    html +=
      '<div class="jobui-title">' +
      (list.some(function (j) {
        return j.status === 'running';
      })
        ? '<span class="jobui-live"></span>'
        : '') +
      ' Exécutions en arrière-plan</div>';

    if (!list.length) {
      html += '<div class="jobui-empty">Aucune exécution en cours.</div>';
    } else {
      html += list.map(card).join('');
    }

    mounted.innerHTML = html;

    // Le compte a rebours se met a jour sans re-render complet.
    startTick();
  }

  /** Compte a rebours local (1 s) : le job tourne cote serveur, on ne fait
   *  que recalculer le temps restant a partir de endsAt. */
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      if (!mounted) return;
      var anyRunning = false;
      jobs.forEach(function (job) {
        if (job.status !== 'running') return;
        anyRunning = true;
        job.remainingMs = Math.max(0, (job.endsAt || 0) - Date.now());
        var node = mounted.querySelector('[data-job="' + job.id + '"] [data-remaining]');
        if (node) node.textContent = humanDuration(job.remainingMs);
        var fill = mounted.querySelector('[data-job="' + job.id + '"] .jobui-fill');
        if (fill) {
          var total = Math.max(1, (job.endsAt || 0) - (job.startedAt || Date.now()));
          var pct = Math.min(99.9, ((total - job.remainingMs) / total) * 100);
          fill.style.width = pct.toFixed(2) + '%';
        }
      });
      if (!anyRunning && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }, 1000);
  }

  // ------------------------------------------------------------
  //  SERVEUR
  // ------------------------------------------------------------
  /**
   * Le job tourne COTE SERVEUR : l'utilisateur doit quand meme etre prevenu
   * quand il se termine, meme s'il est revenu sur la page 3 heures plus tard.
   */
  function notifyTransition(previous, next) {
    if (!previous || previous.status === next.status) return;
    if (previous.status !== 'running') return;

    if (next.status === 'done') {
      toast('✔ ' + next.command + ' terminé sur ' + (next.label || '') + ' — ' + (next.sentCount || 0) + ' action(s)', 'ok');
    } else if (next.status === 'cancelled') {
      toast('⏹ ' + next.command + ' arrêté sur ' + (next.label || ''), 'warn');
    } else if (next.status === 'failed') {
      toast('✖ ' + next.command + ' : ' + (next.lastError || 'échec'), 'err');
    } else if (next.status === 'interrupted') {
      toast('⚠ ' + next.command + ' interrompu (durée écoulée pendant un arrêt du serveur)', 'warn');
    }
  }

  function upsert(job) {
    if (!job || !job.id) return;
    var previous = jobs.get(job.id);
    jobs.set(job.id, job);
    notifyTransition(previous, job);
    render();
    emitChange();
  }

  async function refresh() {
    try {
      var res = await fetch('/api/jobs?limit=15', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      var data = await res.json();
      if (!data.success) return;

      var previous = new Map(jobs);
      jobs.clear();
      (data.jobs || []).forEach(function (job) {
        jobs.set(job.id, job);
      });
      // Le polling doit, lui aussi, prevenir de la fin d'un job.
      jobs.forEach(function (job) {
        notifyTransition(previous.get(job.id), job);
      });
      render();
      emitChange();
    } catch (e) {
      /* le polling reprendra au prochain tour */
    }
  }

  function connectSocket() {
    if (socket || typeof window.io === 'undefined') return;
    try {
      socket = window.io({ transports: ['websocket', 'polling'] });

      socket.on('job:started', function (job) {
        upsert(job);
        toast('⚡ ' + job.command + ' lancé en arrière-plan', 'ok');
      });
      socket.on('job:progress', function (job) {
        upsert(job);
      });
      socket.on('job:status', function (payload) {
        statusMessage = payload && payload.message ? payload.message : '';
        if (payload && payload.id) upsert(payload);
        else render();
      });
      socket.on('job:done', function (job) {
        upsert(job);
      });
      socket.on('job:cancelled', function (job) {
        upsert(job);
      });
      socket.on('job:error', function (job) {
        upsert(job);
      });
      socket.on('connect', function () {
        /* l'etat complet est resynchronise par le polling */
      });
      socket.on('disconnect', function () {
        socket = null;
      });
    } catch (e) {
      socket = null;
    }
  }

  function loadSocketIo(done) {
    if (window.io) return done();
    var script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = function () {
      done();
    };
    script.onerror = function () {
      done(); // pas de Socket.IO : le polling suffit
    };
    document.head.appendChild(script);
  }

  // ------------------------------------------------------------
  //  API PUBLIQUE
  // ------------------------------------------------------------
  var JobUI = {
    /** Monte le composant dans un conteneur et demarre le suivi. */
    mount: function (container) {
      injectStyle();
      mounted = typeof container === 'string' ? document.querySelector(container) : container;
      if (!mounted) return JobUI;
      mounted.innerHTML = '<div class="jobui-empty">Chargement des exécutions…</div>';

      loadSocketIo(connectSocket);
      refresh();
      if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
      return JobUI;
    },

    /** Jobs tries : les "running" d'abord, puis les plus recents. */
    list: function () {
      return Array.from(jobs.values()).sort(function (a, b) {
        var ar = a.status === 'running' ? 1 : 0;
        var br = b.status === 'running' ? 1 : 0;
        if (ar !== br) return br - ar;
        return (b.startedAt || 0) - (a.startedAt || 0);
      });
    },

    running: function () {
      return JobUI.list().filter(function (j) {
        return j.status === 'running';
      });
    },

    /** Un job est-il deja actif sur cette cible ? (anti double-lancement) */
    activeFor: function (target) {
      var needle = String(target || '').replace(/\D/g, '');
      return JobUI.running().find(function (j) {
        return String(j.label || '').replace(/\D/g, '') === needle || String(j.target || '').indexOf(needle) !== -1;
      });
    },

    /**
     * Lance une commande. NE BLOQUE JAMAIS : le serveur repond tout de suite.
     * @returns {Promise<{ok:boolean, queued:boolean, blocked:boolean, message:string, job?:object}>}
     */
    launch: async function (payload) {
      try {
        var res = await fetch('/api/bot/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        var data = {};
        try {
          data = await res.json();
        } catch (e) {
          /* reponse non-JSON (proxy) */
        }

        if (res.status === 401) {
          window.location.href = '/login';
          return { ok: false, message: 'Session expirée' };
        }

        // Liste blanche : la cible est protegee, rien n'a ete lance.
        if (res.status === 403 || data.blocked) {
          var blocked = {
            ok: false,
            blocked: true,
            message: data.message || '⛔ Numéro protégé (liste blanche) — exécution annulée.'
          };
          toast(blocked.message, 'err');
          listeners.launch.forEach(function (fn) {
            fn(blocked);
          });
          return blocked;
        }

        if (!res.ok || !data.success) {
          var failed = { ok: false, message: data.message || 'Erreur serveur (' + res.status + ')' };
          toast(failed.message, 'err');
          listeners.launch.forEach(function (fn) {
            fn(failed);
          });
          return failed;
        }

        // HTTP 202 : le job tourne deja en arriere-plan.
        var queued = {
          ok: true,
          queued: !!data.queued,
          alreadyRunning: !!data.alreadyRunning,
          jobId: data.jobId || data.job?.id || null,
          job: data.job || null,
          message: data.message || (data.queued ? '✔ Lancé en arrière-plan' : '✔ Exécuté'),
          result: data.result
        };

        if (queued.job) upsert(queued.job);
        toast(queued.message, queued.alreadyRunning ? 'warn' : 'ok');
        refresh();
        listeners.launch.forEach(function (fn) {
          fn(queued);
        });
        return queued;
      } catch (e) {
        // Erreur RESEAU : le job a peut-etre quand meme ete lance. On verifie
        // au lieu d'afficher un "Erreur serveur" trompeur.
        await refresh();
        var stillRunning = JobUI.running();
        var message = stillRunning.length
          ? '✔ Exécution en cours côté serveur (la connexion a coupé, mais le job continue).'
          : 'Erreur de connexion au serveur — vérifie ton réseau.';
        var out = { ok: !!stillRunning.length, networkError: true, message: message };
        toast(message, stillRunning.length ? 'warn' : 'err');
        return out;
      }
    },

    /** Bouton STOP. */
    stop: async function (jobId) {
      try {
        var res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (data.job) upsert(data.job);
        toast(data.message || (data.success ? 'Job arrêté' : 'Impossible d’arrêter ce job'), data.success ? 'warn' : 'err');
        refresh();
        return data;
      } catch (e) {
        toast('Erreur de connexion au serveur', 'err');
        return { success: false };
      }
    },

    /** Ecoute les changements d'etat ('change') et les lancements ('launch'). */
    on: function (event, fn) {
      if (listeners[event]) listeners[event].push(fn);
      return JobUI;
    },

    refresh: refresh,
    toast: toast,
    humanDuration: humanDuration
  };

  // ------------------------------------------------------------
  //  Delegations globales (boutons Stop)
  // ------------------------------------------------------------
  document.addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('[data-stop]') : null;
    if (!btn) return;
    event.preventDefault();
    btn.disabled = true;
    btn.textContent = '⏹ Arrêt en cours…';
    JobUI.stop(btn.getAttribute('data-stop'));
  });

  window.JobUI = JobUI;
})();
