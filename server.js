// ============================================================
// server.js - Cœur du chat MeetGay (version base de données)
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
const compression = require('compression');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { disconnectBannedUser } = require('./moderation');
const { startCleanup, startInactivityWatch } = require('./options.js');
const path = require('path');
const bcrypt = require('bcrypt');
const TEST_MODE = true;  // ← Désactive le fingerprint si true
// PARAMÈTRES DE NETTOYAGE ET SURVEILLANCE
const INACTIVITY_MINUTES = 15;      // Déconnexion après X minutes sans activité
const CLEANUP_INTERVAL_MINUTES = 1; // Nettoyage des absents toutes les X minutes

const users = {};

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

// ========== 4. CONFIGURATION EXPRESS ==========
const app = express();
const server = http.createServer(app);

// Gestion d'erreur (port déjà utilisé)
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port déjà utilisé. Tue l'autre processus et redémarre.`);
        process.exit(1);
    }
});

// Compression
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.path === '/socket.io/') return false;
        return compression.filter(req, res);
    }
}));

app.use(express.json());

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: false,
        pruneSessionInterval: 60
    }),
    secret: 'un-super-secret-change-moi',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 jours
    }
}));

// JWT_SECRET pour les utilisateurs normaux
const JWT_SECRET = process.env.JWT_SECRET || 'meetgay_super_secret_key_2026';

// ========== 5. MIDDLEWARE DE MAINTENANCE ==========
app.use(async (req, res, next) => {
    // Exclure assets
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|json|webmanifest)$/i) ||
        req.path === '/api/admin/login' ||
        req.path === '/api/admin/maintenance' ||
        req.path === '/admin-login.html' ||
        req.path === '/admin.html') {
        return next();
    }

    // ✅ VÉRIFIER LA SESSION (PAS UN FLAG GLOBAL)
    const isAdmin = req.session && req.session.isAdmin === true;

    // Lire le mode maintenance
    let maintenance = false;
    try {
        const result = await pool.query(`SELECT value FROM settings WHERE key = 'maintenance_mode'`);
        maintenance = result.rows[0]?.value === 'true';
    } catch (err) {
        console.error('Erreur maintenance:', err.message);
    }

    // Si maintenance OFF → tout le monde passe
    if (!maintenance) {
        return next();
    }

    // Si admin → accès libre
    if (isAdmin) {
        console.log(`👑 Admin ${req.session.adminUsername} accède à ${req.path}`);
        return next();
    }

    // Maintenance ON et pas admin → rediriger vers /
    if (req.path !== '/') {
        console.log(`🚧 Redirection de ${req.path} vers /`);
        return res.redirect('/');
    }

    next();
});


