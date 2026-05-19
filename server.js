// ========== CHARGEMENT DES VARIABLES ==========
// ========== CHARGEMENT DES VARIABLES D'ENVIRONNEMENT ==========
// dotenv est utilisé uniquement en développement local
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

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
// ========== BASE DE DONNÉES POSTGRESQL (LOCAL) ==========
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'meetgay_db',
    user: process.env.DB_USER || 'meetgay_user',
    password: process.env.DB_PASSWORD || 'MeetGay2026!',
});

const app = express();
const server = http.createServer(app);
const JWT_SECRET = 'meetgay_super_secret_key_2026';



// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.static('public'));

// ========== SOCKET.IO ==========
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const users = {};

// ========== ROUTES API ==========
app.post('/api/register', async (req, res) => {
    try {
        // 1. On déclare et on extrait d'abord
        const { pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose } = req.body;

        // 2. Ensuite on vérifie
        if (!pseudo || !age) {
            return res.status(400).json({ error: 'Pseudo et âge requis' });
        }

        // 3. Puis on utilise les variables
        const result = await pool.query(
            `INSERT INTO users (pseudo, age, tendencies, location_code, location_name, bio, gender, purpose)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (pseudo) DO NOTHING
             RETURNING *`,
            [pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Pseudo déjà utilisé' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Erreur inscription:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== SOCKET.IO ÉVÉNEMENTS ==========
io.on('connection', (socket) => {
    console.log('🔌 Nouvelle connexion :', socket.id);

    // ← MODIFIÉ : ajout de socketId dans l'objet user
    socket.on('user join', (userInfo) => {
        if (!userInfo || !userInfo.pseudo) {
            socket.emit('join error', { error: 'Pseudo requis pour rejoindre' });
            return;
        }

        users[socket.id] = {
            ...userInfo,
            socketId: socket.id
        };

        console.log(`✅ ${userInfo.pseudo} a rejoint (${socket.id})`);

        // Construction EXPLICITE de la liste à envoyer
        const usersList = Object.values(users).map(user => ({
            pseudo: user.pseudo,
            age: user.age,
            tendencies: user.tendencies,
            gender: user.gender,
            purpose: user.purpose,
            bio: user.bio,
            locationCode: user.locationCode,
            locationName: user.locationName,
            socketId: user.socketId
        }));

        io.emit('update users', usersList);
        socket.emit('join confirmed', { success: true, user: userInfo });
    });


    // ← NOUVEAU : Gestion des messages privés
    socket.on('private message', (data) => {
        const { toSocketId, message, fromPseudo } = data;

        console.log(`💬 Message privé de ${fromPseudo} vers ${toSocketId}: ${message}`);

        // Envoyer au destinataire
        socket.to(toSocketId).emit('private message received', {
            message: message,
            fromPseudo: fromPseudo,
            fromSocketId: socket.id
        });

        // Confirmation à l'expéditeur
        socket.emit('message sent confirmation', {
            message: message,
            to: toSocketId
        });
    });

    // ========== GESTION DÉCONNEXION SOCKET ==========
    socket.on('disconnect', () => {
        const disconnectedUser = users[socket.id];
        if (disconnectedUser) {
            console.log(`❌ ${disconnectedUser.pseudo} s'est déconnecté (${socket.id})`);
        } else {
            console.log(`❌ Déconnexion inconnue : ${socket.id}`);
        }

        delete users[socket.id];

        const usersList = Object.values(users).map(user => ({
            pseudo: user.pseudo,
            age: user.age,
            tendencies: user.tendencies,
            gender: user.gender,
            purpose: user.purpose,
            bio: user.bio,
            locationCode: user.locationCode,
            locationName: user.locationName,
            socketId: user.socketId
        }));

        io.emit('update users', usersList);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// ========== ROUTE GET-USER (RÉCUPÉRER PROFIL UTILISATEUR) ==========
app.post('/api/get-user', async (req, res) => {
    const { pseudo } = req.body;

    if (!pseudo) {
        return res.status(400).json({ error: 'Pseudo requis' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE pseudo = $1', [pseudo]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Erreur get-user:', err);
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
        res.json({ success: true, token, user: { id: user.id, pseudo: user.pseudo, role: user.role } });
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




// ========== ADMIN (UNIQUE VERSION) ==========
async function isAdminToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type === 'admin') return next();
        res.status(403).json({ error: 'Admin requis' });
    } catch {
        res.status(401).json({ error: 'Token invalide' });
    }
}

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

const { disconnectBannedUser } = require('./moderation');

app.post('/api/admin/ban', isAdminToken, async (req, res) => {
    const { pseudo, reason } = req.body;
    try {
        await pool.query('UPDATE users SET is_banned = true, ban_reason = $1 WHERE pseudo = $2', [reason, pseudo]);

        // Déconnecter immédiatement si en ligne
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

// ========== NETTOYAGE PÉRIODIQUE DES VISITEURS ==========
setInterval(async () => {
    try {
        const onlinePseudos = Object.values(users).map(u => u.pseudo);
        console.log(`🧹 Nettoyage... Connectés: ${onlinePseudos.length}`);

        if (onlinePseudos.length > 0) {
            const placeholders = onlinePseudos.map((_, i) => `$${i + 1}`).join(',');
            const result = await pool.query(
                `DELETE FROM users WHERE pseudo NOT IN (${placeholders}) AND (is_member = false OR is_member IS NULL)`,
                onlinePseudos
            );
            if (result.rowCount > 0) {
                console.log(`🧹 ${result.rowCount} visiteur(s) supprimé(s) de la base`);
            }
        } else {
            const result = await pool.query("DELETE FROM users WHERE is_member = false OR is_member IS NULL");
            if (result.rowCount > 0) {
                console.log(`🧹 Nettoyage complet: ${result.rowCount} visiteur(s) supprimé(s)`);
            }
        }
    } catch (err) {
        console.error('❌ Erreur nettoyage:', err.message);
    }
}, 60 * 1000); // 1 minute pour tester, mets 5*60*1000 après

// ========== DÉMARRAGE ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📊 Connexion Supabase: ${process.env.PGHOST ? 'configurée' : 'NON CONFIGURÉE'}`);
    console.log(`📊 Host: ${process.env.PGHOST}`);
});
