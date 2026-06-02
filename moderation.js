// moderation.js - Gestion des bans et warns

// Vérifier si un utilisateur est banni
async function isBanned(pool, pseudo, ip, fingerprint) {
    // 1. Vérifier par pseudo
    const result = await pool.query(
        `SELECT * FROM users WHERE pseudo = $1 AND is_banned = true`,
        [pseudo]
    );
    if (result.rows.length > 0) return true;

    // 2. Plus tard : vérifier par IP + fingerprint
    return false;
}

// Appliquer le ban : déconnecter immédiatement
function disconnectBannedUser(io, users, pseudo, reason) {
    const sockets = Object.entries(users).filter(([_, u]) => u.pseudo === pseudo);
    sockets.forEach(([socketId]) => {
        io.to(socketId).emit('force logout', { reason: `Vous avez été banni : ${reason}` });
        const socket = io.sockets.sockets.get(socketId);
        if (socket) socket.disconnect();
    });
}

module.exports = { isBanned, disconnectBannedUser };