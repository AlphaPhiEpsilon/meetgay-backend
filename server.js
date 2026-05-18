const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// ========== SERVEUR STATIQUE ==========
app.use(express.static('public'));  // ← AJOUT OBLIGATOIRE

// ========== SÉCURITÉ ==========
// Helmet désactivé temporairement pour éviter les erreurs CSP
// app.use(helmet());

// Limitation du nombre de requêtes HTTP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
});
app.use(limiter);

// CORS
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

// ========== STOCKAGE ==========
const users = {};
const exchangedMessages = {};
const userMessageCounts = {};

// Fonction pour incrémenter le compteur de messages échangés
function incrementMessageCount(pseudo1, pseudo2) {
    const key = [pseudo1, pseudo2].sort().join('|');
    if (!exchangedMessages[key]) {
        exchangedMessages[key] = 0;
    }
    exchangedMessages[key]++;

    console.log(`📊 Messages échangés entre ${pseudo1} et ${pseudo2} : ${exchangedMessages[key]}`);

    if (exchangedMessages[key] === 3) {
        console.log(`🎉 Seuil atteint ! ${pseudo1} et ${pseudo2} peuvent passer en chat privé.`);

        const socketId1 = Object.keys(users).find(id => users[id].pseudo === pseudo1);
        const socketId2 = Object.keys(users).find(id => users[id].pseudo === pseudo2);

        if (socketId1) {
            io.to(socketId1).emit('privateChatAvailable', { with: pseudo2 });
        }
        if (socketId2) {
            io.to(socketId2).emit('privateChatAvailable', { with: pseudo1 });
        }
    }
}

// ========== FONCTIONS DE VALIDATION ==========
function isValidPseudo(pseudo) {
    return pseudo && typeof pseudo === 'string' &&
        pseudo.length >= 2 && pseudo.length <= 15 &&
        /^[a-zA-Z0-9À-ÿ\s\-_]+$/.test(pseudo);
}

function isValidBio(bio) {
    if (!bio) return true;
    return typeof bio === 'string' && bio.length <= 100;
}

function isValidAge(age) {
    const a = parseInt(age);
    return !isNaN(a) && a >= 18 && a <= 99;
}

function isValidTendencies(t) {
    return ['A', 'P', 'V'].includes(t);
}

function isValidGender(g) {
    return ['G', 'H', 'T'].includes(g);
}

function isValidPurpose(p) {
    return ['meeting', 'flirt', 'adultery'].includes(p);
}

function sanitizeString(str) {
    if (!str) return '';
    return str.replace(/[<>]/g, '');
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('🔌 Nouvelle connexion :', socket.id);

    // Messages privés
    socket.on('private message', (data) => {
        const now = Date.now();
        if (!userMessageCounts[socket.id]) {
            userMessageCounts[socket.id] = [];
        }

        // Compteur de messages échangés
        const fromPseudo = data.fromPseudo;
        const toPseudo = users[data.toSocketId]?.pseudo;
        if (toPseudo) {
            incrementMessageCount(fromPseudo, toPseudo);
        }

        userMessageCounts[socket.id] = userMessageCounts[socket.id].filter(
            time => time > now - 5000
        );

        if (userMessageCounts[socket.id].length >= 5) {
            socket.emit('error', 'Vous envoyez trop de messages. Ralentissez.');
            return;
        }

        userMessageCounts[socket.id].push(now);

        if (!data.message || data.message.length > 500) {
            socket.emit('error', 'Message invalide ou trop long');
            return;
        }

        const cleanMessage = sanitizeString(data.message);

        if (users[data.toSocketId]) {
            io.to(data.toSocketId).emit('private message received', {
                fromPseudo: sanitizeString(data.fromPseudo),
                message: cleanMessage,
                fromSocketId: socket.id
            });
            socket.emit('message sent confirmation', {
                toPseudo: sanitizeString(users[data.toSocketId].pseudo),
                message: cleanMessage
            });
        } else {
            socket.emit('error', 'Destinataire déconnecté');
        }
    });

    // Connexion utilisateur
    socket.on('user join', (userInfo) => {
        if (!isValidPseudo(userInfo.pseudo)) {
            socket.emit('error', 'Pseudo invalide (2-15 caractères)');
            socket.disconnect();
            return;
        }

        if (!isValidAge(userInfo.age)) {
            socket.emit('error', 'Âge invalide (18-99)');
            socket.disconnect();
            return;
        }

        if (!isValidTendencies(userInfo.tendencies)) {
            userInfo.tendencies = 'V';
        }

        if (!isValidGender(userInfo.gender)) {
            userInfo.gender = 'H';
        }

        if (!isValidPurpose(userInfo.purpose)) {
            userInfo.purpose = 'meeting';
        }

        if (!isValidBio(userInfo.bio)) {
            userInfo.bio = userInfo.bio.substring(0, 100);
        }

        const cleanUser = {
            pseudo: sanitizeString(userInfo.pseudo),
            age: parseInt(userInfo.age),
            tendencies: userInfo.tendencies,
            gender: userInfo.gender,
            purpose: userInfo.purpose,
            locationCode: sanitizeString(userInfo.locationCode),
            locationName: sanitizeString(userInfo.locationName),
            bio: sanitizeString(userInfo.bio || "Aucune présentation"),
            language: userInfo.language || 'fr',
            socketId: socket.id
        };

        users[socket.id] = cleanUser;
        console.log('✅ Utilisateur connecté :', cleanUser.pseudo);
        io.emit('update users', Object.values(users));
    });

    socket.on('invitePrivate', ({ toPseudo, fromPseudo }) => {
        const toSocketId = Object.keys(users).find(id => users[id].pseudo === toPseudo);
        if (toSocketId) {
            io.to(toSocketId).emit('privateInviteReceived', { from: fromPseudo });
        }
    });

    socket.on('declinePrivateInvite', ({ toPseudo, fromPseudo }) => {
        const fromSocketId = Object.keys(users).find(id => users[id].pseudo === fromPseudo);
        if (fromSocketId) {
            io.to(fromSocketId).emit('privateInviteDeclined', { by: toPseudo });
        }
    });

    socket.on('acceptPrivateInvite', ({ fromPseudo, toPseudo }) => {
        const roomName = `private_${fromPseudo}_${toPseudo}`;
        const fromSocketId = Object.keys(users).find(id => users[id].pseudo === fromPseudo);
        const toSocketId = Object.keys(users).find(id => users[id].pseudo === toPseudo);

        if (fromSocketId) io.sockets.sockets.get(fromSocketId)?.join(roomName);
        if (toSocketId) io.sockets.sockets.get(toSocketId)?.join(roomName);

        io.to(roomName).emit('privateRoomReady', { room: roomName });
    });

    socket.on('declinePrivateInvite', ({ toPseudo, fromPseudo }) => {
        const fromSocketId = Object.keys(users).find(id => users[id].pseudo === fromPseudo);
        if (fromSocketId) {
            io.to(fromSocketId).emit('privateInviteDeclined', { by: toPseudo });
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            console.log('❌ Déconnexion :', users[socket.id].pseudo);
            delete users[socket.id];
            delete userMessageCounts[socket.id];
            io.emit('update users', Object.values(users));
        }
    });
});

// ========== DÉMARRAGE ==========
server.listen(3000, '0.0.0.0', () => {
    console.log('🚀 Serveur démarré sur http://localhost:3000');
});