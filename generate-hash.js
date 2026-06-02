const argon2 = require('argon2');

async function generate() {
    const hash = await argon2.hash('omega1977');
    console.log(hash);
}
generate();
