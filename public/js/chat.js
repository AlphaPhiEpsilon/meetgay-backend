console.log('✅ chat.js chargé');

// 1. D'abord le token dans son propre bloc
{
    let token = localStorage.getItem('meetgay_token');
    if (!token) {
        window.location.href = '/login.html';
    }
}

// 2. Ensuite socket dans un autre bloc
const socket = io();

// ========== RÉCUPÉRATION DES INFOS UTILISATEUR DEPUIS LA BASE ==========
let user = null;
const storedUser = JSON.parse(localStorage.getItem('meetgay_user'));

async function initUser() {
    console.log('1. Début initUser');
    if (!storedUser || !storedUser.pseudo) {
        console.log('2. Pas de storedUser');
        window.location.href = '/login.html';
        return;
    }

    try {
        console.log('3. Appel fetch pour pseudo:', storedUser.pseudo);
        const response = await fetch('/api/get-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pseudo: storedUser.pseudo })
        });
        console.log('4. Réponse reçue, status:', response.status);
        const data = await response.json();
        console.log('5. Data reçue:', data);
        if (data.success) {
            user = data.user;
            localStorage.setItem('meetgay_user_full', JSON.stringify(user));
            console.log('6. Utilisateur chargé, démarrage chat');
            startChat();
        } else {
            console.log('7. Pas de success');
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Erreur:', err);
        window.location.href = '/login.html';
    }
}