// Ajoute cette configuration AVANT tes routes
app.use(express.static('/var/www/meetgay/public', {
    setHeaders: function (res, path) {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));




// ========== ROUTE RACINE AVEC MAINTENANCE ==========
app.get('/', async (req, res) => {
    try {
        const result = await pool.query(`SELECT value FROM settings WHERE key = 'maintenance_mode'`);
        const maintenance = result.rows[0]?.value === 'true';

        console.log(`🌐 Accès racine - Maintenance: ${maintenance ? 'ON' : 'OFF'}`);

        if (maintenance) {
            res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
        } else {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    } catch (err) {
        console.error('Erreur:', err);
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.use(express.static('/var/www/meetgay/public'));


// ========== 6. ROUTES PUBLIQUES ==========
app.post('/api/register', async (req, res) => {
    try {
        console.log("🔵 1. Début register, body reçu:", req.body);
        const { pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose, fingerprint } = req.body;

        if (!pseudo || !age) {
            return res.status(400).json({ error: 'Pseudo et âge requis' });
        }
        if (!fingerprint) {
            return res.status(400).json({ error: 'Empreinte numérique requise' });
        }

        // Vérifier si l'empreinte est bannie
        const banCheck = await pool.query(
            `SELECT is_banned, ban_reason FROM fingerprints WHERE fingerprint_hash = $1`,
            [fingerprint]
        );
        if (banCheck.rows.length > 0 && banCheck.rows[0].is_banned) {
            return res.status(403).json({
                error: 'Accès refusé',
                reason: banCheck.rows[0].ban_reason || 'Votre empreinte est bannie'
            });
        }

        // Créer ou mettre à jour l'empreinte
        const fingerprintResult = await pool.query(
            `INSERT INTO fingerprints (fingerprint_hash, last_seen) 
             VALUES ($1, NOW()) 
             ON CONFLICT (fingerprint_hash) 
             DO UPDATE SET last_seen = NOW()
             RETURNING id`,
            [fingerprint]
        );
        const fingerprintId = fingerprintResult.rows[0].id;

        // Créer l'utilisateur
        const result = await pool.query(
            `INSERT INTO users (pseudo, age, tendencies, location_code, location_name, bio, gender, purpose, fingerprint_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (pseudo) DO NOTHING
             RETURNING *`,
            [pseudo, age, tendencies, locationCode, locationName, bio, gender, purpose, fingerprintId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Pseudo déjà utilisé' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Erreur inscription:", err);
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

app.post('/api/delete-user', async (req, res) => {
    let pseudo = req.body.pseudo;

    // Pour sendBeacon (Firefox), les données peuvent arriver sous forme brute
    if (!pseudo && req.body) {
        try {
            // Si c'est du JSON classique
            if (typeof req.body === 'object') pseudo = req.body.pseudo;
            // Si c'est du texte brut (sendBeacon)
            else if (typeof req.body === 'string') {
                const parsed = JSON.parse(req.body);
                pseudo = parsed.pseudo;
            }
        } catch (e) {
            console.error('Erreur parsing body:', e.message);
        }
    }

    if (!pseudo) {
        console.error('❌ Pseudo manquant dans /api/delete-user, body reçu:', req.body);
        return res.status(400).json({ error: 'Pseudo requis' });
    }

    try {
        const result = await pool.query('DELETE FROM users WHERE pseudo = $1 RETURNING pseudo', [pseudo]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        console.log(`🗑️ Utilisateur ${pseudo} supprimé de la base`);
        res.json({ success: true, message: 'Utilisateur supprimé' });
    } catch (err) {
        console.error('Erreur suppression utilisateur:', err);
        res.status(500).json({ error: 'Erreur serveur' });
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

app.post('/api/delete-user', async (req, res) => {
    // 1. Extraction directe (fonctionne pour fetch ET pour sendBeacon + Blob JSON)
    let pseudo = req.body && req.body.pseudo;

    // 2. Fallback de secours si le body est arrivé sous forme de chaîne de caractères
    if (!pseudo && typeof req.body === 'string') {
        try {
            const parsed = JSON.parse(req.body);
            pseudo = parsed.pseudo;
        } catch (e) {
            console.error('❌ Erreur parsing body JSON manuel:', e.message);
        }
    }

    // 3. Validation de la donnée
    if (!pseudo) {
        console.error('❌ Pseudo manquant dans /api/delete-user, body reçu:', req.body);
        return res.status(400).json({ error: 'Pseudo requis' });
    }

    // 4. Traitement en Base de Données
    try {
        const result = await pool.query('DELETE FROM users WHERE pseudo = $1 RETURNING pseudo', [pseudo]);

        if (result.rows.length === 0) {
            console.warn(`⚠️ Tentative de suppression d'un utilisateur inexistant : ${pseudo}`);
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log(`🗑️ Utilisateur ${pseudo} supprimé de la base`);
        return res.json({ success: true, message: 'Utilisateur supprimé' });

    } catch (err) {
        console.error('❌ Erreur SQL lors de la suppression de l\'utilisateur:', err);
        // Toujours renvoyer une réponse pour libérer la connexion Node, même en cas d'erreur
        return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});


// ========== MESSAGES ==========
app.post('/api/messages/save', async (req, res) => {
    const { from, to, message } = req.body;
    if (!from || !to || !message) {
        return res.status(400).json({ error: 'Champs requis' });
    }
    try {
        await pool.query(
            'INSERT INTO messages (from_pseudo, to_pseudo, message) VALUES ($1, $2, $3)',
            [from, to, message]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur save message:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/messages/:pseudo1/:pseudo2', async (req, res) => {
    const { pseudo1, pseudo2 } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM messages 
             WHERE (from_pseudo = $1 AND to_pseudo = $2) 
                OR (from_pseudo = $2 AND to_pseudo = $1)
             ORDER BY created_at ASC`,
            [pseudo1, pseudo2]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erreur get messages:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== CONTACT AVEC EMAIL ==========
const nodemailer = require('nodemailer');

// Configuration SMTP OVH
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

app.post('/api/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    try {
        // Envoyer l'email
        await transporter.sendMail({
            from: `"${name}" <${process.env.SMTP_FROM}>`,
            to: process.env.SMTP_FROM,
            replyTo: email,
            subject: `📬 Contact MeetGay - ${subject}`,
            html: `
                <h2>Nouveau message de contact</h2>
                <p><strong>Nom :</strong> ${name}</p>
                <p><strong>Email :</strong> ${email}</p>
                <p><strong>Sujet :</strong> ${subject}</p>
                <p><strong>Message :</strong></p>
                <p>${message.replace(/\n/g, '<br>')}</p>
            `
        });

        console.log(`📧 Email envoyé de ${name} (${email})`);
        res.json({ success: true, message: 'Message envoyé avec succès' });

    } catch (err) {
        console.error('Erreur contact:', err);
        res.status(500).json({ error: "Erreur d'envoi. Réessayez plus tard." });
    }
});

// ========== 7. ROUTES ADMIN ==========
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(
            `SELECT id, username, password_hash, is_active FROM admins WHERE username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Identifiants incorrects' });
        }

        const admin = result.rows[0];

        if (!admin.is_active) {
            return res.status(401).json({ success: false, error: 'Compte désactivé' });
        }

        const isValid = await bcrypt.compare(password, admin.password_hash);

        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Identifiants incorrects' });
        }

        // CRÉER LA SESSION
        req.session.adminId = admin.id;
        req.session.isAdmin = true;
        req.session.adminUsername = admin.username;

        // FORCER L'INSERTION DANS admin_sessions
        try {
            const sessionId = req.session.id;
            console.log('📝 Tentative insertion - Session ID:', sessionId);
            console.log('📝 Tentative insertion - Admin ID:', admin.id);

            const insertResult = await pool.query(
                `INSERT INTO admin_sessions (session_id, admin_id, is_logged_in, login_time, last_activity) 
                 VALUES ($1, $2, true, NOW(), NOW())
                 ON CONFLICT (session_id) DO UPDATE 
                 SET is_logged_in = true, last_activity = NOW()
                 RETURNING *`,
                [sessionId, admin.id]
            );

            console.log('✅ SUCCÈS - Ligne insérée:', insertResult.rows[0]);
        } catch (dbErr) {
            console.error('❌ ÉCHEC INSERTION:', dbErr.message);
            console.error('Détails:', dbErr);
        }

        res.json({ success: true, admin: { id: admin.id, username: admin.username } });

    } catch (err) {
        console.error('Erreur login admin:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

app.post('/api/admin/logout', async (req, res) => {
    // Mettre à jour la table admin_sessions
    if (req.session && req.session.id) {
        try {
            await pool.query(
                `UPDATE admin_sessions SET is_logged_in = false, logout_time = NOW() 
                 WHERE session_id = $1`,
                [req.session.id]
            );
        } catch (err) {
            console.error('Erreur mise à jour session:', err.message);
        }
    }

    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur déconnexion' });
        }
        res.json({ success: true });
    });
});

app.get('/api/admin/users', async (req, res) => {
    // Vérifier si un admin est connecté via la session
    if (!req.session.isAdmin || !req.session.adminId) {
        return res.status(403).json({ error: 'Accès non autorisé - Veuillez vous connecter' });
    }

    // Si admin connecté, on exécute la requête
    try {
        const result = await pool.query('SELECT pseudo, age, role, warnings, is_banned, ban_reason FROM users ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur admin/users:", err.message);
        res.status(500).json({ error: 'Erreur serveur', details: err.message });
    }
});

app.post('/api/admin/warn', async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET warnings = COALESCE(warnings, 0) + 1 WHERE pseudo = $1', [pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/ban', async (req, res) => {
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

app.post('/api/admin/unban', async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET is_banned = false, ban_reason = NULL WHERE pseudo = $1', [pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/set-modo', async (req, res) => {

    const { pseudo } = req.body;
    await pool.query('UPDATE users SET role = $1 WHERE pseudo = $2', ['modo', pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/set-admin', async (req, res) => {
    const { pseudo } = req.body;
    await pool.query('UPDATE users SET role = $1 WHERE pseudo = $2', ['admin', pseudo]);
    res.json({ success: true });
});

app.post('/api/admin/ban-fingerprint', async (req, res) => {
    const { fingerprint, reason } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ error: 'Empreinte requise' });
    }
    try {
        const check = await pool.query(
            `SELECT id FROM fingerprints WHERE fingerprint_hash = $1`,
            [fingerprint]
        );
        if (check.rows.length === 0) {

            await pool.query(
                `INSERT INTO fingerprints (fingerprint_hash, is_banned, ban_reason, banned_at) 
                 VALUES ($1, true, $2, NOW())`,
                [fingerprint, reason || 'Banni par admin']
            );
        } else {
            await pool.query(
                `UPDATE fingerprints SET is_banned = true, ban_reason = $1, banned_at = NOW() 
                 WHERE fingerprint_hash = $2`,
                [reason || 'Banni par admin', fingerprint]
            );
        }
        const usersToKick = await pool.query(
            `SELECT u.pseudo FROM users u
             JOIN fingerprints f ON u.fingerprint_id = f.id
             WHERE f.fingerprint_hash = $1`,
            [fingerprint]
        );
        for (const user of usersToKick.rows) {
            disconnectBannedUser(io, users, user.pseudo, reason || 'Banni par admin');
        }
        res.json({ success: true, message: `Empreinte bannie, ${usersToKick.rowCount} utilisateur(s) déconnecté(s)` });
    } catch (err) {
        console.error('Erreur ban fingerprint:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});


// ========== MAINTENANCE MODE ==========
app.get('/api/admin/maintenance', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        res.json({ enabled: result.rows[0]?.value === 'true' });
    } catch (err) {
        res.status(500).json({ error: 'Erreur' });
    }
});

app.post('/api/admin/maintenance', async (req, res) => {
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

// Servir admin.html depuis protected/
app.get('/admin.html', (req, res) => {
    res.sendFile('/var/www/meetgay/protected/admin.html');
});

// ========== 8. SOCKET.IO ==========
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["*"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});


// Initialiser la surveillance d’inactivité (5 minutes sans activité)
const { updateActivity } = startInactivityWatch(io, users, pool, INACTIVITY_MINUTES, 60 * 1000);

io.on('connection', (socket) => {
    console.log('🔌 Nouvelle connexion :', socket.id);

    socket.on('user join', async (userInfo) => {
        if (!userInfo || !userInfo.pseudo) {
            socket.emit('join error', { error: 'Pseudo requis pour rejoindre' });
            return;
        }

        // Récupérer la date de création depuis la base
        let firstConnectedAt = Date.now();
        try {
            const result = await pool.query(
                `SELECT first_connected_at FROM users WHERE pseudo = $1`,
                [userInfo.pseudo]
            );
            if (result.rows.length > 0 && result.rows[0].first_connected_at) {
                firstConnectedAt = new Date(result.rows[0].first_connected_at).getTime();
            } else {
                // Si first_connected_at est NULL, on le met à jour avec l’heure actuelle
                await pool.query(
                    `UPDATE users SET first_connected_at = NOW() WHERE pseudo = $1`,
                    [userInfo.pseudo]
                );
            }
        } catch (err) {
            console.error('Erreur récupération first_connected_at:', err.message);
        }

        // Nettoyer les anciennes sockets du même pseudo
        Object.keys(users).forEach((id) => {
            if (users[id].pseudo === userInfo.pseudo) {
                console.log(`🧹 Suppression de l'ancienne socket ${id} de ${userInfo.pseudo}`);
                delete users[id];
            }
        });


        users[socket.id] = { ...userInfo, socketId: socket.id, firstConnectedAt: firstConnectedAt };
        console.log(`✅ ${userInfo.pseudo} a rejoint (${socket.id})`);
        updateActivity(socket.id);

        // Tri par date de première connexion (plus ancien en bas, plus récent en haut)
        const usersList = Object.values(users).sort((a, b) => (b.firstConnectedAt || 0) - (a.firstConnectedAt || 0)).map(u => ({
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
        updateActivity(socket.id);
        socket.to(toSocketId).emit('private message received', {
            message: message,
            fromPseudo: fromPseudo,
            fromSocketId: socket.id
        });
        socket.emit('message sent confirmation', { message: message, to: toSocketId });
    });
});

// ========== 9. OPTIONS EXTERNALISÉES ==========
startCleanup(pool, () => Object.values(users).map(u => u.pseudo), CLEANUP_INTERVAL_MINUTES * 60 * 1000);

// ========== 10. DÉMARRAGE ==========
const PORT = process.env.PORT || 3005;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
