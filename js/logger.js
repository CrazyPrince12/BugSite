/**
 * Logs live pour la console Render.
 *
 * Sur Render, stdout n'est PAS un TTY : Node bufferise ~8 Ko et les lignes
 * n'apparaissent qu'en retard (ou jamais si le process meurt avant le flush).
 * On force l'ecriture bloquante + on redirige console.* vers write() ligne
 * par ligne, pour que chaque log parte tout de suite.
 */

import util from 'util';

let installed = false;

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function forceBlocking(stream) {
  try {
    stream._handle?.setBlocking?.(true);
  } catch {
    /* ignore */
  }
}

function patchConsole(method, stream) {
  console[method] = (...args) => {
    const line = util.format(...args);
    stream.write(`[${stamp()}] ${line.endsWith('\n') ? line : `${line}\n`}`);
  };
}

/** A appeler une seule fois au boot, avant tout le reste. */
export function installLiveLogs() {
  if (installed) return;
  installed = true;

  forceBlocking(process.stdout);
  forceBlocking(process.stderr);

  patchConsole('log', process.stdout);
  patchConsole('info', process.stdout);
  patchConsole('debug', process.stdout);
  patchConsole('warn', process.stderr);
  patchConsole('error', process.stderr);

  console.log('[LOG] console live activee (stdout non bufferise -> Render)');
}

export function formatErr(err) {
  if (!err) return '?';
  const code =
    err.output?.statusCode ||
    err.statusCode ||
    err.status ||
    err.output?.payload?.statusCode ||
    '';
  const msg = err.message || String(err);
  return code ? `${msg} (code ${code})` : msg;
}

function contentType(content) {
  if (!content || typeof content !== 'object') return typeof content;
  if (content.text) return 'text';
  if (content.image) return 'image';
  if (content.video) return 'video';
  if (content.audio) return 'audio';
  if (content.document) return 'document';
  if (content.sticker) return 'sticker';
  if (content.reactionMessage || content.react) return 'react';
  return Object.keys(content)[0] || '?';
}

/** Enveloppe sock.sendMessage pour tracer chaque envoi WhatsApp. */
export async function loggedSend(sock, tag, jid, content, options) {
  const kind = contentType(content);
  const t0 = Date.now();
  console.log(`[CMD] ${tag} ENVOI ${kind} -> ${jid}`);
  try {
    const res = await sock.sendMessage(jid, content, options);
    console.log(
      `[CMD] ${tag} OK ${kind} -> ${jid} ${Date.now() - t0}ms id=${res?.key?.id || '-'}`
    );
    return res;
  } catch (err) {
    console.error(
      `[CMD] ${tag} FAIL ${kind} -> ${jid} ${Date.now() - t0}ms ${formatErr(err)}`
    );
    throw err;
  }
}

/**
 * Proxy autour de la socket Baileys : sendMessage est logge, le reste est intact.
 * Ne mute PAS la socket originale (plusieurs commandes peuvent tourner en parallele).
 */
export function loggingSock(sock, tag) {
  if (!sock) return sock;
  return new Proxy(sock, {
    get(target, prop, receiver) {
      if (prop === 'sendMessage') {
        return (jid, content, options) => loggedSend(target, tag, jid, content, options);
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') return val.bind(target);
      return val;
    }
  });
}

export function logCmd(...args) {
  console.log('[CMD]', ...args);
}
