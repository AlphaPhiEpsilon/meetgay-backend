// ============================================================
// backup.js - Sauvegarde du code et de la base de données
// ============================================================
// 1. FONCTIONS DE SAUVEGARDE (backupCode, backupDatabase)
// 2. ROUTE /api/backup (protégée par admin)
// ============================================================

const { exec } = require('child_process');

// ========== 1. SAUVEGARDE DU CODE ==========
function backupCode(callback) {
    const cmd = 'cd /root/meetgay && git add . && git commit -m "Sauvegarde web" && git push origin main 2>&1';
    exec(cmd, (error, stdout, stderr) => {
        const output = stdout || stderr;
        console.log(`📦 Backup code : ${output || (error ? 'Erreur' : 'Succès')}`);
        if (callback) callback(error, output);
    });
}

// ========== 2. SAUVEGARDE DE LA BASE ==========
function backupDatabase(callback) {
    const date = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `/root/backups/mgb_db_${date}.sql`;
    const cmd = `mkdir -p /root/backups && pg_dump -U admin_omega -h localhost mgb_db > ${filename} 2>&1 && echo "✅ Sauvegarde DB : ${filename}"`;
    exec(cmd, (error, stdout, stderr) => {
        const output = stdout || stderr;
        console.log(`🗄️ Backup DB : ${output || (error ? 'Erreur' : 'Succès')}`);
        if (callback) callback(error, output);
    });
}

// ========== 3. ROUTE API (appelée par server.js) ==========
function setupBackupRoute(app, isAdminToken, JWT_SECRET) {
    app.post('/api/backup', async (req, res) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Non autorisé' });
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role !== 'admin') throw new Error();
        } catch {
            return res.status(403).json({ error: 'Admin requis' });
        }

        const { action } = req.body;
        if (action === 'code') {
            backupCode((err, output) => {
                if (err) return res.json({ error: output });
                res.json({ success: true, output });
            });
        } else if (action === 'database') {
            backupDatabase((err, output) => {
                if (err) return res.json({ error: output });
                res.json({ success: true, output });
            });
        } else {
            res.status(400).json({ error: 'Action inconnue' });
        }
    });
}

module.exports = { backupCode, backupDatabase, setupBackupRoute };