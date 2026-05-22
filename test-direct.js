const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://admin_omega:AdminOmega1977@localhost:5432/mgb_db' });
async function test() {
  const result = await pool.query('SELECT username, password_hash FROM admins WHERE username = $1', ['superadmin']);
  console.log('User found:', result.rows[0].username);
  console.log('Hash length:', result.rows[0].password_hash.length);
  process.exit();
}
test();
