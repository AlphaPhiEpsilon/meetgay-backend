// cleanup.js - Nettoyage périodique des visiteurs libres

const { Pool } = require('pg');

// ========== CONNEXION À SUPABASE ==========
const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false }
});

console.log('🧹 Module de nettoyage chargé (en attente de démarrage)');

let cleanupInterval = null;

function startCleanup(intervalMinutes = 10, getOnlineUsersCallback) {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    console.log(`🧹 Nettoyage programmé toutes les ${intervalMinutes} minutes`);

    cleanupInterval = setInterval(async () => {
        try {
            const onlinePseudos = getOnlineUsersCallback ? getOnlineUsersCallback() : [];

            if (onlinePseudos.length > 0) {
                const placeholders = onlinePseudos.map((_, i) => `$${i + 1}`).join(',');
                const result = await pool.query(
                    `DELETE FROM users WHERE pseudo NOT IN (${placeholders}) AND (is_member IS NULL OR is_member = false)`,
                    onlinePseudos
                );
                if (result.rowCount > 0) {
                    console.log(`🧹 Nettoyage: ${result.rowCount} visiteur(s) supprimé(s) de la base`);
                }
            } else {
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