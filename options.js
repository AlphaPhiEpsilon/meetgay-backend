// ============================================================
// options.js - Tâches annexes (nettoyage, futurs helpers)
// ============================================================
// 1. NETTOYAGE PÉRIODIQUE DES VISITEURS DÉCONNECTÉS
// ============================================================

function startCleanup(pool, getOnlineUsers, intervalMs = 60 * 1000) {
    console.log(`🧹 Nettoyage programmé toutes les ${intervalMs / 1000} secondes`);
    setInterval(async () => {
        try {
            const onlinePseudos = getOnlineUsers();
            if (onlinePseudos.length > 0) {
                const placeholders = onlinePseudos.map((_, i) => `$${i + 1}`).join(',');
                const result = await pool.query(
                    `DELETE FROM users WHERE pseudo NOT IN (${placeholders}) AND (is_member = false OR is_member IS NULL)`,
                    onlinePseudos
                );
                if (result.rowCount > 0) console.log(`🧹 ${result.rowCount} visiteur(s) supprimé(s)`);
            } else {
                const result = await pool.query("DELETE FROM users WHERE is_member = false OR is_member IS NULL");
                if (result.rowCount > 0) console.log(`🧹 Nettoyage complet: ${result.rowCount} visiteur(s) supprimé(s)`);
            }
        } catch (err) {
            console.error('❌ Erreur nettoyage:', err.message);
        }
    }, intervalMs);
}

module.exports = { startCleanup };