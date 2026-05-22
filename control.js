require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = 3001;
const SECRET_TOKEN = process.env.CONTROL_TOKEN;

if (!SECRET_TOKEN) {
    console.error('❌ CONTROL_TOKEN manquant dans .env');
    process.exit(1);
}

app.use(express.json());

// CORS pour Netlify
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

function checkToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant' });
    }
    const token = auth.split(' ')[1];
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: 'Token invalide' });
    }
    next();
}

app.get('/ping', (req, res) => res.json({ pong: true }));

app.get('/status', checkToken, async (req, res) => {
    const services = ['nginx', 'postgresql', 'pm2', 'nodejs'];
    const status = {};
    for (const svc of services) {
        try {
            if (svc === 'pm2') {
                const { stdout } = await execPromise('pm2 list | grep online | wc -l');
                status[svc] = parseInt(stdout.trim()) > 0 ? 'active' : 'inactive';
            } else if (svc === 'nodejs') {
                const { stdout } = await execPromise('netstat -tulpn | grep :3000 | grep LISTEN | wc -l');
                status[svc] = parseInt(stdout.trim()) > 0 ? 'active' : 'inactive';
            } else {
                const { stdout } = await execPromise(`systemctl is-active ${svc}`);
                status[svc] = stdout.trim();
            }
        } catch {
            status[svc] = 'inactive';
        }
    }
    res.json({ status });
});

app.get('/logs/:service', checkToken, async (req, res) => {
    const { service } = req.params;
    let cmd = '';
    if (service === 'nginx') cmd = 'journalctl -u nginx --no-pager -n 30';
    else if (service === 'postgresql') cmd = 'journalctl -u postgresql --no-pager -n 30';
    else if (service === 'pm2') cmd = 'pm2 logs --lines 20 --nostream';
    else if (service === 'nodejs') cmd = 'pm2 logs meetgay --lines 20 --nostream 2>&1';
    else if (service === 'syslog') cmd = 'tail -n 50 /var/log/syslog';
    else return res.status(404).json({ error: 'Service inconnu' });

    try {
        const { stdout, stderr } = await execPromise(cmd);
        res.json({ logs: stdout || stderr });
    } catch (err) {
        res.json({ logs: err.stdout || err.stderr || 'Erreur logs' });
    }
});

app.post('/command', checkToken, async (req, res) => {
    const { action, service } = req.body;
    if (action === 'reboot') {
        execPromise('shutdown -r +1 "Redémarrage via API"').catch(() => { });
        return res.json({ success: true, message: 'Redémarrage dans 1 minute' });
    }
    if (action === 'force-reboot') {
        execPromise('reboot -f').catch(() => { });
        return res.json({ success: true, message: 'Redémarrage forcé' });
    }
    if (service && ['nginx', 'postgresql'].includes(service)) {
        try {
            const { stdout } = await execPromise(`systemctl ${action} ${service}`);
            return res.json({ success: true, output: stdout });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }
    res.status(400).json({ error: 'Commande invalide' });
});

function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) reject({ error, stdout, stderr });
            else resolve({ stdout, stderr });
        });
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🕹️ Control API sur port ${PORT}`);
});