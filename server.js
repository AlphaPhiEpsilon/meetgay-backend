// ============================================================
// server.js - Cœur du chat MeetGay (restructuré)
// ============================================================
// STRUCTURE :
// 1. CHARGEMENT DES VARIABLES D'ENVIRONNEMENT
// 2. IMPORTS
// 3. CONNEXION À POSTGRESQL
// 4. MIDDLEWARES EXPRESS
// 5. JWT & ADMIN MIDDLEWARE
// 6. ROUTES PUBLIQUES (register, login, get-user, verify-token)
// 7. ROUTES ADMIN (warn, ban, unban, set-modo, set-admin)
// 8. SOCKET.IO (chat temps réel + messages privés)
// 9. OPTIONS EXTERNALISÉES (nettoyage + backup)
// 10. DÉMARRAGE DU SERVEUR
// ============================================================

// ========== 1. CHARGEMENT DES VARIABLES D'ENVIRONNEMENT ==========
if (process.env.NODE_ENV !== 'production') {
    try {
        require('dotenv').config();
        console.log('✅ dotenv chargé (environnement local)');
    } catch (err) {
        console.log('⚠️ dotenv non installé, utilisation des variables système');
    }
} else {
    console.log('✅ Mode production, variables Render utilisées');
}

// ========== 2. IMPORTS ==========
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { disconnectBannedUser } = require('./moderation');
const { startCleanup } = require('./options');
//const { setupBackupRoute } = require('./backup');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// ========== 3. CONNEXION À POSTGRESQL ==========
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'mgb_db',
    user: process.env.DB_USER || 'admin_omega',
    password: process.env.DB_PASSWORD || 'AdminOmega1977',
});
console.log('🔍 DB_USER:', process.env.DB_USER);
console.log('🔍 DB_PASSWORD:', process.env.DB_PASSWORD ? '******' : 'MISSING');

// Middleware d'authentification admin
const isAdminToken = (req, res, next) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey === 'omega1977') {
        next();
    } else {
        res.status(401).json({ error: 'Accès non autorisé' });
    }
};


// ========== 4. CONFIGURATION EXPRESS ==========
const app = express();
const server = http.createServer(app);
app.use(express.json());
// JWT_SECRET déclaré d’abord
var JWT_SECRET = process.env.JWT_SECRET || 'meetgay_super_secret_key_2026';
// Ensuite le middleware
app.use(async (req, res, next) => {
    // Ignorer les fichiers statiques
    if (req.path.match(/\.(css|js|png|jpg|ico|json)$/)) {
        return next();
    }

    // Ignorer la route login (pour que les utilisateurs puissent se connecter)
    if (req.path === '/api/login') {
        return next();
    }

    // Vérifier si l'utilisateur est admin (via token JWT)
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role === 'admin') isAdmin = true;
        } catch (err) { }
    }

    if (isAdmin) {
        return next();  // Les admins voient le site normalement
    }

    // Vérifier le mode maintenance
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        const maintenance = result.rows[0]?.value === 'true';
        if (maintenance) {
            return res.status(503).sendFile(path.join(__dirname, 'public', 'maintenance.html'));
        }
        next();
    } catch (err) {
        next();
    }
});

app.use(express.static('public'));



// ========== 6. ROUTES PUBLIQUES ==========
app.post('/api/register', async (req, res) => {
    try {
        const { pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose } = req.body;
        if (!pseudo || !age) return res.status(400).json({ error: 'Pseudo et âge requis' });

        const result = await pool.query(
            `INSERT INTO users (pseudo, age, tendencies, location_code, location_name, bio, gender, purpose)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (pseudo) DO NOTHING
             RETURNING *`,
            [pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose]
        );

        if (result.rows.length === 0) return res.status(400).json({ error: 'Pseudo déjà utilisé' });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Erreur inscription:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    const { pseudo } = req.body;
    if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE pseudo = $1', [pseudo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, pseudo: user.pseudo, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { pseudo: user.pseudo, role: user.role } });
    } catch (err) {
        console.error('Erreur login:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/verify-token', (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false, error: 'Token manquant' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: true, user: decoded });
    } catch {
        res.json({ valid: false, error: 'Token invalide' });
    }
});

app.post('/api/get-user', async (req, res) => {
    const { pseudo } = req.body;
    if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE pseudo = $1', [pseudo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Erreur get-user:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== 7. ROUTES ADMIN ==========
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        const adminToken = jwt.sign({ role: 'admin', type: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, token: adminToken });
    }
    res.status(401).json({ success: false, error: 'Mot de passe incorrect' });
});

