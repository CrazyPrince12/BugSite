export default {
  name: "ping",
  description: "Teste la latence du bot (KNUT-BUG)",

  async execute(context) {
    const { sock, from, targetJid, msg } = context;

    try {
      const fs = await import("fs");
      const path = await import("path");

      const cible = targetJid || from || sock.user.id;

      // Charger l'image
      let imageBuffer = null;
      try {
        imageBuffer = fs.readFileSync(
          path.resolve("./images/1.jpg")
        );
      } catch (err) {
        console.error("❌ 1.jpg introuvable :", err.message);
      }

      // ⏱️ Début ping
      const start = Date.now();

      await sock.sendMessage(
        cible,
        { text: "> 𝐼'𝑚 𝑐𝑟𝑎𝑧𝑦....𝑚𝑎𝑦𝑏𝑒..." },
        { quoted: msg }
      );

      // ⏱️ Fin ping
      const latency = Date.now() - start;

      // 🏓 Caption KNUT-BUG
      const caption = `> ⚫ KNUT-BUG
> 🏓 PONG
> ⚡ Latence: ${latency} ms
> ⏰ ${new Date().toLocaleString()}`;

      // 📸 Envoi image avec caption
      await sock.sendMessage(
        cible,
        {
          image: imageBuffer,
          caption: caption
        },
        { quoted: msg }
      );

      return {
        success: true,
        message: `Ping: ${latency}ms`,
        latency
      };

    } catch (error) {
      console.error("❌ Erreur ping :", error);

      await sock.sendMessage(
        from,
        { text: "> ⚠️ KNUT-BUG: Impossible de calculer la latence." },
        { quoted: msg }
      );

      return {
        success: false,
        message: "Echec ping"
      };
    }
  }
};