// ========== DÉMARRAGE DU CHAT (après récupération des infos) ==========
function startChat() {
    // Éléments DOM
    const usersDiv = document.getElementById('usersList');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const envelope = document.getElementById('envelope');

    // Variables d'état
    let currentTarget = null;
    let currentTargetName = null;
    let pendingMessages = [];
    let usersList = [];

    // Afficher le pseudo dans le header
    const userBadge = document.getElementById('userBadge');
    if (userBadge) {
        userBadge.innerHTML = `👤 ${escapeHtml(user.pseudo)} | ${user.age} ans`;
    }

    // Initialiser l'utilisateur sur le serveur
    socket.emit('user join', {
        pseudo: user.pseudo,
        age: user.age,
        tendencies: user.tendencies,
        locationCode: user.location_code,
        locationName: user.location_name,
        bio: user.bio || 'Aucune présentation',
        gender: user.gender,
        purpose: user.purpose,
        language: localStorage.getItem('MeetGay_lang') || 'fr'
    });

    
    socket.on('join confirmed', (data) => {
        console.log('✅ Join confirmé par le serveur:', data);
    });

    socket.on('join error', (error) => {
        console.error('❌ Erreur join:', error);
    });

    // --------------------------------------------------------------
    // GESTION DE LA LISTE DES CONNECTÉS
    // --------------------------------------------------------------
    socket.on('update users', (usersListData) => {
        usersList = usersListData;

        if (usersList.length === 0) {
            usersDiv.innerHTML = '<em>Aucun connecté</em>';
            return;
        }

        usersDiv.innerHTML = '';

        usersList.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-item';
            const orientationSymbol = getOrientationSymbol(u.tendencies);

            // Vérifier si c'est l'utilisateur courant (comparer les socketId)
            if (u.socketId === socket.id) {
                div.innerHTML = `<strong>${escapeHtml(u.pseudo)} (moi)</strong> <span style="font-size:12px;">(${u.age} ans, ${orientationSymbol} ${u.locationName || u.locationCode})</span>`;
                div.style.background = '#e9ecef';
                div.style.fontStyle = 'italic';
            } else {
                div.innerHTML = `<strong>${escapeHtml(u.pseudo)}</strong> <span style="font-size:12px;">(${u.age} ans, ${orientationSymbol} ${u.locationName || u.locationCode})</span>`;
                div.onclick = () => {
                    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('current-target'));
                    div.classList.add('current-target');

                    currentTarget = u.socketId;
                    currentTargetName = u.pseudo;
                    messageInput.disabled = false;
                    sendBtn.disabled = false;
                    messageInput.placeholder = `Message pour ${u.pseudo}...`;
                    messageInput.focus();
                    clearMessageArea();

                    showContactInfo(
                        u.pseudo,
                        u.age,
                        u.gender,
                        u.tendencies,
                        u.locationName || u.locationCode,  // ← ici on passe la localité
                        u.purpose,
                        u.bio || 'Pas de présentation'
                    );
                };
            }
            usersDiv.appendChild(div);
        });
    });

    // --------------------------------------------------------------
    // ENVOI ET RÉCEPTION DES MESSAGES
    // --------------------------------------------------------------
    socket.on('message sent confirmation', (data) => {
        displayMessage(data.message, 'sent', null, currentTargetName);
        addToHistory(currentTargetName, data.message, 'sent', user.pseudo, currentTargetName);
        messageInput.value = '';
        messageInput.focus();
    });

    socket.on('private message received', (data) => {
        pendingMessages.push(data);
        updateEnvelope(pendingMessages.length);
        startBlinking();
    });

    socket.on('error', (msg) => {
        console.error('Erreur:', msg);
    });

    socket.on('force logout', (data) => {
        alert(data.reason);
        localStorage.removeItem('meetgay_token');
        localStorage.removeItem('meetgay_user');
        window.location.href = '/login.html';
    });

    // --------------------------------------------------------------
    // ENVELOPPE (messages reçus)
    // --------------------------------------------------------------
    envelope.onclick = () => {
        if (pendingMessages.length === 0) return;

        const msg = pendingMessages.shift();
        displayMessage(msg.message, 'received', msg.fromPseudo);
        addToHistory(msg.fromPseudo, msg.message, 'received', msg.fromPseudo, user.pseudo);

        currentTarget = msg.fromSocketId;
        currentTargetName = msg.fromPseudo;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.placeholder = `Répondre à ${msg.fromPseudo}...`;
        messageInput.focus();

        document.querySelectorAll('.user-item').forEach(el => {
            if (el.textContent.includes(msg.fromPseudo) && !el.textContent.includes('(moi)')) {
                document.querySelectorAll('.user-item').forEach(e => e.classList.remove('current-target'));
                el.classList.add('current-target');
            }
        });

        const senderInfo = usersList.find(u => u.pseudo === msg.fromPseudo);
        if (senderInfo) {
            let bioText = senderInfo.bio || "Pas de présentation";
            showContactInfo(senderInfo.pseudo, senderInfo.age, senderInfo.gender, senderInfo.tendencies, senderInfo.locationName || senderInfo.locationCode, senderInfo.purpose, bioText);
        } else {
            showContactInfo(msg.fromPseudo, '?', '', '?', '?', '?', 'Bio non disponible');
        }

        updateEnvelope(pendingMessages.length);
        if (pendingMessages.length === 0) {
            stopBlinking();
        }
    };

    // --------------------------------------------------------------
    // ENVOI DE MESSAGE
    // --------------------------------------------------------------
    sendBtn.onclick = () => {
        const text = messageInput.value.trim();
        if (!text || !currentTarget) return;

        if (currentReceivedMessage !== null) {
            clearMessageArea();
        }

        socket.emit('private message', {
            toSocketId: currentTarget,
            message: text,
            fromPseudo: user.pseudo
        });
    };

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendBtn.click();
    });

    // --------------------------------------------------------------
    // CHAT PRIVÉ (POPUP)
    // --------------------------------------------------------------
    let privateChatAvailable = {};

    socket.on('privateChatAvailable', (data) => {
        console.log(`🔔 Seuil atteint avec ${data.with}`);
        privateChatAvailable[data.with] = true;
        showPrivatePopup(data.with);
    });

    function showPrivatePopup(pseudo) {
        if (document.getElementById('privatePopup')) return;

        const chatPanel = document.querySelector('.chat-panel');
        if (!chatPanel) return;

        if (getComputedStyle(chatPanel).position !== 'relative') {
            chatPanel.style.position = 'relative';
        }

        const inputArea = document.querySelector('.input-area');
        if (!inputArea) return;

        const inputRect = inputArea.getBoundingClientRect();
        const chatRect = chatPanel.getBoundingClientRect();
        const topPosition = inputRect.bottom - chatRect.top;

        const popup = document.createElement('div');
        popup.id = 'privatePopup';
        popup.style.cssText = `
            position: absolute;
            top: ${topPosition + 5}px;
            left: 0;
            right: 0;
            background: #2c3e50;
            color: white;
            border-radius: 8px;
            padding: 10px 12px;
            z-index: 1000;
            font-family: 'Segoe UI', sans-serif;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            opacity: 0;
            transform: translateY(-10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        `;

        popup.innerHTML = `
            <span>💬 <strong>${pseudo}</strong> : 3 messages échangés. Passer en privé ?</span>
            <div style="display: flex; gap: 6px;">
                <button id="popupAccept" style="background:#27ae60; color:white; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">✅ Oui</button>
                <button id="popupDecline" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">❌ Non</button>
            </div>
        `;

        chatPanel.appendChild(popup);

        setTimeout(() => {
            popup.style.opacity = '1';
            popup.style.transform = 'translateY(0)';
        }, 10);

        document.getElementById('popupAccept').onclick = () => {
            socket.emit('invitePrivate', { toPseudo: pseudo, fromPseudo: user.pseudo });
            popup.remove();
        };

        document.getElementById('popupDecline').onclick = () => {
            popup.remove();
        };
    }

    socket.on('privateInviteReceived', (data) => {
        if (document.getElementById('invitePopup')) return;

        const chatPanel = document.querySelector('.chat-panel');
        if (!chatPanel) return;

        if (getComputedStyle(chatPanel).position !== 'relative') {
            chatPanel.style.position = 'relative';
        }

        const inputArea = document.querySelector('.input-area');
        if (!inputArea) return;

        const inputRect = inputArea.getBoundingClientRect();
        const chatRect = chatPanel.getBoundingClientRect();
        const topPosition = inputRect.bottom - chatRect.top;

        const popup = document.createElement('div');
        popup.id = 'invitePopup';
        popup.style.cssText = `
            position: absolute;
            top: ${topPosition + 5}px;
            left: 0;
            right: 0;
            background: #2c3e50;
            color: white;
            border-radius: 8px;
            padding: 10px 12px;
            z-index: 1000;
            font-family: 'Segoe UI', sans-serif;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            opacity: 0;
            transform: translateY(-10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        `;

        popup.innerHTML = `
            <span>🔔 <strong>${data.from}</strong> vous invite en chat privé.</span>
            <div style="display: flex; gap: 6px;">
                <button id="inviteAccept" style="background:#27ae60; color:white; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">✅ Accepter</button>
                <button id="inviteDecline" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">❌ Refuser</button>
            </div>
        `;

        chatPanel.appendChild(popup);

        setTimeout(() => {
            popup.style.opacity = '1';
            popup.style.transform = 'translateY(0)';
        }, 10);

        document.getElementById('inviteAccept').onclick = () => {
            socket.emit('acceptPrivateInvite', { fromPseudo: data.from, toPseudo: user.pseudo });
            popup.remove();
            alert(`💬 Chat privé ouvert avec ${data.from} !`);
        };

        document.getElementById('inviteDecline').onclick = () => {
            socket.emit('declinePrivateInvite', { fromPseudo: user.pseudo, toPseudo: data.from });
            popup.remove();
        };
    });
}

// ========== LANCEMENT ==========
initUser();