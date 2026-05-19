// cleanup.js - Nettoyage périodique des visiteurs libres

const { Pool } = require('pg');

// Connexion à la base (lit la même variable d'environnement)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Récupérer les utilisateurs connectés (mémoire)
// On ne peut pas accéder à 'users' depuis server.js directement
// Donc on va créer une route API que server.js exposera

console.log('🧹 Module de nettoyage chargé (en attente de démarrage)');

let cleanupInterval = null;

function startCleanup(intervalMinutes = 10, getOnlineUsersCallback) {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    console.log(`🧹 Nettoyage programmé toutes les ${intervalMinutes} minutes`);

    cleanupInterval = setInterval(async () => {
        try {
            // Récupérer la liste des pseudos en ligne via le callback
            const onlinePseudos = getOnlineUsersCallback ? getOnlineUsersCallback() : [];

            if (onlinePseudos.length > 0) {
                const result = await pool.query(
                    "DELETE FROM users WHERE pseudo NOT IN ($1) AND (is_member IS NULL OR is_member = false)",
                    [onlinePseudos]
                );
                if (result.rowCount > 0) {
                    console.log(`🧹 Nettoyage: ${result.rowCount} visiteur(s) supprimé(s) de la base`);
                }
            } else {
                // Si personne n'est connecté, on supprime tous les visiteurs
                const result = await pool.query("DELETE FROM users WHERE is_member IS NULL OR is_member = false");
                if (result.rowCount > 0) {
                    console.log(`🧹 Nettoyage complet: ${result.rowCount} visiteur(s) supprimé(s) de la base`);
                }
            }
        } catch (err) {
            console.error('❌ Erreur lors du nettoyage:', err.message);
        }
    }, intervalMinutes * 60 * 1000);
}

function stopCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('🧹 Nettoyage arrêté');
    }
}

module.exports = { startCleanup, stopCleanup };