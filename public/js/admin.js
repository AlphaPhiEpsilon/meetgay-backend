// admin.js - Panel d'administration

const adminToken = localStorage.getItem('admin_token');

if (!adminToken) {
    window.location.href = '/admin-login.html';
}

// Vérifier le token admin
async function checkAdmin() {
    try {
        const response = await fetch('/api/admin/verify', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await response.json();

        if (!data.valid) {
            localStorage.removeItem('admin_token');
            window.location.href = '/admin-login.html';
            return false;
        }

        document.getElementById('adminInfo').innerHTML = '<p>✅ Connecté en tant qu\'administrateur</p>';
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

// Déconnexion
function logout() {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin-login.html';
}

// Charger la liste des utilisateurs
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (!response.ok) {
            document.getElementById('usersList').innerHTML = '<p style="color:red">Erreur chargement utilisateurs</p>';
            return;
        }

        const users = await response.json();

        let html = `
            <h2>📋 Utilisateurs (${users.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th>Pseudo</th>
                        <th>Âge</th>
                        <th>Rôle</th>
                        <th>Warnings</th>
                        <th>Statut</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        users.forEach(u => {
            const isBanned = u.is_banned;
            const statusClass = isBanned ? 'status-banned' : 'status-user';
            const statusText = isBanned ? '🚫 Banni' : '✅ Actif';

            html += `
                <tr>
                    <td>${escapeHtml(u.pseudo)}</td>
                    <td>${u.age}</td>
                    <td>${u.role}</td>
                    <td>${u.warnings || 0}</td>
                    <td class="${statusClass}">${statusText}</td>
                    <td>
                        ${!isBanned ? `<button class="btn-warn" onclick="warnUser('${u.pseudo}')">⚠️ Warn</button>` : ''}
                        ${!isBanned ? `<button class="btn-ban" onclick="banUser('${u.pseudo}')">🚫 Ban</button>` : `<button class="btn-unban" onclick="unbanUser('${u.pseudo}')">🔓 Unban</button>`}
                        ${u.role !== 'admin' ? `<button class="btn-modo" onclick="setModo('${u.pseudo}')">👮 Modo</button>` : ''}
                        ${u.role === 'modo' ? `<button class="btn-admin" onclick="setAdmin('${u.pseudo}')">👑 Admin</button>` : ''}
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        document.getElementById('usersList').innerHTML = html;

    } catch (err) {
        console.error(err);
        document.getElementById('usersList').innerHTML = '<p style="color:red">Erreur chargement</p>';
    }
}

// Warn un utilisateur
async function warnUser(pseudo) {
    if (!confirm(`Envoyer un avertissement à ${pseudo} ?`)) return;

    const response = await fetch('/api/admin/warn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ pseudo })
    });

    if (response.ok) {
        alert(`⚠️ ${pseudo} a reçu un avertissement`);
        loadUsers();
    } else {
        alert('Erreur');
    }
}

// Bannir un utilisateur
async function banUser(pseudo) {
    const reason = prompt(`Raison du bannissement pour ${pseudo} :`);
    if (!reason) return;

    const response = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ pseudo, reason })
    });

    if (response.ok) {
        alert(`🚫 ${pseudo} a été banni`);
        loadUsers();
    } else {
        alert('Erreur');
    }
}

// Débannir un utilisateur
async function unbanUser(pseudo) {
    if (!confirm(`Réactiver ${pseudo} ?`)) return;

    const response = await fetch('/api/admin/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ pseudo })
    });

    if (response.ok) {
        alert(`🔓 ${pseudo} a été réactivé`);
        loadUsers();
    } else {
        alert('Erreur');
    }
}

// Nommer modérateur
async function setModo(pseudo) {
    if (!confirm(`Donner le rôle modérateur à ${pseudo} ?`)) return;

    const response = await fetch('/api/admin/set-modo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ pseudo })
    });

    if (response.ok) {
        alert(`👮 ${pseudo} est maintenant modérateur`);
        loadUsers();
    } else {
        alert('Erreur');
    }
}

// Nommer admin
async function setAdmin(pseudo) {
    if (!confirm(`⚠️ Donner le rôle ADMIN à ${pseudo} ? (action irréversible)`)) return;

    const response = await fetch('/api/admin/set-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ pseudo })
    });

    if (response.ok) {
        alert(`👑 ${pseudo} est maintenant administrateur`);
        loadUsers();
    } else {
        alert('Erreur');
    }
}

// Fonction utilitaire
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Initialisation
(async function () {
    const isValid = await checkAdmin();
    if (isValid) {
        loadUsers();
    }
})();