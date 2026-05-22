const http = require('http');
const data = JSON.stringify({ username: 'superadmin', password: 'omega1977' });
const options = { hostname: 'localhost', port: 3000, path: '/api/admin/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
const req = http.request(options, (res) => { let response = ''; res.on('data', (chunk) => response += chunk); res.on('end', () => console.log('Status:', res.statusCode, 'Response:', response)); });
req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