app.get('/api/admin/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: decoded.type === 'admin' });
    } catch {
        res.json({ valid: false });
    }
});

app.get('/api/admin/users', isAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT pseudo, age, role, warnings, is_banned, ban_reason FROM users ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Erreur admin/users:", err.message);
        res.status(500).json({ error: 'Erreur serveur', details: err.message });
    }
});

app.post('/api/admin/warn', isAdminToken, async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET warnings = COALESCE(warnings, 0) + 1 WHERE pseudo = $1', [pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/ban', isAdminToken, async (req, res) => {
    const { pseudo, reason } = req.body;
    try {
        await pool.query('UPDATE users SET is_banned = true, ban_reason = $1 WHERE pseudo = $2', [reason, pseudo]);
        disconnectBannedUser(io, users, pseudo, reason);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur' });
    }
});

app.post('/api/admin/unban', isAdminToken, async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET is_banned = false, ban_reason = NULL WHERE pseudo = $1', [pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/set-modo', isAdminToken, async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET role = $1 WHERE pseudo = $2', ['modo', pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/set-admin', isAdminToken, async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET role = $1 WHERE pseudo = $2', ['admin', pseudo]);
    res.json({ success: true });
});

// ========== 8. SOCKET.IO (CHAT TEMPS RÉEL) ==========
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const users = {};

io.on('connection', (socket) => {
    console.log('🔌 Nouvelle connexion :', socket.id);

    socket.on('user join', (userInfo) => {
        if (!userInfo || !userInfo.pseudo) {
            socket.emit('join error', { error: 'Pseudo requis pour rejoindre' });
            return;
        }
        users[socket.id] = { ...userInfo, socketId: socket.id };
        console.log(`✅ ${userInfo.pseudo} a rejoint (${socket.id})`);

        const usersList = Object.values(users).map(u => ({
            pseudo: u.pseudo,
            age: u.age,
            tendencies: u.tendencies,
            gender: u.gender,
            purpose: u.purpose,
            bio: u.bio,
            locationCode: u.locationCode,
            locationName: u.locationName,
            socketId: u.socketId
        }));
        io.emit('update users', usersList);
        socket.emit('join confirmed', { success: true, user: userInfo });
    });

    socket.on('private message', (data) => {
        const { toSocketId, message, fromPseudo } = data;
        console.log(`💬 Message privé de ${fromPseudo} vers ${toSocketId}: ${message}`);
        socket.to(toSocketId).emit('private message received', {
            message: message,
            fromPseudo: fromPseudo,
            fromSocketId: socket.id
        });
        socket.emit('message sent confirmation', { message: message, to: toSocketId });
    });

    socket.on('disconnect', () => {
        const disconnectedUser = users[socket.id];
        if (disconnectedUser) console.log(`❌ ${disconnectedUser.pseudo} s'est déconnecté (${socket.id})`);
        else console.log(`❌ Déconnexion inconnue : ${socket.id}`);
        delete users[socket.id];
        const usersList = Object.values(users).map(u => ({
            pseudo: u.pseudo,
            age: u.age,
            tendencies: u.tendencies,
            gender: u.gender,
            purpose: u.purpose,
            bio: u.bio,
            locationCode: u.locationCode,
            locationName: u.locationName,
            socketId: u.socketId
        }));
        io.emit('update users', usersList);
    });

    socket.on('ping', () => socket.emit('pong'));
});


// ========== MAINTENANCE MODE (admin seulement) ==========
app.get('/api/admin/maintenance', async (req, res) => {
    // Vérifier le token admin
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error();
    } catch {
        return res.status(403).json({ error: 'Admin requis' });
    }

    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        res.json({ enabled: result.rows[0]?.value === 'true' });
    } catch (err) {
        res.status(500).json({ error: 'Erreur' });
    }
});

app.post('/api/admin/maintenance', async (req, res) => {
    // Vérifier le token admin
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error();
    } catch {
        return res.status(403).json({ error: 'Admin requis' });
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled doit être true/false' });
    }
    try {
        await pool.query("UPDATE settings SET value = $1 WHERE key = 'maintenance_mode'", [enabled ? 'true' : 'false']);
        res.json({ success: true, enabled });
    } catch (err) {
        res.status(500).json({ error: 'Erreur' });
    }
});


// ========== 9. OPTIONS EXTERNALISÉES ==========
startCleanup(pool, () => Object.values(users).map(u => u.pseudo), 60 * 1000);

// ========== 10. DÉMARRAGE ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});